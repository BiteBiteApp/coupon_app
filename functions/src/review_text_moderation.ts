import {isCustomerBiteScorePublicReview} from "./customer_bitescore_reads.js";
import {createHash, randomUUID} from "node:crypto";
import {HttpsError} from "firebase-functions/v2/https";
import {requireAccountWritableInStore} from "./account_deletion_guard.js";
import {requireCustomerPostingAllowedInStore} from "./posting_restriction_guard.js";
import {ratingDishOperationLockPath, ratingRestaurantOperationLockPath} from "./rating_destructive_job_contract.js";
import {dishMergeReviewLockPath} from "./dish_proposal_private_contract.js";
import {reviewTextModel, reviewTextPolicy, validateReviewText, type ReviewTextProvider, type ReviewTextSignal} from "./review_text_provider.js";
import type {RatingDestructivePrivateDatabase as Database, RatingDestructivePrivateTransaction as Transaction} from "./rating_destructive_job_store.js";

type Data = Readonly<Record<string, unknown>>;
export const reviewTextRuntimePath = "private_bitescore_runtime/review_text";
export const reviewTextCollection = "private_bitescore_review_text";
export const reviewTextAdmissionCollection = "private_bitescore_review_text_admission";
export const reviewTextRuntimeCandidate = {required: false, processingEnabled: false,
  cleanupEnabled: false, retentionApproved: false, retentionSeconds: null, policyVersion: reviewTextPolicy};
export function textPath(reviewId: string): string { return `${reviewTextCollection}/${reviewId}`; }
export function textMillis(value: unknown): number {
  return value instanceof Date ? value.getTime() :
    value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function" ? value.toMillis() : 0;
}
export function exactTextId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 1500 || value.trim() !== value || /[\/\x00-\x1f]/.test(value) || value === "." || value === "..") {
    throw new HttpsError("invalid-argument", "Invalid review identity.");
  }
  return value;
}
export type TextAttempt = {reviewId: string; version: string; attemptId: string; headline: string; notes: string};
type PreparedText = {fields: {headline: string | null; notes: string | null; textRevision?: unknown}; status: string; attempt?: TextAttempt};
const digest = (headline: string, notes: string) => createHash("sha256").update(JSON.stringify([headline, notes])).digest("hex");
export function currentTextProposal(proposal: Data, review: Data | undefined): boolean {
  return review !== undefined && review.textRevision === proposal.version &&
    review.id === proposal.reviewId && review.userId === proposal.userId &&
    review.dishId === proposal.dishId && review.restaurantId === proposal.restaurantId;
}
/** Called after aggregate/identity/permission reads, in the SAME rating transaction. */
export async function prepareReviewText(tx: Transaction, input: {
  reviewId: string; dishId: string; restaurantId: string; userId: string; headline: string; notes: string;
}, existing: Data | undefined, now: Date): Promise<PreparedText> {
  const runtime = (await tx.getDocument(reviewTextRuntimePath))?.data;
  const headline = input.headline.trim(), notes = input.notes.trim();
  if (!runtime || runtime.required === false) return {fields: {headline: headline || null, notes: notes || null}, status: "legacy"};
  // Existing malformed enforcement records fail closed, including when processing is paused.
  if (runtime.required !== true || runtime.policyVersion !== reviewTextPolicy || runtime.retentionApproved !== true || runtime.cleanupEnabled !== true ||
      !Number.isSafeInteger(runtime.retentionSeconds) || (runtime.retentionSeconds as number) < 1 ||
      (runtime.retentionSeconds as number) > 31536000) {
    throw new HttpsError("failed-precondition", "Review text moderation configuration requires approval.");
  }
  try { validateReviewText(headline, notes); }
  catch { throw new HttpsError("invalid-argument", "Use at most 200 headline characters and 4,000 review characters."); }
  const prior = (await tx.getDocument(textPath(input.reviewId)))?.data;
  const contentDigest = digest(headline, notes);
  const matches = prior && currentTextProposal(prior, existing);
  if (matches && prior.contentDigest === contentDigest &&
      textMillis(prior.expiresAt) > now.getTime() &&
      (prior.status === "screening_failed" || (prior.status === "screening" && textMillis(prior.attemptLeaseUntil) <= now.getTime())) && runtime.processingEnabled === true &&
      Number(prior.attemptCount) < 2 && now.getTime() - textMillis(prior.lastAttemptAt ?? prior.createdAt) >= 60000) {
    const path = `${reviewTextAdmissionCollection}/${input.userId}`;
    const admission = (await tx.getDocument(path))?.data;
    const window = Math.floor(now.getTime() / 60000);
    const count = admission?.window === window && typeof admission.count === "number" ? admission.count : 0;
    if (count < 6) {
      tx.setDocument(path, {userId: input.userId, window, count: count + 1});
      const attemptId = randomUUID();
      tx.setDocument(textPath(input.reviewId), {...prior, status: "screening", attemptId, attemptLeaseUntil: new Date(now.getTime() + 20000), attemptCount: Number(prior.attemptCount) + 1, lastAttemptAt: now});
      return {fields: {headline: typeof existing?.headline === "string" ? existing.headline : null,
        notes: typeof existing?.notes === "string" ? existing.notes : null, textRevision: prior.version},
        status: "screening", attempt: {reviewId: input.reviewId, version: String(prior.version), attemptId, headline, notes}};
    }
  }
  if (matches && prior.contentDigest === contentDigest &&
      (textMillis(prior.expiresAt) > now.getTime() || ["published", "rejected"].includes(String(prior.status)))) {
    return {fields: {headline: typeof existing?.headline === "string" ? existing.headline : null, notes: typeof existing?.notes === "string" ? existing.notes : null, textRevision: prior.version}, status: prior.status === "screening" && textMillis(prior.attemptLeaseUntil) <= now.getTime() ? "screening_failed" : String(prior.status)};
  }
  const version = randomUUID();
  const fields = {headline: headline ? typeof existing?.headline === "string" ? existing.headline : null : null,
    notes: notes ? typeof existing?.notes === "string" ? existing.notes : null : null, textRevision: version};
  if ((!headline && !notes) || (headline === (existing?.headline ?? "") && notes === (existing?.notes ?? ""))) {
    tx.deleteDocument(textPath(input.reviewId));
    return {fields: {...fields, headline: headline || null, notes: notes || null}, status: "published"};
  }
  const admissionPath = `${reviewTextAdmissionCollection}/${input.userId}`;
  const admission = (await tx.getDocument(admissionPath))?.data;
  const window = Math.floor(now.getTime() / 60000);
  const count = admission?.window === window && typeof admission.count === "number" ? admission.count : 0;
  // Rating still commits when screening is busy. A new version may be retried by the author later.
  const admitted = count < 6 && runtime.processingEnabled === true;
  const status = admitted ? "screening" : "screening_failed";
  const attemptId = randomUUID();
  tx.setDocument(admissionPath, {userId: input.userId, window, count: count + 1});
  tx.setDocument(textPath(input.reviewId), {schemaVersion: 1, reviewId: input.reviewId,
    dishId: input.dishId, restaurantId: input.restaurantId, userId: input.userId, headline, notes,
    version, contentDigest, status, policyVersion: reviewTextPolicy, requestedModel: reviewTextModel,
    createdAt: now, lastAttemptAt: now, expiresAt: new Date(now.getTime() + (runtime.retentionSeconds as number) * 1000),
    attemptId, attemptLeaseUntil: new Date(now.getTime() + 20000),
    attemptCount: admitted ? 1 : 0, failure: admitted ? null : "paused_or_busy"});
  return {fields, status, ...(admitted ? {attempt: {reviewId: input.reviewId, version, attemptId, headline, notes}} : {})};
}
async function publicationAllowed(tx: Transaction, proposal: Data, now: Date): Promise<boolean> {
  const uid = exactTextId(proposal.userId), dishId = exactTextId(proposal.dishId), restaurantId = exactTextId(proposal.restaurantId);
  await requireAccountWritableInStore(tx, uid);
  await requireCustomerPostingAllowedInStore(tx, uid, now.getTime());
  const [dish, restaurant, dishLock, restaurantLock, mergeLock] = await Promise.all([
    tx.getDocument(`bitescore_dishes/${dishId}`), tx.getDocument(`bitescore_restaurants/${restaurantId}`),
    tx.getDocument(ratingDishOperationLockPath(dishId)), tx.getDocument(ratingRestaurantOperationLockPath(restaurantId)),
    tx.getDocument(dishMergeReviewLockPath(dishId)),
  ]);
  return !!dish && !!restaurant && dish.data.id === dishId && dish.data.restaurantId === restaurantId &&
    dish.data.isActive !== false && !dish.data.mergedIntoDishId && restaurant.data.isActive !== false && restaurant.data.active !== false &&
    !dishLock && !restaurantLock && !mergeLock && textMillis(proposal.expiresAt) > now.getTime();
}
function withoutWords(proposal: Data, status: string, now: Date): Data {
  const {headline: _h, notes: _n, expiresAt: _expires, attemptLeaseUntil: _lease, ...rest} = proposal;
  return {...rest, status, decidedAt: now};
}
/** Never changes ratings, updatedAt, aggregate contribution, photos or votes. */
export async function finishReviewText(database: Database, attempt: TextAttempt,
  signal: ReviewTextSignal | null, now: Date): Promise<string> {
  return database.runTransaction(async tx => {
    const [stored, review, runtime] = await Promise.all([
      tx.getDocument(textPath(attempt.reviewId)), tx.getDocument(`dish_reviews/${attempt.reviewId}`), tx.getDocument(reviewTextRuntimePath),
    ]);
    const p = stored?.data;
    if (!p || p.version !== attempt.version || p.attemptId !== attempt.attemptId || p.status !== "screening" || !currentTextProposal(p, review?.data)) return "superseded";
    let allowed = false;
    try { allowed = isCustomerBiteScorePublicReview(review!.data) && await publicationAllowed(tx, p, now); } catch { /* fences hold words */ }
    if (textMillis(p.expiresAt) <= now.getTime()) {
      tx.setDocument(textPath(attempt.reviewId), withoutWords(p, "expired", now)); return "expired";
    }
    const processing = runtime?.data.required === true && runtime.data.processingEnabled === true && runtime.data.retentionApproved === true && runtime.data.cleanupEnabled === true && runtime.data.policyVersion === reviewTextPolicy;
    const status = !signal || !allowed || !processing ? "screening_failed" : signal.flagged ? "pending" : "published";
    const updated = {...p, status, ...(signal ? {signal} : {}), screenedAt: now};
    tx.setDocument(textPath(attempt.reviewId), status === "published" ? withoutWords(updated, status, now) : updated);
    if (status === "published") tx.setDocument(`dish_reviews/${attempt.reviewId}`, {headline: p.headline || null, notes: p.notes || null}, {merge: true});
    return status;
  });
}
export async function screenReviewText(database: Database, attempt: TextAttempt,
  provider: ReviewTextProvider | undefined, now: () => Date): Promise<string> {
  let signal: ReviewTextSignal | null = null;
  try { signal = await provider?.screen(attempt.headline, attempt.notes) ?? null; } catch { /* no content/provider errors in logs */ }
  return finishReviewText(database, attempt, signal, now());
}
export async function decideReviewText(database: Database, actorUid: string,
  reviewId: string, version: string, approve: boolean, now: Date): Promise<void> {
  await database.runTransaction(async tx => {
    await requireAccountWritableInStore(tx, actorUid);
    const [stored, review] = await Promise.all([tx.getDocument(textPath(reviewId)), tx.getDocument(`dish_reviews/${reviewId}`)]);
    const p = stored?.data;
    if (!p || p.version !== version || !["pending", "screening_failed", "screening"].includes(String(p.status)) ||
        !currentTextProposal(p, review?.data) || textMillis(p.expiresAt) <= now.getTime()) {
      throw new HttpsError("failed-precondition", "This text proposal is no longer current. Refresh the queue.");
    }
    if (approve && (!isCustomerBiteScorePublicReview(review!.data) || !await publicationAllowed(tx, p, now))) throw new HttpsError("failed-precondition", "This review cannot be published now.");
    if (!approve) await requireAccountWritableInStore(tx, exactTextId(p.userId));
    tx.setDocument(textPath(reviewId), {...withoutWords(p, approve ? "published" : "rejected", now), decidedBy: actorUid});
    if (approve) tx.setDocument(`dish_reviews/${reviewId}`, {headline: p.headline || null, notes: p.notes || null}, {merge: true});
  });
}
/** A delayed deletion event only removes a proposal that does not match CURRENT source. */
export async function reconcileReviewText(database: Database, reviewId: string): Promise<void> {
  await database.runTransaction(async tx => {
    const [stored, review] = await Promise.all([tx.getDocument(textPath(reviewId)), tx.getDocument(`dish_reviews/${reviewId}`)]);
    if (stored && !currentTextProposal(stored.data, review?.data)) tx.deleteDocument(textPath(reviewId));
  });
}
