import {FieldPath, type Firestore} from "firebase-admin/firestore";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {requireRestaurantAccountAdminAccess} from "./admin_authorization.js";
import {requireAccountWritable} from "./account_deletion_guard.js";
import {createFirestoreRatingDestructivePrivateDatabase} from "./rating_destructive_job_store.js";
import {currentTextProposal, decideReviewText, exactTextId, reviewTextCollection, reviewTextRuntimePath, textMillis, textPath, reviewTextDeadline, reviewTextStatus, validReviewTextConfiguration, withoutWords, textReceiptPath, reviewTextReceipt} from "./review_text_moderation.js";

function actor(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === "anonymous") throw new HttpsError("unauthenticated", "Sign in to continue.");
  const data = request.data as Record<string, unknown> | undefined;
  if (!data || data.schemaVersion !== 1 || data.expectedUserId !== uid) throw new HttpsError("permission-denied", "Your account changed. Please try again.");
  return uid;
}
export async function listReviewTextHandler(db: Firestore, request: CallableRequest<unknown>, time: Date | (() => Date) = () => new Date()) {
  requireRestaurantAccountAdminAccess(request);
  const clock = typeof time === "function" ? time : () => time;
  const uid = actor(request), data = request.data as Record<string, unknown>;
  const cursor = data.cursor == null ? null : exactTextId(data.cursor);
  return db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, uid);
    let query = db.collection(reviewTextCollection).where("status", "in", ["pending", "screening_failed", "screening"]).orderBy(FieldPath.documentId()).limit(25);
    if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query);
    const reviews = page.empty ? [] : await tx.getAll(...page.docs.map(p => db.doc(`dish_reviews/${p.id}`)));
    const now = clock();
    const items = page.docs.flatMap((doc, index) => {
      const p = doc.data();
      if (!currentTextProposal(p, reviews[index].data()) || reviewTextDeadline(p) <= now.getTime()) return [];
      return [{reviewId: doc.id, dishId: p.dishId, restaurantId: p.restaurantId, userId: p.userId,
        version: p.version, status: reviewTextStatus(p, now), headline: p.headline, notes: p.notes,
        createdAtMillis: textMillis(p.createdAt), expiresAtMillis: reviewTextDeadline(p),
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
    exactTextId(data.reviewId), exactTextId(data.version), data.action === "approve", () => new Date());
  return {schemaVersion: 1, status: data.action === "approve" ? "published" : "rejected"};
}
export async function getOwnReviewTextHandler(db: Firestore, request: CallableRequest<unknown>, time: Date | (() => Date) = () => new Date()) {
  const clock = typeof time === "function" ? time : () => time;
  const uid = actor(request), data = request.data as Record<string, unknown>;
  const reviewId = exactTextId(data.reviewId);
  return db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, uid);
    const [stored, receipt, review] = await tx.getAll(db.doc(textPath(reviewId)), db.doc(textReceiptPath(reviewId)), db.doc(`dish_reviews/${reviewId}`));
    const p = stored.data();
    // TTL may remove the entire private proposal before the bounded worker.
    // Absence does not prove approval, rejection, or that public words changed.
    if (!p && receipt.exists && receipt.get("userId") === uid && currentTextProposal(receipt.data()!, review.data())) {
      const status = ["published", "rejected"].includes(receipt.get("status")) ? receipt.get("status") : "expired";
      return {schemaVersion: 1, proposal: {reviewId, version: receipt.get("version"), status, headline: null, notes: null}};
    }
    if (!p || p.userId !== uid || review.get("userId") !== uid || !currentTextProposal(p, review.data())) return {schemaVersion: 1, proposal: null};
    const now = clock();
    const status = reviewTextStatus(p, now), expired = status === "expired";
    return {schemaVersion: 1, proposal: {reviewId, version: p.version, status,
      createdAtMillis: textMillis(p.createdAt), expiresAtMillis: ["published", "rejected", "expired"].includes(status) ? null : reviewTextDeadline(p),
      headline: expired ? null : p.headline ?? null, notes: expired ? null : p.notes ?? null}};
  });
}
/** Existing bounded worker, with TTL as the scalable asynchronous backstop. */
export async function expireReviewTexts(db: Firestore, now = new Date()): Promise<number> {
  const config = await db.doc(reviewTextRuntimePath).get();
  if (!validReviewTextConfiguration(config.data())) return 0;
  const page = await db.collection(reviewTextCollection).where("expiresAt", "<=", now).orderBy("expiresAt").limit(25).get();
  for (const doc of page.docs) await db.runTransaction(async tx => {
    const current = await tx.get(doc.ref);
    if (current.exists && textMillis(current.get("expiresAt")) <= now.getTime() && reviewTextDeadline(current.data()!) <= now.getTime()) {
      tx.set(doc.ref, withoutWords(current.data()!, "expired", now));
      // Synthetic/legacy malformed records can be purged without inventing identity.
      if (typeof current.get("contentDigest") === "string") {
        tx.set(db.doc(textReceiptPath(doc.id)), reviewTextReceipt({...current.data()!, status: "expired"}));
      }
    }
  });
  return page.size;
}
