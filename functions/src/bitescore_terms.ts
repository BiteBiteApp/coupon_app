import {HttpsError} from "firebase-functions/v2/https";
import {accountDeletionPath, requireAccountWritableInStore} from "./account_deletion_guard.js";
import type {RatingDestructivePrivateDatabase, RatingDestructivePrivateTransaction} from "./rating_destructive_job_store.js";

export type ApprovedBiteScoreTerms = Readonly<{version: string; text: string}>;
// No approved/published Terms exist. Change only in a separately authorized
// release, together with the client and legacy direct-write Rules cutover.
export const approvedBiteScoreTerms: ApprovedBiteScoreTerms | null = null;
type Actor = {uid: string; emailVerified: boolean; anonymous?: boolean};

function identity(actor: Actor, input: unknown): string {
  if (!actor.uid || !actor.emailVerified || actor.anonymous === true) {
    throw new HttpsError("permission-denied", "Sign in and verify your email before accepting Terms.");
  }
  accountDeletionPath(actor.uid);
  if ((input as {expectedUserId?: unknown} | null)?.expectedUserId !== actor.uid) {
    throw new HttpsError("permission-denied", "Your account changed. Please try again.");
  }
  return actor.uid;
}

function policy(value: ApprovedBiteScoreTerms | null): ApprovedBiteScoreTerms | null {
  if (value !== null && (!value.version?.trim() || !value.text?.trim())) {
    throw new HttpsError("failed-precondition", "Approved Terms are unavailable.");
  }
  return value;
}

function matches(data: Readonly<Record<string, unknown>> | undefined, version: string): boolean {
  const receipt = data?.termsAcceptance as {version?: unknown; acceptedAt?: unknown} | undefined;
  const time = receipt?.acceptedAt;
  return receipt?.version === version && (time instanceof Date ||
    (typeof time === "object" && time !== null && "toDate" in time));
}

export async function requireBiteScoreTerms(
  tx: RatingDestructivePrivateTransaction, uid: string,
  approved: ApprovedBiteScoreTerms | null = approvedBiteScoreTerms,
): Promise<void> {
  const current = policy(approved);
  if (current === null) return;
  if (!matches((await tx.getDocument(`user_profiles/${uid}`))?.data, current.version)) {
    throw new HttpsError("failed-precondition", "Accept the current Terms before submitting a review.");
  }
}

/** UID and time come from the callable runtime, never from receipt assertions. */
export async function customerBiteScoreTerms(
  db: RatingDestructivePrivateDatabase, actor: Actor, input: unknown,
  accept: boolean, now: Date,
  approved: ApprovedBiteScoreTerms | null = approvedBiteScoreTerms,
): Promise<Readonly<Record<string, unknown>>> {
  const uid = identity(actor, input);
  const current = policy(approved);
  if (current === null) {
    if (accept) throw new HttpsError("failed-precondition", "No published Terms are available for acceptance.");
    return {schemaVersion: 1, userId: uid, enabled: false};
  }
  return db.runTransaction(async (tx) => {
    await requireAccountWritableInStore(tx, uid);
    const profile = await tx.getDocument(`user_profiles/${uid}`);
    let accepted = matches(profile?.data, current.version);
    if (accept) {
      if ((input as {version?: unknown})?.version !== current.version) {
        throw new HttpsError("failed-precondition", "The Terms version changed. Please review it again.");
      }
      if (!accepted) tx.setDocument(`user_profiles/${uid}`, {
        userId: uid, termsAcceptance: {version: current.version, acceptedAt: now},
      }, {merge: true});
      accepted = true;
    }
    return {schemaVersion: 1, userId: uid, enabled: true,
      version: current.version, text: current.text, accepted};
  });
}
