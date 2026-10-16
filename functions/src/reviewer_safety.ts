import {createHash} from "node:crypto";
import {FieldValue, type Firestore, type Transaction} from "firebase-admin/firestore";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {requireAuthenticatedRestaurantAccountActor} from "./admin_authorization.js";
import {accountDeletionPath, requireAccountWritable} from "./account_deletion_guard.js";
import {isCustomerBiteScorePublicReview} from "./customer_bitescore_reads.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";

type Data = Record<string, unknown>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const reviewerReportReasons = Object.freeze([
  "Spam", "Harassment", "Off-topic", "Suspicious or fake",
  "Profanity / Inappropriate Content", "Threats or Hate Speech", "Private Personal Information", "Other",
]);
// Same 12/minute admission ceiling as existing interactive profile/menu starts.
// Counts distinct requests (including duplicate-target requests), not network
// retries. One small transaction serializes admission across all devices.
export const reviewerReportAdmissionLimit = 12;
export const reviewerSafetyStatePath = (uid: string) => `user_profiles/${uid}/reviewer_safety_state`;
export const reviewerSafetyPreferencesPath = (uid: string) => `${reviewerSafetyStatePath(uid)}/preferences`;
export const reviewerBlockPath = (uid: string, target: string) => `user_profiles/${uid}/blocked_reviewers/${target}`;

function invalid(): never { throw new HttpsError("invalid-argument", "Invalid reviewer safety request."); }
function uid(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim()) invalid();
  accountDeletionPath(value);
  return value;
}
function sourceId(value: unknown): string {
  const parsed = readBiteScoreCatalogRestaurantId(value);
  if (!parsed || parsed !== value) invalid();
  return parsed;
}
function requestData(raw: unknown, keys: readonly string[]): Data {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
  const value = raw as Data;
  if (value.schemaVersion !== 1 || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) invalid();
  return value;
}
function actor(request: CallableRequest<unknown>, data: Data, verified = false): string {
  const identity = requireAuthenticatedRestaurantAccountActor(request);
  const userId = uid(identity.uid);
  if (userId !== request.auth?.uid || data.expectedUserId !== userId) {
    throw new HttpsError("permission-denied", "The signed-in account changed.");
  }
  if (verified && !identity.emailVerified) throw new HttpsError("permission-denied", "Verify your email before reporting.");
  return userId;
}
function other(userId: string, value: unknown): string {
  const target = uid(value);
  if (target === userId) throw new HttpsError("invalid-argument", "You cannot report or block yourself.");
  return target;
}
export function reviewerSafetyRevision(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= Number.MAX_SAFE_INTEGER) {
    throw new HttpsError("failed-precondition", "Reviewer preferences need recovery.");
  }
  return value as number;
}
function publicText(value: unknown, limit: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

/** No private profile/Auth reads, fabricated identities, or full source copies.
 * A source review can establish an author without a public profile document. */
async function publicEvidence(db: Firestore, tx: Transaction, target: string, reviewId: string | null): Promise<Data> {
  await requireAccountWritable(db, tx, target);
  const profile = (await tx.get(db.doc(`public_reviewer_profiles/${target}`))).data();
  if (profile && profile.userId !== target) throw new HttpsError("failed-precondition", "Reviewer identity is inconsistent.");
  let supportingReview: Data | null = null;
  if (reviewId !== null) {
    const review = (await tx.get(db.doc(`dish_reviews/${reviewId}`))).data();
    if (!review || review.userId !== target || !isCustomerBiteScorePublicReview(review)) {
      throw new HttpsError("not-found", "The public review is unavailable for this reviewer.");
    }
    const dishId = sourceId(review.dishId), restaurantId = sourceId(review.restaurantId);
    const [dish, restaurant] = await tx.getAll(db.doc(`bitescore_dishes/${dishId}`), db.doc(`bitescore_restaurants/${restaurantId}`));
    if (!dish.exists || !restaurant.exists || dish.get("restaurantId") !== restaurantId ||
        dish.get("isActive") === false || dish.get("active") === false || dish.get("mergedIntoDishId") ||
        restaurant.get("isActive") === false || restaurant.get("active") === false) {
      throw new HttpsError("not-found", "The public review source is unavailable.");
    }
    supportingReview = {reviewId, dishId, restaurantId, headline: publicText(review.headline, 200),
      notes: publicText(review.notes, 2000), textTruncated: (typeof review.headline === "string" && review.headline.trim().length > 200) ||
        (typeof review.notes === "string" && review.notes.trim().length > 2000)};
  }
  if (!profile && !supportingReview) throw new HttpsError("not-found", "This public reviewer is unavailable.");
  return {publicDisplayName: publicText(profile?.chosenUsername, 320) ?? publicText(profile?.publicDisplayName, 320) ??
    publicText(profile?.fallbackUsername, 320), supportingReview, capturedAt: FieldValue.serverTimestamp()};
}

export async function submitReviewerReportHandler(
  db: Firestore, request: CallableRequest<unknown>, nowMs = Date.now(),
): Promise<Data> {
  const data = requestData(request.data, ["schemaVersion", "expectedUserId", "targetUserId", "reason", "supportingReviewId", "requestId"]);
  const userId = actor(request, data, true), target = other(userId, data.targetUserId);
  if (typeof data.reason !== "string" || !reviewerReportReasons.includes(data.reason) ||
      typeof data.requestId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(data.requestId)) invalid();
  const reviewId = data.supportingReviewId === null ? null : sourceId(data.supportingReviewId);
  const fingerprint = hash([target, data.reason, reviewId]);
  const state = reviewerSafetyStatePath(userId);
  // Receipts make delayed retries idempotent even after an operator dismisses a
  // report. The per-target guard prevents races between different request IDs.
  // All are private children covered by account deletion, never growing arrays.
  const receiptRef = db.doc(`${state}/report_request_${hash(data.requestId)}`);
  const guardRef = db.doc(`${state}/report_pending_${hash(target)}`);
  const admissionRef = db.doc(`${state}/report_admission`);
  return db.runTransaction(async (tx) => {
    await requireAccountWritable(db, tx, userId);
    await requireAccountWritable(db, tx, target);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.get("fingerprint") !== fingerprint) throw new HttpsError("already-exists", "This request ID was already used.");
      return {schemaVersion: 1, reportId: receipt.get("reportId"), submitted: false};
    }
    const evidence = await publicEvidence(db, tx, target, reviewId);
    const [guard, admission] = await tx.getAll(guardRef, admissionRef);
    const previousId = guard.get("reportId");
    const previous = typeof previousId === "string" ? await tx.get(db.doc(`review_reports/${sourceId(previousId)}`)) : null;
    if (previous?.exists && (previous.get("reportScope") !== "reviewer" || previous.get("reportingUserId") !== userId || previous.get("reportedUserId") !== target)) {
      throw new HttpsError("failed-precondition", "Report admission needs recovery.");
    }
    const windowAtMs = admission.get("windowAtMs");
    const sameWindow = typeof windowAtMs === "number" && nowMs - windowAtMs < 60_000;
    const used = sameWindow ? reviewerSafetyRevision(admission.get("count")) : 0;
    if (used >= reviewerReportAdmissionLimit) throw new HttpsError("resource-exhausted", "Please wait before submitting another report.");
    const submitted = previous?.get("status") !== "pending";
    const reportId = submitted ? `reviewer_${hash([userId, data.requestId])}` : previous!.id;
    if (submitted) tx.create(db.doc(`review_reports/${reportId}`), {
      schemaVersion: 1, reportScope: "reviewer", id: reportId, reportingUserId: userId, reportedUserId: target,
      reason: data.reason, status: "pending", evidence, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(guardRef, {reportId, targetUserId: target});
    tx.create(receiptRef, {fingerprint, reportId, targetUserId: target});
    tx.set(admissionRef, {windowAtMs: sameWindow ? windowAtMs : nowMs, count: used + 1});
    return {schemaVersion: 1, reportId, submitted};
  });
}

async function setBlock(db: Firestore, request: CallableRequest<unknown>, blocked: boolean): Promise<Data> {
  const data = requestData(request.data, ["schemaVersion", "expectedUserId", "targetUserId", "expectedRevision", ...(blocked ? ["supportingReviewId"] : [])]);
  const userId = actor(request, data), target = other(userId, data.targetUserId);
  if (!Number.isSafeInteger(data.expectedRevision) || (data.expectedRevision as number) < 0) invalid();
  const reviewId = blocked && data.supportingReviewId !== null ? sourceId(data.supportingReviewId) : null;
  return db.runTransaction(async (tx) => {
    await requireAccountWritable(db, tx, userId);
    const prefRef = db.doc(reviewerSafetyPreferencesPath(userId)), blockRef = db.doc(reviewerBlockPath(userId, target));
    const [pref, existing] = await tx.getAll(prefRef, blockRef);
    const revision = reviewerSafetyRevision(pref.get("revision"));
    // A retry cannot reverse a later operation, including block -> unblock -> block.
    // Callers refresh status after any revision conflict.
    if (data.expectedRevision !== revision) {
      if (existing.exists === blocked) {
        return {schemaVersion: 1, targetUserId: target, blocked, revision};
      }
      throw new HttpsError("failed-precondition", "Reviewer preferences changed. Refresh to continue.");
    }
    if (blocked) await publicEvidence(db, tx, target, reviewId);
    if (existing.exists === blocked) return {schemaVersion: 1, targetUserId: target, blocked, revision};
    if (blocked) tx.create(blockRef, {schemaVersion: 1, targetUserId: target, createdAt: FieldValue.serverTimestamp()});
    else tx.delete(blockRef);
    tx.set(prefRef, {schemaVersion: 1, revision: revision + 1, updatedAt: FieldValue.serverTimestamp()});
    return {schemaVersion: 1, targetUserId: target, blocked, revision: revision + 1};
  });
}
export const blockReviewerHandler = (db: Firestore, request: CallableRequest<unknown>): Promise<Data> => setBlock(db, request, true);
export const unblockReviewerHandler = (db: Firestore, request: CallableRequest<unknown>): Promise<Data> => setBlock(db, request, false);

/** Point status only. Stage 2 may page the owner-readable block subcollection;
 * no full block-list download, public target lookup, or viewer filtering here. */
export async function getReviewerSafetyStatusHandler(db: Firestore, request: CallableRequest<unknown>): Promise<Data> {
  const data = requestData(request.data, ["schemaVersion", "expectedUserId", "targetUserId"]);
  const userId = actor(request, data), target = other(userId, data.targetUserId);
  return db.runTransaction(async (tx) => {
    await requireAccountWritable(db, tx, userId);
    const [pref, block] = await tx.getAll(db.doc(reviewerSafetyPreferencesPath(userId)), db.doc(reviewerBlockPath(userId, target)));
    return {schemaVersion: 1, targetUserId: target, blocked: block.exists, revision: reviewerSafetyRevision(pref.get("revision"))};
  });
}

/** Explicit public-evidence projection for the existing operator queue. */
export function reviewerReportAdminProjection(reportId: string, data: Data): Data | null {
  if (data.reportScope !== "reviewer" || data.schemaVersion !== 1 || typeof data.reportedUserId !== "string" ||
      typeof data.reportingUserId !== "string" || !data.evidence || typeof data.evidence !== "object") return null;
  const evidence = data.evidence as Data;
  const source = evidence.supportingReview as Data | null;
  const millis = (value: unknown): number | null => {
    const raw = value instanceof Date ? value.getTime() : value && typeof value === "object" &&
      "toMillis" in value && typeof value.toMillis === "function" ? value.toMillis() as number : null;
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : null;
  };
  return {kind: "reportedReviews", id: reportId, reportId, reportScope: "reviewer", schemaVersion: 1,
    reportingUserId: data.reportingUserId, reportedUserId: data.reportedUserId, reason: publicText(data.reason, 2000), status: data.status,
    reportCreatedAtMillis: millis(data.createdAt), reportUpdatedAtMillis: millis(data.updatedAt),
    evidence: {publicDisplayName: publicText(evidence.publicDisplayName, 320), capturedAtMillis: millis(evidence.capturedAt),
      supportingReview: source ? {reviewId: source.reviewId, dishId: source.dishId, restaurantId: source.restaurantId,
        headline: publicText(source.headline, 200), notes: publicText(source.notes, 2000), textTruncated: source.textTruncated === true} : null}};
}
