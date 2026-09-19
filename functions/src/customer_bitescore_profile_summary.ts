import {createHash} from "node:crypto";
import {getAuth} from "firebase-admin/auth";
import {type Firestore} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {
  customerBiteScoreReviewIndex,
  customerBiteScoreReviewerStats,
  readReviewerMetadata,
  type CustomerBiteScoreReadContext,
} from "./customer_bitescore_reads.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";

type Data = Record<string, unknown>;
function count(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 320
    ? value.trim() : null;
}
function millis(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "object" && value !== null && "toMillis" in value && typeof value.toMillis === "function") {
    const result: unknown = value.toMillis();
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function customerBiteScoreFallbackUsername(userId: string): string {
  let seed = 0;
  for (let i = 0; i < userId.length; i++) seed = (seed * 31 + userId.charCodeAt(i)) & 0x7fffffff;
  return `anon${1 + seed % 900000}`;
}

export function customerBiteScoreProfileBadge(value: {
  reviewCount: number; helpfulVotesReceived: number; accountAgeDays: number;
}): string {
  if (value.reviewCount >= 50 && value.helpfulVotesReceived >= 100 && value.accountAgeDays >= 90) return "Top Contributor";
  if (value.reviewCount >= 15 && value.helpfulVotesReceived >= 25 && value.accountAgeDays >= 30) return "Trusted Reviewer";
  if (value.reviewCount >= 5 || value.helpfulVotesReceived >= 5) return "Active Reviewer";
  return "New Reviewer";
}

/** Fixed-size profile header reads. Lists are served by the separate bounded
 * profile-list sessions; private Auth/user-profile data is never returned. */
export async function getCustomerBiteScoreProfileSummaryHandler(
  db: Firestore,
  raw: unknown,
  context: CustomerBiteScoreReadContext,
  options: {
    now?: Date;
    ownAccountCreatedAt?: (userId: string) => Promise<number | null>;
  } = {},
): Promise<Data> {
  const request = raw as Data | null;
  const userId = request && readBiteScoreCatalogRestaurantId(request.userId);
  if (!userId) throw new HttpsError("invalid-argument", "Invalid reviewer identity.");
  const own = context.userId === userId;
  const key = createHash("sha256").update(userId).digest("hex");
  const [identitySnapshot, totalsSnapshot, profileSnapshot, oldest, reviewerMetadata] = await Promise.all([
    db.doc(`public_reviewer_profiles/${userId}`).get(),
    db.doc(`${customerBiteScoreReviewerStats}/${key}`).get(),
    db.doc(`user_profiles/${userId}`).get(),
    db.collection(customerBiteScoreReviewIndex).where("userId", "==", userId)
      .where("publicVisible", "==", true).orderBy("createdAtMs", "asc").limit(1).get(),
    readReviewerMetadata(db, [userId]),
  ]);
  const identity = identitySnapshot.data() ?? {};
  const totals = totalsSnapshot.data() ?? {};
  const fallbackUsername = text(identity.fallbackUsername) ?? customerBiteScoreFallbackUsername(userId);
  const chosenUsername = text(identity.chosenUsername);
  const publicDisplayName = chosenUsername ?? text(identity.publicDisplayName) ?? fallbackUsername;
  const reviewCount = count(totals.publicReviewCount);
  const helpfulVotesReceived = count(totals.publicHelpfulVotesReceived);
  let createdAt: number | null;
  if (own) {
    const readOwn = options.ownAccountCreatedAt ?? (async (uid: string) => {
      const record = await getAuth().getUser(uid);
      return millis(new Date(record.metadata.creationTime));
    });
    createdAt = await readOwn(userId);
  } else {
    const candidates = [millis(identity.createdAt), millis(oldest.docs[0]?.data()?.createdAtMs)]
      .filter((value): value is number => value !== null);
    createdAt = candidates.length === 0 ? null : Math.min(...candidates);
  }
  const accountAgeDays = createdAt === null ? 0 : Math.max(0,
    Math.floor(((options.now ?? new Date()).getTime() - createdAt) / 86_400_000));
  const contributionPoints = typeof profileSnapshot.data()?.contributionPoints === "number" &&
      Number.isFinite(profileSnapshot.data()?.contributionPoints)
    ? Math.trunc(profileSnapshot.data()!.contributionPoints as number) : 0;
  return {
    schemaVersion: 1, userId, publicDisplayName, chosenUsername, fallbackUsername,
    reviewCount, helpfulVotesReceived, accountAgeDays, moderationFlagCount: 0,
    badgeLabel: customerBiteScoreProfileBadge({reviewCount, helpfulVotesReceived, accountAgeDays}),
    contributionPoints, badges: reviewerMetadata.get(userId)?.badges ?? [],
  };
}
