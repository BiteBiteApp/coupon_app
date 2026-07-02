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
  dishImageAdded: "dish_image_added",
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

type DocumentReferenceLike = {
  id: string;
  get(): Promise<DocumentSnapshotLike>;
};

type DocumentSnapshotLike = {
  id: string;
  exists: boolean;
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

function combineContributionPointAwardResults(
  results: Iterable<ContributionPointAwardResult>,
  params: { actionGroupId: string },
): ContributionPointAwardResult {
  return {
    entries: Array.from(results).flatMap((result) => result.entries),
    actionGroupId: params.actionGroupId,
  };
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
