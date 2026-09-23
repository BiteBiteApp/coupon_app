import {createHash, timingSafeEqual} from "node:crypto";
import {HttpsError} from "firebase-functions/v2/https";
import {accountDeletionPath} from "./account_deletion_guard.js";

export const accountDeletionVersion = 1;
export const accountDeletionFreshnessSeconds = 5 * 60;
export const accountDeletionPageSize = 20;
export const accountDeletionLeaseMs = 120_000;
export const accountDeletionPublicStates = [
  "requested", "processing", "pending", "complete",
] as const;
export type AccountDeletionPublicState = typeof accountDeletionPublicStates[number];
export type AccountDeletionReason = "billing" | "ownership" | "media" |
  "provider" | "accepted_work" | "temporary_failure" | "identity_changed" | null;
export type AccountDeletionIdentity = Readonly<{
  uid: string;
  creationTime: string;
  providerIds: readonly string[];
  disabled: boolean;
  privileged?: boolean;
}>;
export type AccountDeletionVerifiedSession = Readonly<{
  uid: string;
  authTime: number;
  issuedAt: number;
  signInProvider: string;
}>;
export type AccountDeletionStatus = Readonly<{
  schemaVersion: 1;
  operationId: string;
  state: AccountDeletionPublicState;
  reason: AccountDeletionReason;
  receiptAccepted: boolean;
}>;

export function exactDeletionPayload(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new HttpsError("invalid-argument", "Invalid account deletion request.");
  }
  return value as Record<string, unknown>;
}

export function deletionReceiptDigest(receipt: unknown): string {
  if (typeof receipt !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(receipt)) {
    throw new HttpsError("invalid-argument", "Invalid deletion receipt.");
  }
  return createHash("sha256").update("bitestar.account-deletion.receipt.v1\0").update(receipt).digest("hex");
}

export function deletionReceiptMatches(receipt: unknown, stored: unknown): boolean {
  if (typeof stored !== "string" || !/^[a-f0-9]{64}$/u.test(stored)) return false;
  try { return timingSafeEqual(Buffer.from(deletionReceiptDigest(receipt), "hex"), Buffer.from(stored, "hex")); }
  catch { return false; }
}

/** Called only after verifyIdToken(bearer, true) and a fresh getUser(uid). */
export function validateDeletionConfirmation(
  raw: unknown, session: AccountDeletionVerifiedSession,
  identity: AccountDeletionIdentity, nowMs: number,
): Readonly<{uid: string; receiptDigest: string}> {
  const value = exactDeletionPayload(raw, ["schemaVersion", "expectedUid", "confirmation", "receipt"]);
  accountDeletionPath(session.uid);
  if (value.schemaVersion !== accountDeletionVersion || value.confirmation !== "DELETE") {
    throw new HttpsError("invalid-argument", "Confirm permanent account deletion.");
  }
  if (value.expectedUid !== session.uid || identity.uid !== session.uid || identity.disabled) {
    throw new HttpsError("permission-denied", "The authenticated account changed.");
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  // Anonymous Auth has no separate credential. A truly unlinked account can
  // confirm current-session possession using a newly issued verified token.
  // This exception never treats token refresh as linked-user reauthentication.
  const anonymous = session.signInProvider === "anonymous" && identity.providerIds.length === 0;
  const freshness = anonymous ? session.issuedAt : session.authTime;
  if (!Number.isSafeInteger(freshness) || freshness <= 0 ||
      freshness > nowSeconds || nowSeconds - freshness > accountDeletionFreshnessSeconds ||
      !Number.isFinite(Date.parse(identity.creationTime))) {
    throw new HttpsError("failed-precondition", "Please authenticate again before deleting your account.");
  }
  return {uid: session.uid, receiptDigest: deletionReceiptDigest(value.receipt)};
}

export function safeDeletionStatus(
  job: Record<string, unknown>, receiptAccepted: boolean,
): AccountDeletionStatus {
  const state = job.state;
  if (!accountDeletionPublicStates.includes(state as AccountDeletionPublicState)) {
    throw new HttpsError("unavailable", "Account deletion status is temporarily unavailable.");
  }
  const reason = ["billing", "ownership", "media", "provider", "accepted_work", "temporary_failure", "identity_changed"]
    .includes(String(job.reason)) ? job.reason as AccountDeletionReason : null;
  if (typeof job.operationId !== "string" || !/^[a-f0-9]{64}$/u.test(job.operationId)) {
    throw new HttpsError("unavailable", "Account deletion status is temporarily unavailable.");
  }
  return {schemaVersion: 1, operationId: job.operationId, state: state as AccountDeletionPublicState, reason, receiptAccepted};
}
