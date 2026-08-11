import { createHash } from "node:crypto";

export const dishProposalMemberVersion =
  "bitestar.dish-proposal-member.v1" as const;
export const dishProposalSupporterVersion =
  "bitestar.dish-proposal-supporter.v1" as const;
export const dishProposalGroupVersion =
  "bitestar.dish-proposal-group.v1" as const;
export const dishProposalJobVersion =
  "bitestar.dish-proposal-job.v1" as const;
export const dishMergeReviewLockVersion =
  "bitestar.dish-merge-review-lock.v1" as const;

export const dishProposalMemberCollection =
  "private_dish_edit_proposal_group_members" as const;
export const dishProposalSupporterCollection =
  "private_dish_edit_proposal_group_supporters" as const;
export const dishProposalGroupCollection =
  "private_dish_edit_proposal_groups" as const;
export const dishProposalJobCollection =
  "private_dish_edit_application_jobs" as const;
export const dishMergeReviewLockCollection =
  "private_dish_merge_review_locks" as const;

export const dishProposalAutomaticDelayMilliseconds =
  3 * 24 * 60 * 60 * 1000;
export const dishProposalReviewMigrationBatchSize = 100;
export const dishProposalAggregateScanBatchSize = 100;
export const dishProposalFinalizationBatchSize = 1;

export type DishProposalType = "rename" | "merge";
export type DishProposalResolutionType = "apply" | "reject";
export type DishProposalJobStatus =
  | "active"
  | "retryable"
  | "manual_review_required"
  | "complete";
export type DishProposalJobPhase =
  | "validate_target"
  | "validate_targets"
  | "move_reviews"
  | "rebuild_target_aggregate"
  | "rebuild_source_aggregate"
  | "fold_target_aggregate"
  | "fold_source_aggregate"
  | "finalize_dishes"
  | "award_points"
  | "finalize_proposals"
  | "finalize_rejections"
  | "complete";

export type DishProposalSourceData = Readonly<Record<string, unknown>>;

export type DishProposalResolutionIdentity = Readonly<{
  proposalType: DishProposalType;
  restaurantId: string;
  sourceDishId: string;
  mergeTargetDishId: string | null;
  normalizedProposedName: string | null;
}>;

export type DishProposalMembership = Readonly<{
  proposalDocumentId: string;
  groupId: string;
  proposalType: DishProposalType;
  restaurantId: string;
  sourceDishId: string;
  mergeTargetDishId: string | null;
  normalizedProposedName: string | null;
  supporterUid: string;
  trustedServerCreateTime: Date;
}>;

export type DishProposalMemberDocument = DishProposalMembership & Readonly<{
  version: typeof dishProposalMemberVersion;
  membershipEnteredAt: Date;
  membershipGeneration: number;
  currentPending: true;
  fingerprint: string;
  indexedAt: Date;
}>;

export type DishProposalSupporterDocument = Readonly<{
  version: typeof dishProposalSupporterVersion;
  groupId: string;
  supporterUid: string;
  present: true;
  fingerprint: string;
  indexedAt: Date;
}>;

export type DishProposalGroupDocument = Readonly<{
  version: typeof dishProposalGroupVersion;
  groupId: string;
  proposalType: DishProposalType;
  restaurantId: string;
  sourceDishId: string;
  mergeTargetDishId: string | null;
  normalizedProposedName: string | null;
  resolutionIdentitiesValid: true;
  hasPendingMembers: boolean;
  oldestTrustedServerCreateTime: Date | null;
  dueAt: Date | null;
  enoughSupporters: boolean;
  autoEligible: boolean;
  lastMembershipGeneration: number;
  resolutionSequence: number;
  activeJobId: string | null;
  activeResolutionType: DishProposalResolutionType | null;
  cycleCutoffGeneration: number | null;
  cycleCutoffAt: Date | null;
  fingerprint: string;
  indexedAt: Date;
}>;

export type DishProposalAggregateState = Readonly<Record<string, unknown>>;

export type DishProposalJobDocument = Readonly<{
  version: typeof dishProposalJobVersion;
  jobId: string;
  groupId: string;
  resolutionType: DishProposalResolutionType;
  proposalType: DishProposalType;
  status: DishProposalJobStatus;
  phase: DishProposalJobPhase;
  restaurantId: string;
  sourceDishId: string;
  mergeTargetDishId: string | null;
  normalizedProposedName: string | null;
  resolutionSequence: number;
  cycleCutoffGeneration: number;
  cycleCutoffAt: Date;
  reviewMigrationCursorId: string | null;
  aggregateState: DishProposalAggregateState | null;
  aggregateWinnerCursorId: string | null;
  aggregateCursorDocumentId: string | null;
  sourceActiveAggregateWriteGeneration: number | null;
  sourceCompletionAggregateWriteGeneration: number | null;
  targetActiveAggregateWriteGeneration: number | null;
  targetCompletionAggregateWriteGeneration: number | null;
  pointsCursorGeneration: number | null;
  pointsCursorMemberId: string | null;
  renameOldValue: string | null;
  renameNewValue: string | null;
  shouldAwardPoints: boolean;
  failureCode: string | null;
  fingerprint: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}>;

export type DishMergeReviewLockDocument = Readonly<{
  version: typeof dishMergeReviewLockVersion;
  dishId: string;
  jobId: string;
  groupId: string;
  role: "source" | "target";
  state: "active" | "merged_source";
  blocksClientReviews: true;
  blocksClientAggregates: true;
  activeAggregateWriteGeneration: number;
  completionAggregateWriteGeneration: number;
  targetDishId: string | null;
  fingerprint: string;
  createdAt: Date;
  indexedAt: Date;
}>;

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isCanonicalResolutionEntityId(value: string): boolean {
  return value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !/^__.*__$/u.test(value) &&
    !value.includes("/") &&
    Buffer.byteLength(value, "utf8") <= 1_500 &&
    !/\p{Cc}/u.test(value);
}

/**
 * Resolves the production proposal aliases once and returns only identities
 * that are safe to use as Firestore entity IDs during resolution.
 */
export function buildDishProposalResolutionIdentity(
  source: DishProposalSourceData,
): DishProposalResolutionIdentity | null {
  const typeAlias = source.type === undefined || source.type === null
    ? null
    : source.type === "rename" || source.type === "merge"
    ? source.type
    : undefined;
  const targetTypeAlias = source.targetType === undefined ||
      source.targetType === null
    ? null
    : source.targetType === "rename" || source.targetType === "merge"
    ? source.targetType
    : undefined;
  const rawEntityAliases = [
    source.restaurantId,
    source.sourceDishId,
    source.targetDishId,
    source.targetId,
    source.mergeTargetDishId,
  ].filter((value) => value !== undefined && value !== null);
  if (
    typeAlias === undefined ||
    targetTypeAlias === undefined ||
    (typeAlias !== null &&
      targetTypeAlias !== null &&
      typeAlias !== targetTypeAlias) ||
    rawEntityAliases.some((value) =>
      typeof value !== "string" ||
      value !== value.trim() ||
      !isCanonicalResolutionEntityId(value)
    )
  ) {
    return null;
  }
  const proposalType = typeAlias ?? targetTypeAlias;
  const restaurantId = typeof source.restaurantId === "string"
    ? source.restaurantId
    : null;
  const sourceDishIdAlias = typeof source.sourceDishId === "string"
    ? source.sourceDishId
    : null;
  const targetDishIdAlias = typeof source.targetDishId === "string"
    ? source.targetDishId
    : null;
  const targetIdAlias = typeof source.targetId === "string"
    ? source.targetId
    : null;
  const storedTargetDishId = targetDishIdAlias ?? targetIdAlias;
  const sourceDishId = sourceDishIdAlias ?? storedTargetDishId;
  const explicitMergeTargetDishId = typeof source.mergeTargetDishId === "string"
    ? source.mergeTargetDishId
    : null;
  const mergeTargetDishId = explicitMergeTargetDishId ??
    (proposalType === "merge" && sourceDishIdAlias !== null
      ? storedTargetDishId
      : null);
  if (
    proposalType === null ||
    restaurantId === null ||
    sourceDishId === null ||
    (targetDishIdAlias !== null &&
      targetIdAlias !== null &&
      targetDishIdAlias !== targetIdAlias) ||
    (proposalType === "rename" &&
      sourceDishIdAlias !== null &&
      storedTargetDishId !== null &&
      sourceDishIdAlias !== storedTargetDishId) ||
    (proposalType === "merge" &&
      sourceDishIdAlias !== null &&
      explicitMergeTargetDishId !== null &&
      storedTargetDishId !== null &&
      explicitMergeTargetDishId !== storedTargetDishId) ||
    !isCanonicalResolutionEntityId(restaurantId) ||
    !isCanonicalResolutionEntityId(sourceDishId) ||
    (proposalType === "merge" &&
      (mergeTargetDishId === null ||
        !isCanonicalResolutionEntityId(mergeTargetDishId) ||
        mergeTargetDishId === sourceDishId))
  ) {
    return null;
  }
  return Object.freeze({
    proposalType,
    restaurantId,
    sourceDishId,
    mergeTargetDishId: proposalType === "merge" ? mergeTargetDishId : null,
    normalizedProposedName: proposalType === "rename"
      ? (readString(source.proposedName) ?? "").toLowerCase()
      : null,
  });
}

export function readDishProposalDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (value !== null && typeof value === "object") {
    const timestamp = value as {toDate?: () => Date};
    if (typeof timestamp.toDate === "function") {
      try {
        return readDishProposalDate(timestamp.toDate());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function requireDocumentSegment(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    Buffer.byteLength(value, "utf8") > 1_500
  ) {
    throw new Error(`${label} must be one Firestore document-ID segment.`);
  }
  return value;
}

function canonicalizeFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeFingerprintValue);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(
      value as Readonly<Record<string, unknown>>,
    ).sort(([left], [right]) => left.localeCompare(right))) {
      result[key] = canonicalizeFingerprintValue(nestedValue);
    }
    return result;
  }
  return value;
}

function hashCanonicalArray(parts: readonly unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeFingerprintValue(parts)))
    .digest("hex");
}

export function createDishProposalGroupId(value: {
  proposalType: DishProposalType;
  restaurantId: string;
  sourceDishId: string;
  mergeTargetDishId: string | null;
  normalizedProposedName: string | null;
}): string {
  const tuple = value.proposalType === "merge"
    ? [
        value.proposalType,
        value.restaurantId.trim(),
        value.sourceDishId.trim(),
        (value.mergeTargetDishId ?? "").trim(),
      ]
    : [
        value.proposalType,
        value.restaurantId.trim(),
        value.sourceDishId.trim(),
        (value.normalizedProposedName ?? "").trim().toLowerCase(),
      ];
  return hashCanonicalArray([dishProposalGroupVersion, tuple]);
}

export function createDishProposalMemberId(proposalDocumentId: string): string {
  return hashCanonicalArray([
    dishProposalMemberVersion,
    requireDocumentSegment(proposalDocumentId, "Proposal document ID"),
  ]);
}

export function createDishProposalSupporterId(
  groupId: string,
  supporterUid: string,
): string {
  return hashCanonicalArray([
    dishProposalSupporterVersion,
    requireDocumentSegment(groupId, "Dish proposal group ID"),
    requireDocumentSegment(supporterUid, "Dish proposal supporter UID"),
  ]);
}

export function createDishProposalJobId(value: {
  groupId: string;
  resolutionSequence: number;
  resolutionType: DishProposalResolutionType;
}): string {
  return hashCanonicalArray([
    dishProposalJobVersion,
    requireDocumentSegment(value.groupId, "Dish proposal group ID"),
    value.resolutionSequence,
    value.resolutionType,
  ]);
}

export function dishProposalMemberPath(proposalDocumentId: string): string {
  return `${dishProposalMemberCollection}/${createDishProposalMemberId(
    proposalDocumentId,
  )}`;
}

export function dishProposalSupporterPath(
  groupId: string,
  supporterUid: string,
): string {
  return `${dishProposalSupporterCollection}/${createDishProposalSupporterId(
    groupId,
    supporterUid,
  )}`;
}

export function dishProposalGroupPath(groupId: string): string {
  return `${dishProposalGroupCollection}/${requireDocumentSegment(
    groupId,
    "Dish proposal group ID",
  )}`;
}

export function dishProposalJobPath(jobId: string): string {
  return `${dishProposalJobCollection}/${requireDocumentSegment(
    jobId,
    "Dish proposal job ID",
  )}`;
}

export function dishMergeReviewLockPath(dishId: string): string {
  return `${dishMergeReviewLockCollection}/${requireDocumentSegment(
    dishId,
    "Dish ID",
  )}`;
}

export function buildDishProposalMembership(value: {
  proposalDocumentId: string;
  source: DishProposalSourceData | null;
  trustedServerCreateTime: Date | null;
}): DishProposalMembership | null {
  const source = value.source;
  const trustedServerCreateTime = value.trustedServerCreateTime;
  if (
    source === null ||
    trustedServerCreateTime === null ||
    source.status !== "pending"
  ) {
    return null;
  }

  const resolutionIdentity = buildDishProposalResolutionIdentity(source);
  const supporterUid = readString(source.userId) ??
    readString(source.createdByUserId);
  if (resolutionIdentity === null || supporterUid === null) {
    return null;
  }

  return {
    proposalDocumentId: requireDocumentSegment(
      value.proposalDocumentId,
      "Proposal document ID",
    ),
    groupId: createDishProposalGroupId(resolutionIdentity),
    ...resolutionIdentity,
    supporterUid,
    trustedServerCreateTime,
  };
}

export function buildDishProposalMemberDocument(value: {
  membership: DishProposalMembership;
  membershipEnteredAt: Date;
  membershipGeneration: number;
  indexedAt: Date;
}): DishProposalMemberDocument {
  const fingerprint = hashCanonicalArray([
    dishProposalMemberVersion,
    value.membership.proposalDocumentId,
    value.membership.groupId,
    value.membership.proposalType,
    value.membership.restaurantId,
    value.membership.sourceDishId,
    value.membership.mergeTargetDishId,
    value.membership.normalizedProposedName,
    value.membership.supporterUid,
    value.membership.trustedServerCreateTime.toISOString(),
    value.membershipEnteredAt.toISOString(),
    value.membershipGeneration,
  ]);
  return {
    version: dishProposalMemberVersion,
    ...value.membership,
    membershipEnteredAt: value.membershipEnteredAt,
    membershipGeneration: value.membershipGeneration,
    currentPending: true,
    fingerprint,
    indexedAt: value.indexedAt,
  };
}

export function buildDishProposalSupporterDocument(value: {
  groupId: string;
  supporterUid: string;
  indexedAt: Date;
}): DishProposalSupporterDocument {
  return {
    version: dishProposalSupporterVersion,
    groupId: value.groupId,
    supporterUid: value.supporterUid,
    present: true,
    fingerprint: hashCanonicalArray([
      dishProposalSupporterVersion,
      value.groupId,
      value.supporterUid,
    ]),
    indexedAt: value.indexedAt,
  };
}

export function dishProposalDocumentFingerprint(
  version: string,
  values: readonly unknown[],
): string {
  return hashCanonicalArray([version, values]);
}

export function normalizeDishNameForSave(input: string): string {
  return input
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .map((word) => word
      .split("-")
      .map((part) => part.length === 0
        ? part
        : `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
      .join("-"))
    .join(" ");
}
