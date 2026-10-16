import {Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {accountDeletionPath} from "./account_deletion_guard.js";
import {reviewerBlockPath, reviewerSafetyPreferencesPath} from "./reviewer_safety.js";

type Data = Readonly<Record<string, unknown>>;
export type ReviewerVisibilityRead = (paths: readonly string[]) => Promise<readonly (Data | null)[]>;

export function reviewerVisibilityRefreshRequired(): never {
  throw new HttpsError("failed-precondition", "Reviewer content changed. Refresh to continue.");
}

/** Read-only enforcement of Stage 1's existing records for one public target.
 * Callers supply the viewer exclusively from trusted server context. No list
 * scans, private target profiles, or customer-visible preference metadata. */
export async function readReviewerVisibility(
  read: ReviewerVisibilityRead, viewerId: string | null, targetId: string,
): Promise<number> {
  const fences = [...new Set([accountDeletionPath(targetId),
    ...(viewerId === null ? [] : [accountDeletionPath(viewerId)])])];
  const paths = viewerId === null ? fences : [reviewerSafetyPreferencesPath(viewerId), reviewerBlockPath(viewerId, targetId), ...fences];
  const values = await read(paths);
  if (values.length !== paths.length) reviewerVisibilityRefreshRequired();
  const offset = viewerId === null ? 0 : 2;
  if (values.slice(offset).some((value) => value !== null)) reviewerVisibilityRefreshRequired();
  if (viewerId === null) return 0;
  const [preferences, block] = values;
  let revision = 0;
  if (preferences !== null) {
    if (preferences.schemaVersion !== 1 || !Number.isSafeInteger(preferences.revision) ||
        (preferences.revision as number) < 0 || (preferences.revision as number) >= Number.MAX_SAFE_INTEGER ||
        !(preferences.updatedAt instanceof Timestamp)) reviewerVisibilityRefreshRequired();
    revision = preferences.revision as number;
  }
  if (block !== null) {
    if (revision === 0 || block.schemaVersion !== 1 || block.targetUserId !== targetId ||
        !(block.createdAt instanceof Timestamp)) reviewerVisibilityRefreshRequired();
    throw new HttpsError("not-found", "This reviewer is unavailable.");
  }
  return revision;
}
