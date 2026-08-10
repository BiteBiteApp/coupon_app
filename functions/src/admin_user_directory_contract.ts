import { createHash } from "node:crypto";

export const adminUserDirectoryVersion =
  "bitestar.admin-user-directory.v1" as const;
export const adminUserSourceSummaryVersion =
  "bitestar.admin-user-source-summary.v1" as const;
export const adminUserClaimedRestaurantVersion =
  "bitestar.admin-user-claimed-restaurant.v1" as const;

export const adminUserDirectoryCollection =
  "admin_user_directory" as const;
export const adminUserSourceSummaryCollection =
  "admin_user_directory_source_summaries" as const;
export const adminUserClaimedRestaurantCollection =
  "admin_user_claimed_restaurant_index" as const;

export const maximumAdminUserDirectoryDocumentBytes = 65_536;

export const adminUserSourceKinds = Object.freeze([
  "restaurantAccount",
  "userProfile",
  "publicReviewerProfile",
  "biteScoreRestaurant",
  "restaurantClaimRequest",
  "dishReview",
  "reviewReport",
  "restaurantReport",
  "dishReport",
  "duplicateRestaurantReport",
  "dishEditProposal",
  "reviewFeedbackVote",
] as const);

export type AdminUserSourceKind = typeof adminUserSourceKinds[number];

const adminUserSourceKindSet = new Set<string>(adminUserSourceKinds);

export function isAdminUserSourceKind(
  value: unknown,
): value is AdminUserSourceKind {
  return typeof value === "string" && adminUserSourceKindSet.has(value);
}

export type AdminUserSourceData = Readonly<Record<string, unknown>>;

export type AdminUserStoredDocument = Readonly<{
  id: string;
  data: AdminUserSourceData;
}>;

export type AdminUserSourceSummary = Readonly<{
  sourceSummaryVersion: typeof adminUserSourceSummaryVersion;
  uid: string;
  sourceKind: AdminUserSourceKind;
  present: true;
  displayName?: string;
  userPointsDisplayName?: string;
  displayEmail?: string;
  normalizedEmail?: string;
  displayPhone?: string;
  normalizedPhone?: string;
  contributionPoints?: number;
  lastContributionAt?: Date;
  latestActivityAt?: Date;
  sourceCreatedAt?: Date;
  sourceUpdatedAt?: Date;
  couponAccountStatus?: string;
  emailVerified?: boolean;
  hasCouponAccount?: true;
  hasBiteScoreOwnership?: true;
  hasProfileActivity?: true;
  hasClaimActivity?: true;
  hasReviewActivity?: true;
  hasReportActivity?: true;
  hasDishSuggestionActivity?: true;
  hasReviewFeedbackVoteActivity?: true;
  sourceFingerprint: string;
  indexedAt: Date;
}>;

export type AdminUserDirectoryDocument = Readonly<{
  directoryVersion: typeof adminUserDirectoryVersion;
  uid: string;
  displayName: string;
  normalizedDisplayName: string;
  displayNamePrefixTokens: readonly string[];
  userPointsDisplayName: string;
  normalizedUserPointsDisplayName: string;
  displayEmail: string | null;
  normalizedEmail: string | null;
  displayPhone: string | null;
  normalizedPhone: string | null;
  contributionPoints: number;
  lastContributionAt: Date | null;
  latestActivityAt: Date | null;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  couponAccountStatus: string;
  emailVerified: boolean;
  roleAdmin: boolean;
  roleCouponOwner: boolean;
  roleBiteScoreOwner: boolean;
  roleClaimant: boolean;
  roleCustomer: boolean;
  activityProfile: boolean;
  activityClaims: boolean;
  activityReviews: boolean;
  activityReports: boolean;
  activityDishSuggestions: boolean;
  activityReviewVotes: boolean;
  activityContributionPoints: boolean;
  claimedRestaurantOwner: boolean;
  includedInUserPointsDirectory: boolean;
  sourceKinds: readonly AdminUserSourceKind[];
  sourceFingerprint: string;
  indexedAt: Date;
}>;

export type AdminUserClaimedRestaurantDocument = Readonly<{
  claimedRestaurantVersion: typeof adminUserClaimedRestaurantVersion;
  sourceRestaurantId: string;
  ownerUid: string;
  displayRestaurantName: string;
  normalizedRestaurantName: string;
  restaurantNamePrefixTokens: readonly string[];
  isClaimed: boolean;
  isActive: boolean;
  sourceFingerprint: string;
  indexedAt: Date;
}>;

function requireDocumentId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes("/")) {
    throw new Error(`${label} must be one Firestore document-ID segment.`);
  }
  return normalized;
}

function digestTuple(tuple: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex");
}

export function createAdminUserSourceSummaryId(value: {
  uid: string;
  sourceKind: AdminUserSourceKind;
}): string {
  const uid = requireDocumentId(value.uid, "Admin user UID");
  if (!isAdminUserSourceKind(value.sourceKind)) {
    throw new Error("Admin user source kind is invalid.");
  }
  return `auss_${digestTuple([
    adminUserSourceSummaryVersion,
    uid,
    value.sourceKind,
  ])}`;
}

export function createAdminUserClaimedRestaurantId(
  sourceRestaurantId: string,
): string {
  const id = requireDocumentId(
    sourceRestaurantId,
    "Claimed restaurant source ID",
  );
  return `aucr_${digestTuple([
    adminUserClaimedRestaurantVersion,
    "biteScoreRestaurant",
    id,
  ])}`;
}

export function createAdminUserFingerprint(
  namespace: string,
  tuple: readonly unknown[],
): string {
  return digestTuple([namespace, ...tuple]);
}

export function adminUserDirectoryDocumentPath(uid: string): string {
  return `${adminUserDirectoryCollection}/${requireDocumentId(uid, "Admin user UID")}`;
}

export function adminUserSourceSummaryDocumentPath(value: {
  uid: string;
  sourceKind: AdminUserSourceKind;
}): string {
  return `${adminUserSourceSummaryCollection}/${createAdminUserSourceSummaryId(value)}`;
}

export function adminUserClaimedRestaurantDocumentPath(
  sourceRestaurantId: string,
): string {
  return `${adminUserClaimedRestaurantCollection}/${
    createAdminUserClaimedRestaurantId(sourceRestaurantId)
  }`;
}

export function serializedAdminUserDocumentBytes(
  document: Readonly<Record<string, unknown>>,
): number {
  return Buffer.byteLength(JSON.stringify(document), "utf8");
}

export function requireAdminUserDocumentSize<
  T extends Readonly<Record<string, unknown>>,
>(document: T): T {
  if (
    serializedAdminUserDocumentBytes(document) >
      maximumAdminUserDirectoryDocumentBytes
  ) {
    throw new Error("Admin user directory document exceeds the private size limit.");
  }
  return document;
}
