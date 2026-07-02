import { FieldValue } from "firebase-admin/firestore";
import type { WhereFilterOp } from "firebase-admin/firestore";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

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
};

type QueryLike = {
  where(fieldPath: string, opStr: WhereFilterOp, value: unknown): QueryLike;
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
};

type CallableAuthLike = {
  uid?: string;
  token?: Record<string, unknown>;
};

const betaAdminEmails = new Set(["schuyler.cole@gmail.com"]);
const maxCelebrationLedgerEntryIds = 30;

const adminServerFieldValues: ServerFieldValues = {
  serverTimestamp: () => FieldValue.serverTimestamp(),
  increment: (delta: number) => FieldValue.increment(delta),
};

export function buildContributionLedgerDocumentIdFromSourceKey(
  sourceKey: string,
): string {
  return encodeURIComponent(sourceKey.trim());
}

export function buildContributionReversalDocumentId(
  ledgerEntryId: string,
): string {
  return `reversal:${encodeURIComponent(ledgerEntryId.trim())}`;
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

  const fieldValues = options.fieldValues ?? adminServerFieldValues;
  const documentId = buildContributionLedgerDocumentIdFromSourceKey(
    normalizedDraft.sourceKey,
  );
  const entryRef = ledgerDocument(db, documentId);
  const userRef = userProfileDocument(db, normalizedDraft.userId);

  const createdEntryId = await db.runTransaction<string | null>(
    async (transaction) => {
      const existingSnapshot = await transaction.get(entryRef);
      if (existingSnapshot.exists) {
        const existing = parseLedgerEntry(existingSnapshot);
        if (
          !existing ||
          existing.status === contributionPointStatus.active
        ) {
          return null;
        }

        const restoreRef = ledgerDocument(db, `restore:${documentId}`);
        const restoreSnapshot = await transaction.get(restoreRef);
        if (restoreSnapshot.exists) {
          return null;
        }

        transaction.set(restoreRef, {
          ...entryMap({
            id: restoreRef.id,
            draft: normalizedDraft,
            description: `${normalizedDraft.description} restored`,
            fieldValues,
          }),
          originalLedgerEntryId: existing.id,
        });
        incrementCachedTotal(
          transaction,
          userRef,
          normalizedDraft.points,
          fieldValues,
        );
        return restoreRef.id;
      }

      transaction.set(
        entryRef,
        entryMap({
          id: entryRef.id,
          draft: normalizedDraft,
          fieldValues,
        }),
      );
      incrementCachedTotal(
        transaction,
        userRef,
        normalizedDraft.points,
        fieldValues,
      );
      return entryRef.id;
    },
  );

  if (!createdEntryId) {
    return {
      entries: [
        {
          ledgerEntryId: documentId,
          points: normalizedDraft.points,
          wasCreated: false,
        },
      ],
      actionGroupId: normalizedDraft.sourceKey,
    };
  }

  return {
    entries: [
      {
        ledgerEntryId: createdEntryId,
        points: normalizedDraft.points,
        wasCreated: true,
      },
    ],
    actionGroupId: normalizedDraft.sourceKey,
  };
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
  const proposalId = readRequiredString(data.proposalId, "proposalId");
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
    return noAwardResponse();
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
  const oldValueFromClient = readOptionalString(data.oldValue);
  const newValueFromClient = readOptionalString(data.newValue);

  const draft = approvedDishProposalAwardDraft({
    proposal,
    targetDishData,
    mergeTargetDishData,
    restaurantData,
    oldValueFromClient,
    newValueFromClient,
  });
  if (!draft) {
    return noAwardResponse();
  }

  return {
    ok: true,
    result: await awardContributionPointsTransaction(db, draft, options),
  };
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

async function loadValidPublicReviewCountForUser(
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
    id: readOptionalString(data.id) ?? snapshot.id,
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
  return `${params.actionType.trim()}:${params.requestId.trim()}`;
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
  const sourceKey = readOptionalString(data.sourceKey);
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
    requestId: readOptionalString(data.requestId),
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

function readRequiredPositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be a positive integer.`,
    );
  }
  return value;
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
