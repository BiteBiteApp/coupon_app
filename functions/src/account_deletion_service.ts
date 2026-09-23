import {reviewMilestoneReconciliationLockPath} from "./review_milestone_reconciliation_lock.js";
import {accountDeletionPhotoOwnerKey} from "./account_deletion_finalized_media.js";
import {randomBytes} from "node:crypto";
import {FieldValue, type Firestore, type Transaction, type DocumentData} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {accountDeletionCollection, accountDeletionPath} from "./account_deletion_guard.js";
import {
  accountDeletionLeaseMs, deletionReceiptDigest, deletionReceiptMatches,
  exactDeletionPayload, safeDeletionStatus, validateDeletionConfirmation,
  type AccountDeletionIdentity, type AccountDeletionReason,
  type AccountDeletionStatus, type AccountDeletionVerifiedSession,
} from "./account_deletion_contract.js";

export type AccountDeletionJob = DocumentData & {
  uid: string; operationId: string; authCreationTime: string;
  phase: string; state: "requested" | "processing" | "pending" | "complete";
  receiptDigests: string[]; leaseToken: string | null; leaseUntilMs: number;
  billingRevision?: number; attempts: number; item: DocumentData | null; stageIndex: number;
};
export type DeletionStepResult = Readonly<{
  phase?: string; stageIndex?: number; item?: DocumentData | null;
  pending?: Exclude<AccountDeletionReason, null>;
  retry?: boolean; complete?: boolean;
}>;
export type AccountDeletionStepContext = Readonly<{
  db: Firestore; job: AccountDeletionJob; now: () => number;
  /** Must be read BEFORE writes in every step's Firestore transaction. */
  assertLease(transaction: Transaction): Promise<AccountDeletionJob>;
}>;
export type AccountDeletionStep = (context: AccountDeletionStepContext) => Promise<DeletionStepResult>;

function parseJob(uid: string, value: DocumentData | undefined): AccountDeletionJob {
  if (!value || value.schemaVersion !== 1 || value.uid !== uid ||
      typeof value.operationId !== "string" || !/^[a-f0-9]{64}$/u.test(value.operationId) ||
      typeof value.authCreationTime !== "string" || typeof value.phase !== "string" ||
      !["requested", "processing", "pending", "complete"].includes(value.state) ||
      !Array.isArray(value.receiptDigests) || value.receiptDigests.length < 1 || value.receiptDigests.length > 8 ||
      value.receiptDigests.some((v: unknown) => typeof v !== "string" || !/^[a-f0-9]{64}$/u.test(v)) ||
      !Number.isSafeInteger(value.stageIndex) || value.stageIndex < 0 ||
      !Number.isSafeInteger(value.attempts) || value.attempts < 0 ||
      !Number.isSafeInteger(value.leaseUntilMs) || value.leaseUntilMs < 0 ||
      (value.leaseToken !== null && (typeof value.leaseToken !== "string" || !/^[a-f0-9]{48}$/u.test(value.leaseToken))) ||
      (value.nextAttemptAtMs !== undefined && (!Number.isSafeInteger(value.nextAttemptAtMs) || value.nextAttemptAtMs < 0))) {
    throw new HttpsError("unavailable", "Account deletion needs recovery.");
  }
  return value as AccountDeletionJob;
}

export async function requestAccountDeletionHandler(
  db: Firestore, raw: unknown, session: AccountDeletionVerifiedSession,
  identity: AccountDeletionIdentity, nowMs = Date.now(),
): Promise<AccountDeletionStatus> {
  const confirmed = validateDeletionConfirmation(raw, session, identity, nowMs);
  const ref = db.doc(accountDeletionPath(confirmed.uid));
  const operationId = randomBytes(32).toString("hex");
  // Monotonic preparation only: no job/accepted receipt and no content deletion
  // until the final atomic commit. Retries progress through revoked history.
  for (let page = 0; page < 3; page++) {
    const ready = await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return true;
      const grants = await tx.get(db.collection("private_menu_image_upload_authorizations")
        .where("ownerUserId", "==", confirmed.uid).where("state", "==", "active").limit(401));
      if (grants.size <= 400) return true;
      for (const grant of grants.docs.slice(0, 400)) tx.update(grant.ref, {state: "revoked"});
      return false;
    });
    if (ready) break;
  }
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      const job = parseJob(confirmed.uid, snapshot.data());
      if (job.authCreationTime !== identity.creationTime) {
        throw new HttpsError("failed-precondition", "This account identity needs recovery.");
      }
      // Fresh self authentication may add a recovery receipt without rotating
      // earlier devices' receipts or starting another destructive operation.
      if (!job.receiptDigests.includes(confirmed.receiptDigest)) {
        if (job.receiptDigests.length >= 8) {
          throw new HttpsError("resource-exhausted", "Use an existing deletion receipt to check this request.");
        }
        tx.update(ref, {receiptDigests: [...job.receiptDigests, confirmed.receiptDigest]});
      }
      return safeDeletionStatus(job, true);
    }
    // Grant revocation and publication closure are part of acceptance, never
    // asynchronous mirrors. Overflow refuses BEFORE any marker or mutation.
    const [account, lock, grants] = await Promise.all([
      tx.get(db.doc(`restaurant_accounts/${confirmed.uid}`)),
      tx.get(db.doc(reviewMilestoneReconciliationLockPath(confirmed.uid))),
      tx.get(db.collection("private_menu_image_upload_authorizations").where("ownerUserId", "==", confirmed.uid).where("state", "==", "active").limit(401)),
    ]);
    if (grants.size > 400) throw new HttpsError("resource-exhausted", "Upload authorization preparation is still in progress. Retry this deletion request; it has not yet been accepted.");
    const job: AccountDeletionJob = {
      schemaVersion: 1, uid: confirmed.uid, operationId,
      authCreationTime: identity.creationTime,
      photoOwnerKey: accountDeletionPhotoOwnerKey(confirmed.uid),
      state: "requested", phase: "preflight", reason: null,
      receiptDigests: [confirmed.receiptDigest], createdAtMs: nowMs,
      updatedAtMs: nowMs, nextAttemptAtMs: nowMs, attempts: 0,
      leaseToken: null, leaseUntilMs: 0, stageIndex: 0, item: null,
    };
    if (account.exists) tx.update(account.ref, {accountDeletionRequested: true, couponPostingEnabled: false, updatedAt: FieldValue.serverTimestamp()});
    // Existing lock core/fingerprint stays intact for already-accepted work.
    tx.set(lock.ref, {accountDeletionRequested: true}, {merge: true});
    for (const grant of grants.docs) tx.update(grant.ref, {state: "revoked"});
    tx.create(ref, job);
    return safeDeletionStatus(job, true);
  });
}

export async function getAccountDeletionStatusHandler(
  db: Firestore, raw: unknown, authenticatedUid: string | null,
): Promise<AccountDeletionStatus> {
  const value = exactDeletionPayload(raw, ["schemaVersion", "receipt"]);
  // A random operation ID is not authority. No lookup by email, UID or path.
  if (value.schemaVersion !== 1) {
    throw new HttpsError("permission-denied", "The deletion receipt is unavailable.");
  }
  deletionReceiptDigest(value.receipt);
  const result = await db.collection(accountDeletionCollection)
    .where("receiptDigests", "array-contains", deletionReceiptDigest(value.receipt)).limit(2).get();
  if (result.size !== 1) throw new HttpsError("permission-denied", "The deletion receipt is unavailable.");
  const document = result.docs[0];
  const job = parseJob(document.id, document.data());
  const receiptAccepted = job.receiptDigests.some((digest) => deletionReceiptMatches(value.receipt, digest));
  // A signed-in different account cannot accidentally consume A's receipt.
  if (!receiptAccepted || (authenticatedUid !== null && authenticatedUid !== job.uid)) {
    throw new HttpsError("permission-denied", "The deletion receipt is unavailable.");
  }
  return safeDeletionStatus(job, true);
}

export async function processAccountDeletionJob(
  db: Firestore, uid: string, step: AccountDeletionStep,
  now: () => number = Date.now,
): Promise<"busy" | "advanced" | "pending" | "complete"> {
  const ref = db.doc(accountDeletionPath(uid));
  const token = randomBytes(24).toString("hex");
  const job = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const current = parseJob(uid, snapshot.data());
    if (current.state === "complete" || current.nextAttemptAtMs === undefined ||
        current.nextAttemptAtMs > now() || current.leaseUntilMs > now()) return null;
    const next: AccountDeletionJob = {...current, leaseToken: token, leaseUntilMs: now() + accountDeletionLeaseMs,
      state: "processing" as const, updatedAtMs: now()};
    tx.update(ref, next);
    return next;
  });
  if (job === null) return "busy";
  const assertLease = async (tx: Transaction): Promise<AccountDeletionJob> => {
    const current = parseJob(uid, (await tx.get(ref)).data());
    if (current.operationId !== job.operationId || current.leaseToken !== token ||
        current.leaseUntilMs <= now() || current.state === "complete") {
      throw new HttpsError("aborted", "Deletion work changed ownership.");
    }
    return current;
  };
  let result: DeletionStepResult;
  try { result = await step({db, job, now, assertLease}); }
  catch {
    // No raw exception, request body, content, token or provider payload is
    // persisted/logged. Unknown/ambiguous effects retry the same durable item.
    result = {pending: "temporary_failure", retry: true};
  }
  return db.runTransaction(async (tx) => {
    const current = await assertLease(tx);
    if (result.complete && (current.billingRevision ?? 0) !== (job.billingRevision ?? 0)) result = {pending: "billing", retry: true};
    if (result.complete && ((current.mediaRevision ?? 0) !== (job.mediaRevision ?? 0) ||
        !(await tx.get(ref.collection("object_items").where("kind", "==", "late_finalize").where("complete", "==", false).limit(1))).empty)) result = {pending: "media", retry: true};
    const attempts = result.pending ? Math.min(current.attempts + 1, 20) : 0;
    const state = result.complete ? "complete" : result.pending ? "pending" : "processing";
    const patch: DocumentData = {
      state, reason: result.pending ?? null, leaseToken: null, leaseUntilMs: 0,
      updatedAtMs: now(), attempts,
      ...(result.phase !== undefined ? {phase: result.phase} : {}),
      ...(result.stageIndex !== undefined ? {stageIndex: result.stageIndex} : {}),
      ...(result.item !== undefined ? {item: result.item} : {}),
      nextAttemptAtMs: result.complete ? FieldValue.delete()
        : now() + (result.pending ? (result.retry ? Math.min(3_600_000, 10_000 * 2 ** attempts) : 3_600_000) : 0),
    };
    if (result.complete) {
      // Keep only the immutable UID/request/creation fence and status receipt
      // needed for late-write suppression and truthful requester completion.
      patch.completedAtMs = now(); patch.item = null; patch.stageIndex = 0;
      patch.phase = "complete"; patch.authCreationTime = current.authCreationTime;
    }
    tx.update(ref, patch);
    return result.complete ? "complete" : result.pending ? "pending" : "advanced";
  });
}

export async function processDueAccountDeletions(
  db: Firestore, step: AccountDeletionStep, now: () => number = Date.now,
): Promise<void> {
  // Explicit cap: one bounded step per selected account per scheduler run.
  const due = await db.collection(accountDeletionCollection)
    .where("nextAttemptAtMs", "<=", now()).orderBy("nextAttemptAtMs").limit(10).get();
  const startedAt = now();
  for (const document of due.docs) {
    if (now() - startedAt > 35_000) break;
    try { await processAccountDeletionJob(db, document.id, step, now); }
    catch {
      // Malformed jobs keep their fence and visible recovery state, while a
      // bounded backoff prevents a bad first page starving later accounts.
      await db.runTransaction(async (tx) => {
        const current = await tx.get(document.ref);
        const value = current.data();
        if (!value || value.state === "complete" || value.leaseUntilMs > now()) return;
        tx.update(document.ref, {state: "pending", reason: "temporary_failure", nextAttemptAtMs: now() + 3_600_000});
      });
    }
  }
}
