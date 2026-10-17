import {FieldPath, type Firestore} from "firebase-admin/firestore";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {requireRestaurantAccountAdminAccess} from "./admin_authorization.js";
import {requireAccountWritable} from "./account_deletion_guard.js";
import {createFirestoreRatingDestructivePrivateDatabase} from "./rating_destructive_job_store.js";
import {currentTextProposal, decideReviewText, exactTextId, reviewTextCollection, reviewTextRuntimePath, textMillis, textPath} from "./review_text_moderation.js";

function actor(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === "anonymous") throw new HttpsError("unauthenticated", "Sign in to continue.");
  const data = request.data as Record<string, unknown> | undefined;
  if (!data || data.schemaVersion !== 1 || data.expectedUserId !== uid) throw new HttpsError("permission-denied", "Your account changed. Please try again.");
  return uid;
}
export async function listReviewTextHandler(db: Firestore, request: CallableRequest<unknown>, now = new Date()) {
  requireRestaurantAccountAdminAccess(request);
  const uid = actor(request), data = request.data as Record<string, unknown>;
  const cursor = data.cursor == null ? null : exactTextId(data.cursor);
  return db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, uid);
    let query = db.collection(reviewTextCollection).where("status", "in", ["pending", "screening_failed", "screening"]).orderBy(FieldPath.documentId()).limit(25);
    if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query);
    const reviews = page.empty ? [] : await tx.getAll(...page.docs.map(p => db.doc(`dish_reviews/${p.id}`)));
    const items = page.docs.flatMap((doc, index) => {
      const p = doc.data();
      if (!currentTextProposal(p, reviews[index].data()) || textMillis(p.expiresAt) <= now.getTime()) return [];
      return [{reviewId: doc.id, dishId: p.dishId, restaurantId: p.restaurantId, userId: p.userId,
        version: p.version, status: p.status === "screening" && textMillis(p.attemptLeaseUntil) <= now.getTime() ? "screening_failed" : p.status, headline: p.headline, notes: p.notes,
        createdAtMillis: textMillis(p.createdAt), expiresAtMillis: textMillis(p.expiresAt),
        signal: p.signal ?? null, policyVersion: p.policyVersion}];
    });
    return {schemaVersion: 1, items, nextCursor: page.size === 25 ? page.docs[page.docs.length - 1].id : null};
  });
}
export async function decideReviewTextHandler(db: Firestore, request: CallableRequest<unknown>) {
  requireRestaurantAccountAdminAccess(request);
  const uid = actor(request), data = request.data as Record<string, unknown>;
  if (!["approve", "reject"].includes(String(data.action))) throw new HttpsError("invalid-argument", "Choose approve or reject.");
  await decideReviewText(createFirestoreRatingDestructivePrivateDatabase(db), uid,
    exactTextId(data.reviewId), exactTextId(data.version), data.action === "approve", new Date());
  return {schemaVersion: 1, status: data.action === "approve" ? "published" : "rejected"};
}
export async function getOwnReviewTextHandler(db: Firestore, request: CallableRequest<unknown>, now = new Date()) {
  const uid = actor(request), data = request.data as Record<string, unknown>;
  const reviewId = exactTextId(data.reviewId);
  return db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, uid);
    const [stored, review] = await tx.getAll(db.doc(textPath(reviewId)), db.doc(`dish_reviews/${reviewId}`));
    const p = stored.data();
    if (!p || p.userId !== uid || review.get("userId") !== uid || !currentTextProposal(p, review.data())) return {schemaVersion: 1, proposal: null};
    const expired = !["published", "rejected"].includes(p.status) && textMillis(p.expiresAt) <= now.getTime();
    return {schemaVersion: 1, proposal: {reviewId, version: p.version, status: expired ? "expired" : p.status === "screening" && textMillis(p.attemptLeaseUntil) <= now.getTime() ? "screening_failed" : p.status,
      headline: expired ? null : p.headline ?? null, notes: expired ? null : p.notes ?? null}};
  });
}
/** No chosen retention default: only deadlines created under an owner-approved configuration. */
export async function expireReviewTexts(db: Firestore, now = new Date()): Promise<number> {
  const config = await db.doc(reviewTextRuntimePath).get();
  if (config.get("cleanupEnabled") !== true || config.get("retentionApproved") !== true) return 0;
  const page = await db.collection(reviewTextCollection).where("expiresAt", "<=", now).orderBy("expiresAt").limit(25).get();
  for (const doc of page.docs) await db.runTransaction(async tx => {
    const current = await tx.get(doc.ref);
    if (current.exists && textMillis(current.get("expiresAt")) <= now.getTime()) tx.delete(doc.ref);
  });
  return page.size;
}
