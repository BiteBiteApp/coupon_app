import {type Firestore, type Transaction} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {accountDeletionPath} from "./account_deletion_guard.js";

type Data = Readonly<Record<string, unknown>>;
export function postingRestrictionPath(uid: string): string {
  accountDeletionPath(uid);
  return `user_profiles/${uid}/posting_restriction_state/current`;
}
function millis(value: unknown): number | null {
  const result = value instanceof Date ? value.getTime() :
    value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function" ? value.toMillis() : null;
  return typeof result === "number" && Number.isSafeInteger(result) && result >= 0 ? result : null;
}
/** Safe status only; never returns operator identities or moderation evidence.
 * An absent record is unrestricted. A malformed existing record fails closed. */
export function postingRestrictionStatus(data: Data | undefined, nowMs: number): Data {
  if (!data) return {status: "none", revision: 0, kind: null, startsAtMillis: null, endsAtMillis: null};
  const start = millis(data.startsAt), end = millis(data.endsAt), release = millis(data.releasedAt);
  if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1 ||
      (data.revision as number) >= Number.MAX_SAFE_INTEGER || !["7d", "14d", "indefinite"].includes(String(data.kind)) || start === null ||
      (data.kind === "indefinite" ? data.endsAt !== null : end === null || end <= start) ||
      (data.releasedAt !== null && release === null)) {
    throw new HttpsError("failed-precondition", "Posting status is unavailable. Please try again later.");
  }
  return {status: release !== null ? "released" : end !== null && nowMs >= end ? "expired" : "active",
    revision: data.revision, kind: data.kind, startsAtMillis: start, endsAtMillis: end};
}
export function requirePostingAllowed(data: Data | undefined, nowMs: number): void {
  const status = postingRestrictionStatus(data, nowMs);
  if (status.status === "active") {
    throw new HttpsError("permission-denied", "Your public posting is restricted.", {
      reason: "posting-restricted", kind: status.kind, endsAtMillis: status.endsAtMillis,
    });
  }
}
export async function requireCustomerPostingAllowed(db: Firestore, tx: Transaction, uid: string, nowMs = Date.now()): Promise<void> {
  requirePostingAllowed((await tx.get(db.doc(postingRestrictionPath(uid)))).data(), nowMs);
}
export async function requireCustomerPostingAllowedInStore(
  tx: {getDocument(path: string): Promise<{data: Data} | null>}, uid: string, nowMs = Date.now(),
): Promise<void> {
  requirePostingAllowed((await tx.getDocument(postingRestrictionPath(uid)))?.data, nowMs);
}
