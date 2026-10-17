import {HttpsError} from "firebase-functions/v2/https";
import type {Firestore, Transaction} from "firebase-admin/firestore";
import {accountDeletionPath, requireAccountWritableInStore} from "./account_deletion_guard.js";
import type {RatingDestructivePrivateDatabase} from "./rating_destructive_job_store.js";

type Data = Readonly<Record<string, unknown>>;
type Reader = {getDocument(path: string): Promise<{data: Data} | null>};
export type ApprovedBiteScoreTerms = Readonly<{
  version: string; text: string;
  // Only explicitly approved non-mandatory revisions may retain prior receipts.
  acceptedPriorVersions?: readonly string[];
}>;
// One global BiteStar document and UID receipt serve customers and owners.
// Historical internal names stay stable. No approved/published Terms exist.
// Change only in a separately authorized coordinated release.
export const approvedBiteScoreTerms: ApprovedBiteScoreTerms | null = null;
export const biteScoreTermsRuntimePath = "private_bitescore_runtime/terms";
export const biteScoreTermsRuntimeCandidate = {schemaVersion: 1, required: false} as const;
type Actor = {uid: string; emailVerified: boolean; anonymous?: boolean};

function identity(actor: Actor, input: unknown): string {
  // Consent grants no posting, restaurant or Admin authority. Phone-authenticated
  // owners can accept while customer publication still requires verified email.
  if (!actor.uid || actor.anonymous === true) {
    throw new HttpsError("permission-denied", "Sign in to a non-guest account before accepting Terms.");
  }
  accountDeletionPath(actor.uid);
  if ((input as {expectedUserId?: unknown} | null)?.expectedUserId !== actor.uid) {
    throw new HttpsError("permission-denied", "Your account changed. Please try again.");
  }
  return actor.uid;
}
function unavailable(): never {
  throw new HttpsError("failed-precondition", "Approved Terms are unavailable. Please try again later.");
}
/** Read in the publication transaction: a cutover/version change retries the
 * write. A stale Function revision cannot authorize under an older policy.
 * Absent/explicitly off is dormant; malformed mandatory configuration is closed.
 * The private runtime is approved release metadata, never a client assertion. */
export async function readBiteScoreTermsPolicy(tx: Reader,
  approved: ApprovedBiteScoreTerms | null = approvedBiteScoreTerms): Promise<ApprovedBiteScoreTerms | null> {
  const runtime = (await tx.getDocument(biteScoreTermsRuntimePath))?.data;
  if (!runtime || runtime.required === false) return null;
  if (!approved || !approved.version?.trim() || !approved.text?.trim() ||
      approved.acceptedPriorVersions?.some(v => typeof v !== "string" || !v.trim())) unavailable();
  const versions = [approved.version, ...(approved.acceptedPriorVersions ?? [])];
  if (runtime.schemaVersion !== 1 || runtime.required !== true || runtime.version !== approved.version ||
      !Array.isArray(runtime.acceptedVersions) || runtime.acceptedVersions.length !== versions.length ||
      runtime.acceptedVersions.some((v, i) => v !== versions[i])) unavailable();
  return approved;
}
function matches(data: Data | undefined, policy: ApprovedBiteScoreTerms, now: Date): boolean {
  const receipt = data?.termsAcceptance as {version?: unknown; acceptedAt?: unknown} | undefined;
  const value = receipt?.acceptedAt;
  const time = value instanceof Date ? value.getTime() :
    value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function" ? value.toMillis() : NaN;
  return typeof receipt?.version === "string" &&
    [policy.version, ...(policy.acceptedPriorVersions ?? [])].includes(receipt.version) &&
    Number.isFinite(time) && time >= 0 && time <= now.getTime();
}
export async function requireBiteScoreTerms(tx: Reader, uid: string,
  approved: ApprovedBiteScoreTerms | null = approvedBiteScoreTerms, now = new Date()): Promise<void> {
  accountDeletionPath(uid);
  const current = await readBiteScoreTermsPolicy(tx, approved);
  if (current === null) return;
  if (!matches((await tx.getDocument(`user_profiles/${uid}`))?.data, current, now)) {
    throw new HttpsError("failed-precondition", "Accept the current Terms before contributing public content.");
  }
}
export async function requireBiteScoreTermsInFirestore(db: Firestore, tx: Transaction, uid: string,
  approved: ApprovedBiteScoreTerms | null = approvedBiteScoreTerms, now = new Date()): Promise<void> {
  await requireBiteScoreTerms({getDocument: async path => {
    const snapshot = await tx.get(db.doc(path));
    return snapshot.exists ? {data: snapshot.data()!} : null;
  }}, uid, approved, now);
}
/** UID and time come from the callable runtime, never from receipt assertions. */
export async function customerBiteScoreTerms(db: RatingDestructivePrivateDatabase, actor: Actor, input: unknown,
  accept: boolean, now: Date, approved: ApprovedBiteScoreTerms | null = approvedBiteScoreTerms): Promise<Data> {
  const uid = identity(actor, input);
  return db.runTransaction(async tx => {
    await requireAccountWritableInStore(tx, uid);
    const current = await readBiteScoreTermsPolicy(tx, approved);
    if (current === null) {
      if (accept) throw new HttpsError("failed-precondition", "No published Terms are available for acceptance.");
      return {schemaVersion: 1, userId: uid, enabled: false};
    }
    const profile = await tx.getDocument(`user_profiles/${uid}`);
    let accepted = matches(profile?.data, current, now);
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
