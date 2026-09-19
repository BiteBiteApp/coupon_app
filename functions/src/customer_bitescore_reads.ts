import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { FieldValue, type Firestore, type Query } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { buildBiteSaverRestaurantIndex, biteScoreRestaurantIsActive } from "./search_index_builders.js";
import { customerPublicMenuEntry } from "./customer_bitesaver_search_session.js";
import { biteSaverAccountCatalogBindingState, biteScoreCatalogBindingState } from "./restaurant_invite_helpers.js";
import { ratingDishOperationLockPath, ratingRestaurantOperationLockPath } from "./rating_destructive_job_contract.js";
import { dishMergeReviewLockPath } from "./dish_proposal_private_contract.js";
import { HttpsError } from "firebase-functions/v2/https";
import { OpaqueCursorCodec } from "./opaque_cursor.js";
import { createQueryFingerprint } from "./query_fingerprint.js";
import { createSearchIndexDocumentId } from "./search_index_contract.js";
import { readBiteScoreCatalogRestaurantId } from "./restaurant_invite_helpers.js";
import { readCustomerBiteScorePublicProjection, customerBiteScoreUtf16Key } from "./customer_bitescore_search_contract.js";

import { customerBiteScoreProfileGenerationPath, nextCustomerBiteScoreProfileGeneration } from "./customer_bitescore_profile_generation.js";

export const customerBiteScoreImageIndex = "private_bitescore_image_state";
export const customerBiteScoreReviewIndex = "private_bitescore_review_index";
export const customerBiteScoreReviewStats = "private_bitescore_review_stats";
export const customerBiteScoreFeedbackAccounting = "private_bitescore_feedback_accounting";
export const customerBiteScoreReadGeneration = "private_bitescore_read_generations";
export const customerBiteScoreReviewerStats = "private_bitescore_reviewer_stats";
export const customerBiteScoreReadPageSize = 25;
export type CustomerBiteScoreReadContext = Readonly<{
  actorId: string;
  cursorCodec: OpaqueCursorCodec;
  userId?: string | null;
  isAdmin?: boolean;
}>;
type Data = Record<string, unknown>;
export const customerBiteScoreReviewSorts = ["Most helpful", "Most recent", "Highest score", "Lowest score"] as const;

function data(value: unknown): Data {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpsError("invalid-argument", "Invalid BiteScore request.");
  }
  return value as Data;
}
function id(value: unknown): string {
  const result = readBiteScoreCatalogRestaurantId(value);
  if (result === null || result !== value) throw new HttpsError("invalid-argument", "Invalid BiteScore identity.");
  return result;
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function millis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}
function count(value: unknown): number { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0; }
function text(value: unknown, max = 200000): string | null { return typeof value === "string" && value.length <= max ? value : null; }
export function isCustomerBiteScorePublicReview(source: Data): boolean {
  return source.isPublic !== false && source.isHidden !== true && source.hidden !== true && source.deleted !== true && source.rejected !== true && !["hidden", "deleted", "rejected"].includes(String(source.status ?? "").trim().toLowerCase());
}

/** Pure allowlist. Document identity always overrides any embedded id field. */
export function buildCustomerBiteScoreReview(reviewId: string, source: Data | null, stats: Data = {}): Data | null {
  if (!source || readBiteScoreCatalogRestaurantId(reviewId) !== reviewId) return null;
  for (const field of ["dishId", "restaurantId", "userId"]) {
    if (readBiteScoreCatalogRestaurantId(source[field]) !== source[field]) return null;
  }
  if (typeof source.overallImpression !== "number" || !Number.isFinite(source.overallImpression) || typeof source.overallBiteScore !== "number" || !Number.isFinite(source.overallBiteScore)) return null;
  const headline = text(source.headline);
  const notes = text(source.notes);
  const helpfulCount = count(stats.helpfulCount);
  const notHelpfulCount = count(stats.notHelpfulCount);
  const review: Data = {
    id: reviewId, dishId: source.dishId, restaurantId: source.restaurantId, userId: source.userId,
    headline, notes, overallImpression: source.overallImpression, overallBiteScore: source.overallBiteScore,
    createdAtMs: millis(source.createdAt), createdAtMicros: timestampMicros(source.createdAt), updatedAtMs: millis(source.updatedAt),
  };
  for (const field of ["tastinessScore", "qualityScore", "valueScore"]) {
    review[field] = typeof source[field] === "number" && Number.isFinite(source[field]) ? source[field] : null;
  }
  return {reviewId, dishId: source.dishId, restaurantId: source.restaurantId, userId: source.userId,
    publicVisible: isCustomerBiteScorePublicReview(source), writtenText: Boolean(headline?.trim() || notes?.trim()),
    helpfulScore: helpfulCount - notHelpfulCount, helpfulCount, notHelpfulCount,
    createdAtMs: review.createdAtMs, createdAtMicros: timestampMicros(source.createdAt), overallBiteScore: review.overallBiteScore,
    reviewOrder0: customerBiteScoreUtf16Key(reviewId).subarray(0, 1500),
    reviewOrder1: customerBiteScoreUtf16Key(reviewId).subarray(1500), review};
}

/** Reads latest source inside the transaction, so duplicate/delayed events converge. */
export async function reconcileCustomerBiteScoreReview(db: Firestore, reviewId: string): Promise<void> {
  id(reviewId);
  const key = hash(reviewId);
  await db.runTransaction(async (tx) => {
    const [source, old, stats] = await tx.getAll(db.doc(`dish_reviews/${reviewId}`), db.doc(`${customerBiteScoreReviewIndex}/${key}`), db.doc(`${customerBiteScoreReviewStats}/${key}`));
    const next = buildCustomerBiteScoreReview(reviewId, source.exists ? source.data() as Data : null, stats.data());
    const previous = old.data();
    if (isDeepStrictEqual(previous ?? null, next)) return;
    const dishIds = new Set([previous?.dishId, next?.dishId].filter((value): value is string => typeof value === "string"));
    const userIds = new Set([previous?.userId, next?.userId].filter((value): value is string => typeof value === "string"));
    const generationRefs = [...dishIds].map((value) => db.doc(`${customerBiteScoreReadGeneration}/${hash(value)}`));
    const userRefs = [...userIds].map((value) => db.doc(`${customerBiteScoreReviewerStats}/${hash(value)}`));
    const profileRefs = [...userIds].map((value) => db.doc(customerBiteScoreProfileGenerationPath(value)));
    const snapshots = await tx.getAll(...generationRefs, ...userRefs, ...profileRefs);
    profileRefs.forEach((ref, i) => tx.set(ref, nextCustomerBiteScoreProfileGeneration(snapshots[generationRefs.length + userRefs.length + i].data())));
    generationRefs.forEach((ref, i) => tx.set(ref, {...snapshots[i].data(), generation: count(snapshots[i].data()?.generation) + 1}));
    [...userIds].forEach((userId, i) => {
      const delta = (next?.userId === userId && next.publicVisible ? 1 : 0) - (previous?.userId === userId && previous.publicVisible ? 1 : 0);
      const helpfulDelta = (next?.userId === userId && next.publicVisible ? count(next.helpfulCount) : 0) - (previous?.userId === userId && previous.publicVisible ? count(previous.helpfulCount) : 0);
      tx.set(userRefs[i], {publicReviewCount: Math.max(0, count(snapshots[generationRefs.length + i].data()?.publicReviewCount) + delta),
        publicHelpfulVotesReceived: Math.max(0, count(snapshots[generationRefs.length + i].data()?.publicHelpfulVotesReceived) + helpfulDelta)});
    });
    if (next) tx.set(old.ref, next); else tx.delete(old.ref);
  });
}

/** Per-vote accounting applies only the difference from the latest persisted vote. */
export async function reconcileCustomerBiteScoreFeedback(db: Firestore, voteId: string): Promise<void> {
  id(voteId);
  await db.runTransaction(async (tx) => {
    const accounting = db.doc(`${customerBiteScoreFeedbackAccounting}/${hash(voteId)}`);
    const [source, old] = await tx.getAll(db.doc(`review_feedback_votes/${voteId}`), accounting);
    const raw = source.data();
    const reviewId = raw && readBiteScoreCatalogRestaurantId(raw.reviewId);
    const next = reviewId && ["helpful", "not_helpful"].includes(raw?.voteType) ? {reviewId, voteType: raw!.voteType as string} : null;
    const previous = old.data();
    if (isDeepStrictEqual(previous ?? null, next)) return;
    const reviewIds = [...new Set([previous?.reviewId, next?.reviewId].filter((value): value is string => typeof value === "string"))];
    const refs = reviewIds.flatMap((value) => [db.doc(`${customerBiteScoreReviewStats}/${hash(value)}`), db.doc(`${customerBiteScoreReviewIndex}/${hash(value)}`)]);
    const snaps = refs.length ? await tx.getAll(...refs) : [];
    const dishes = [...new Set(snaps.filter((_, i) => i % 2 === 1).map((snap) => snap.data()?.dishId).filter((v): v is string => typeof v === "string"))];
    const generations = dishes.length ? await tx.getAll(...dishes.map((value) => db.doc(`${customerBiteScoreReadGeneration}/${hash(value)}`))) : [];
    const authorDeltas = new Map<string, number>();
    reviewIds.forEach((value, i) => {
      const index = snaps[i * 2 + 1].data();
      if (index?.publicVisible === true && typeof index.userId === "string") {
        const delta = (next?.reviewId === value && next.voteType === "helpful" ? 1 : 0) - (previous?.reviewId === value && previous.voteType === "helpful" ? 1 : 0);
        authorDeltas.set(index.userId, (authorDeltas.get(index.userId) ?? 0) + delta);
      }
    });
    const authorIds = [...authorDeltas.keys()];
    const authorStats = authorIds.length ? await tx.getAll(...authorIds.map((value) => db.doc(`${customerBiteScoreReviewerStats}/${hash(value)}`))) : [];
    reviewIds.forEach((value, i) => {
      const oldStats = snaps[i * 2].data() ?? {};
      const delta = (type: string) => (next?.reviewId === value && next.voteType === type ? 1 : 0) - (previous?.reviewId === value && previous.voteType === type ? 1 : 0);
      const helpfulCount = Math.max(0, count(oldStats.helpfulCount) + delta("helpful"));
      const notHelpfulCount = Math.max(0, count(oldStats.notHelpfulCount) + delta("not_helpful"));
      tx.set(refs[i * 2], {helpfulCount, notHelpfulCount});
      if (snaps[i * 2 + 1].exists) tx.update(refs[i * 2 + 1], {helpfulCount, notHelpfulCount, helpfulScore: helpfulCount - notHelpfulCount});
    });
    authorStats.forEach((snap, i) => tx.set(snap.ref, {publicReviewCount: count(snap.data()?.publicReviewCount),
      publicHelpfulVotesReceived: Math.max(0, count(snap.data()?.publicHelpfulVotesReceived) + authorDeltas.get(authorIds[i])!)}));
    generations.forEach((snap) => tx.set(snap.ref, {...snap.data(), generation: count(snap.data()?.generation) + 1}));
    if (next) tx.set(accounting, next); else tx.delete(accounting);
  });
}

export async function readCustomerBiteScoreProjection(db: Firestore, kind: "dish" | "restaurant", documentId: string): Promise<Data> {
  const indexId = createSearchIndexDocumentId({entityKind: kind, sourceKind: kind === "dish" ? "biteScoreDish" : "biteScoreRestaurant", sourceDocumentId: id(documentId)});
  const snap = await db.doc(`${kind === "dish" ? "dish_search_index" : "restaurant_search_index"}/${indexId}`).get();
  const result = readCustomerBiteScorePublicProjection(snap.exists ? {id: snap.id, path: snap.ref.path, data: snap.data()!} : null, kind);
  if (!result) throw new HttpsError("not-found", "This BiteScore content is unavailable.");
  const source = await db.doc(`${kind === "dish" ? "bitescore_dishes" : "bitescore_restaurants"}/${documentId}`).get();
  const current = source.data();
  if (!current || (kind === "restaurant" && !biteScoreRestaurantIsActive(current)) || current.isActive === false || current.active === false ||
      (kind === "dish" && (current.restaurantId !== result.restaurantSourceDocumentId || Boolean(current.mergedIntoDishId)))) {
    throw new HttpsError("not-found", "This BiteScore content is unavailable.");
  }
  return result;
}
export async function getCustomerBiteScoreDetailHandler(db: Firestore, raw: unknown, context: CustomerBiteScoreReadContext): Promise<Data> {
  const request = data(raw);
  const kind = request.kind;
  if (kind !== "dish" && kind !== "restaurant") throw new HttpsError("invalid-argument", "Invalid detail kind.");
  const documentId = id(request.id);
  const value = await readCustomerBiteScoreProjection(db, kind, documentId);
  const restaurant = kind === "restaurant" ? value : await readCustomerBiteScoreProjection(db, "restaurant", id(value.restaurantSourceDocumentId));
  const root = await db.doc(`bitescore_restaurants/${restaurant.sourceDocumentId}`).get();
  if (!root.exists || !biteScoreRestaurantIsActive(root.data()!)) throw new HttpsError("not-found", "This restaurant is unavailable.");
  const userId = context.userId;
  const favorite = userId ? await db.doc(`user_profiles/${id(userId)}/${kind === "dish" ? "favorite_dishes" : "favorite_restaurants"}/${documentId}`).get() : null;
  const imageCount = kind === "dish" ? count((await db.doc(`${customerBiteScoreReadGeneration}/${hash(documentId)}`).get()).data()?.publicImageCount) : 0;
  return {kind, restaurant, ...(kind === "dish" ? {dish: value, imageCount} : {}), isFavorite: favorite?.exists ?? false,
    canManage: context.isAdmin === true || Boolean(userId && root.data()?.ownerUserId === userId)};
}

function reviewOrder(sort: string): readonly (readonly [string, "asc" | "desc"])[] {
  if (sort === "Most helpful") return [["writtenText", "desc"], ["helpfulScore", "desc"], ["createdAtMicros", "desc"], ["reviewOrder0", "asc"], ["reviewOrder1", "asc"]];
  if (sort === "Highest score" || sort === "Lowest score") return [["overallBiteScore", sort === "Highest score" ? "desc" : "asc"], ["createdAtMicros", "desc"], ["reviewOrder0", "asc"], ["reviewOrder1", "asc"]];
  return [["createdAtMicros", "desc"], ["reviewOrder0", "asc"], ["reviewOrder1", "asc"]];
}
export async function pageCustomerBiteScoreReviewsHandler(db: Firestore, raw: unknown, context: CustomerBiteScoreReadContext): Promise<Data> {
  const request = data(raw);
  const dishId = id(request.dishId);
  const sort = request.sort ?? "Most helpful";
  if (typeof sort !== "string" || !customerBiteScoreReviewSorts.includes(sort as typeof customerBiteScoreReviewSorts[number])) throw new HttpsError("invalid-argument", "Invalid review order.");
  const dish = await readCustomerBiteScoreProjection(db, "dish", dishId);
  await readCustomerBiteScoreProjection(db, "restaurant", id(dish.restaurantSourceDocumentId));
  const generationRef = db.doc(`${customerBiteScoreReadGeneration}/${hash(dishId)}`);
  const generation = count((await generationRef.get()).data()?.generation);
  const binding = {queryFingerprint: createQueryFingerprint({dishId, sort, generation}), source: "customerBiteScoreReads", searchMode: "dishReviews", pageSize: customerBiteScoreReadPageSize, callerBinding: hash(context.actorId)};
  let query: Query = db.collection(customerBiteScoreReviewIndex).where("dishId", "==", dishId).where("publicVisible", "==", true);
  for (const [field, direction] of reviewOrder(sort)) query = query.orderBy(field, direction);
  if (request.targetReviewId != null) {
    if (request.cursor != null) throw new HttpsError("invalid-argument", "A review target is only valid on the initial page.");
    const target = await db.doc(`${customerBiteScoreReviewIndex}/${hash(id(request.targetReviewId))}`).get();
    if (!target.exists || target.data()?.dishId !== dishId || target.data()?.restaurantId !== dish.restaurantSourceDocumentId || target.data()?.publicVisible !== true) throw new HttpsError("not-found", "This review is unavailable.");
    query = query.startAt(target);
  }
  if (request.cursor !== undefined && request.cursor !== null) {
    const cursor = context.cursorCodec.decode(request.cursor as string, {...binding, purposes: ["forward"]});
    const key = cursor.sortTuple[0];
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) throw new HttpsError("invalid-argument", "Invalid review cursor.");
    const last = await db.doc(`${customerBiteScoreReviewIndex}/${key}`).get();
    if (!last.exists || last.data()?.dishId !== dishId) throw new HttpsError("failed-precondition", "Reviews changed. Refresh to continue.");
    query = query.startAfter(last);
  }
  const snapshot = await query.limit(customerBiteScoreReadPageSize + 1).get();
  const selected = snapshot.docs.slice(0, customerBiteScoreReadPageSize);
  const sources = selected.length ? await db.getAll(...selected.map((doc) => db.doc(`dish_reviews/${doc.data().reviewId}`))) : [];
  const users = [...new Set(selected.map((doc) => id(doc.data().userId)))];
  const metadata = await readReviewerMetadata(db, users);
  const items: Data[] = [];
  for (let i = 0; i < selected.length; i++) {
    const indexed = selected[i].data();
    const latest = sources[i].data();
    // Never disclose stale hidden/deleted text while asynchronous projections catch up.
    if (!latest || !isCustomerBiteScorePublicReview(latest) || latest.dishId !== dishId || latest.restaurantId !== dish.restaurantSourceDocumentId || latest.userId !== indexed.userId) continue;
    const safe = buildCustomerBiteScoreReview(indexed.reviewId, latest, indexed);
    if (!safe) continue;
    if (!isDeepStrictEqual(safe.review, indexed.review)) {
      throw new HttpsError("failed-precondition", "Reviews changed. Refresh to continue.");
    }
    const ownVoteId = context.userId ? readBiteScoreCatalogRestaurantId(indexed.reviewId + "_" + context.userId) : null;
    const ownVote = ownVoteId ? await db.doc(`review_feedback_votes/${ownVoteId}`).get() : null;
    const reviewImages = await imageQuery(db, dishId, false).where("reviewId", "==", indexed.reviewId).limit(1).get();
    const reviewImage = reviewImages.docs[0];
    let image: Data | null = null;
    if (reviewImage) {
      const imageId = id(reviewImage.data().imageId);
      const source = (await db.doc(`bitescore_dish_images/${imageId}`).get()).data();
      image = source ? customerBiteScoreImage(imageId, source, dishId, id(dish.restaurantSourceDocumentId)) : null;
      if (image && !isDeepStrictEqual(image, reviewImage.data().image)) throw new HttpsError("failed-precondition", "Images changed. Refresh to continue.");
    }
    const reports = context.userId ? await db.collection("review_reports").where("reviewId", "==", indexed.reviewId).where("reportingUserId", "==", context.userId).where("status", "==", "pending").limit(1).get() : null;
    items.push({review: safe.review, helpfulCount: indexed.helpfulCount, notHelpfulCount: indexed.notHelpfulCount,
      currentUserVoteType: ownVote?.data()?.userId === context.userId && ownVote?.data()?.reviewId === indexed.reviewId ? ownVote?.data()?.voteType ?? null : null,
      hasPendingUserReport: Boolean(reports && !reports.empty), reviewer: metadata.get(indexed.userId), image});
  }
  await readCustomerBiteScoreProjection(db, "dish", dishId);
  await readCustomerBiteScoreProjection(db, "restaurant", id(dish.restaurantSourceDocumentId));
  if (count((await generationRef.get()).data()?.generation) !== generation) throw new HttpsError("failed-precondition", "Reviews changed. Refresh to continue.");
  const last = selected[selected.length - 1];
  return {items, nextCursor: snapshot.docs.length > customerBiteScoreReadPageSize && last ? context.cursorCodec.encode({...binding, purpose: "forward", sortTuple: [last.id]}) : null};
}

/** Images expose only customer display fields, never uploader or storage metadata. */
export function customerBiteScoreImage(imageId: string, source: Data, dishId: string, restaurantId: string): Data | null {
  if (source.dishId !== dishId || source.restaurantId !== restaurantId) return null;
  const publicImage = customerPublicMenuEntry({key: imageId, kind: "menu_images", privateSourceIdentities: typeof source.uploadedByUserId === "string" ? [source.uploadedByUserId] : [], document: {id: imageId, path: `bitescore_dish_images/${imageId}`, data: {...source, sortOrder: source.sortOrder ?? 0}}});
  if (publicImage?.kind !== "image") return null;
  return {id: imageId, dishId, restaurantId, reviewId: typeof source.reviewId === "string" ? source.reviewId : null,
    imageUrl: publicImage.imageUrl, sortOrder: publicImage.sortOrder, helpfulCount: count(source.helpfulCount), notHelpfulCount: count(source.notHelpfulCount), createdAtMs: millis(source.createdAt), createdAtMicros: timestampMicros(source.createdAt)};
}
function imageQuery(db: Firestore, dishId: string, helpful = true): Query {
  let query: Query = db.collection(customerBiteScoreImageIndex).where("dishId", "==", dishId);
  if (helpful) query = query.orderBy("helpfulCount", "desc");
  return query.orderBy("sortOrder").orderBy("createdAtMicros").orderBy("imageOrder0").orderBy("imageOrder1");
}
function timestampMicros(value: unknown): number {
  if (value instanceof Timestamp) return value.seconds * 1_000_000 + Math.floor(value.nanoseconds / 1000);
  return millis(value) * 1000;
}
function imageRank(a: Data, b: Data): number {
  return (b.helpfulCount as number) - (a.helpfulCount as number) || (a.sortOrder as number) - (b.sortOrder as number) ||
    (a.createdAtMicros as number) - (b.createdAtMicros as number) || (String(a.imageId) < String(b.imageId) ? -1 : String(a.imageId) > String(b.imageId) ? 1 : 0);
}
export async function pageCustomerBiteScoreImagesHandler(db: Firestore, raw: unknown, context: CustomerBiteScoreReadContext): Promise<Data> {
  const request = data(raw);
  const dishId = id(request.dishId);
  const dish = await readCustomerBiteScoreProjection(db, "dish", dishId);
  const restaurantId = id(dish.restaurantSourceDocumentId);
  await readCustomerBiteScoreProjection(db, "restaurant", restaurantId);
  const generationRef = db.doc(`${customerBiteScoreReadGeneration}/${hash(dishId)}`);
  const imageGeneration = count((await generationRef.get()).data()?.imageGeneration);
  const binding = {queryFingerprint: createQueryFingerprint({dishId, imageGeneration}), source: "customerBiteScoreReads", searchMode: "dishImages", pageSize: customerBiteScoreReadPageSize, callerBinding: hash(context.actorId)};
  let query = imageQuery(db, dishId);
  if (request.cursor != null) {
    const cursor = context.cursorCodec.decode(request.cursor as string, {...binding, purposes: ["forward"]});
    const key = cursor.sortTuple[0];
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/u.test(key)) throw new HttpsError("invalid-argument", "Invalid image cursor.");
    const last = await db.doc(`${customerBiteScoreImageIndex}/${key}`).get();
    if (!last.exists || last.data()?.dishId !== dishId) throw new HttpsError("failed-precondition", "Images changed. Refresh to continue.");
    query = query.startAfter(last);
  }
  const snapshot = await query.limit(customerBiteScoreReadPageSize + 1).get();
  const selected = snapshot.docs.slice(0, customerBiteScoreReadPageSize);
  const sources = selected.length ? await db.getAll(...selected.map((doc) => db.doc(`bitescore_dish_images/${id(doc.data().imageId)}`))) : [];
  const items: Data[] = [];
  selected.forEach((doc, i) => {
    const source = sources[i].data();
    const safe = source ? customerBiteScoreImage(doc.data().imageId, source, dishId, restaurantId) : null;
    if (!safe) return;
    if (!isDeepStrictEqual(safe, doc.data().image)) throw new HttpsError("failed-precondition", "Images changed. Refresh to continue.");
    items.push(safe);
  });
  const last = selected[selected.length - 1];
  await readCustomerBiteScoreProjection(db, "dish", dishId);
  await readCustomerBiteScoreProjection(db, "restaurant", restaurantId);
  if (count((await generationRef.get()).data()?.imageGeneration) !== imageGeneration) throw new HttpsError("failed-precondition", "Images changed. Refresh to continue.");
  return {items, nextCursor: snapshot.docs.length > customerBiteScoreReadPageSize && last ? context.cursorCodec.encode({...binding, purpose: "forward", sortTuple: [last.id]}) : null};
}

/** Current-source, idempotent image projection and primary/count maintenance. */
export async function reconcileCustomerBiteScoreImage(db: Firestore, imageId: string): Promise<void> {
  id(imageId);
  await db.runTransaction(async (tx) => {
    const stateRef = db.doc(`${customerBiteScoreImageIndex}/${hash(imageId)}`);
    const [source, previous, runtime] = await tx.getAll(db.doc(`bitescore_dish_images/${imageId}`), stateRef, db.doc("private_bitescore_runtime/aggregation"));
    const activation = runtime.data();
    const publishEpoch = activation?.enabled === true ? activation.epoch : null;
    if (activation?.enabled === true && (activation.version !== 1 || typeof publishEpoch !== "string" || !publishEpoch.length || publishEpoch.length > 128)) throw new HttpsError("failed-precondition", "Invalid BiteScore activation.");
    const raw = source.data();
    const dishId = raw && readBiteScoreCatalogRestaurantId(raw.dishId);
    const restaurantId = raw && readBiteScoreCatalogRestaurantId(raw.restaurantId);
    const safe = raw && dishId && restaurantId ? customerBiteScoreImage(imageId, raw, dishId, restaurantId) : null;
    let next: Data | null = safe ? {imageId, dishId, restaurantId, reviewId: safe.reviewId, image: safe, publishEpoch,
      helpfulCount: safe.helpfulCount, sortOrder: safe.sortOrder, createdAtMicros: timestampMicros(raw!.createdAt),
      imageOrder0: customerBiteScoreUtf16Key(imageId).subarray(0, 1500), imageOrder1: customerBiteScoreUtf16Key(imageId).subarray(1500)} : null;
    const old = previous.data();
    if (isDeepStrictEqual(old ?? null, next)) return;
    const parents = [...new Set([old?.dishId, next?.dishId].filter((v): v is string => typeof v === "string"))];
    const snapshots = parents.length ? await tx.getAll(...parents.flatMap((value) => [db.doc(`${customerBiteScoreReadGeneration}/${hash(value)}`), db.doc(`bitescore_dishes/${value}`)])) : [];
    if (next) {
      const parentIndex = parents.indexOf(String(next.dishId));
      if (!snapshots[parentIndex * 2 + 1].exists || snapshots[parentIndex * 2 + 1].data()?.restaurantId !== next.restaurantId) next = null;
    }
    const retiredParents = new Set<string>();
    for (const [i, parent] of parents.entries()) {
      const dish = snapshots[i * 2 + 1];
      const current = dish.data();
      const parentRestaurantId = readBiteScoreCatalogRestaurantId(current?.restaurantId);
      const refs = [db.doc(ratingDishOperationLockPath(parent)), db.doc(dishMergeReviewLockPath(parent))];
      if (parentRestaurantId) refs.push(db.doc(ratingRestaurantOperationLockPath(parentRestaurantId)), db.doc(`bitescore_restaurants/${parentRestaurantId}`));
      const [dishLock, proposalLock, restaurantLock, restaurant] = await tx.getAll(...refs);
      const retired = !dish.exists || !parentRestaurantId || !restaurant?.exists ||
        !biteScoreRestaurantIsActive(restaurant.data()!) || current?.isActive === false || current?.active === false ||
        (typeof current?.mergedIntoDishId === "string" && current.mergedIntoDishId.trim().length > 0) ||
        dishLock.data()?.permanent === true || restaurantLock?.data()?.permanent === true || proposalLock.data()?.state === "merged_source";
      if (retired) {
        retiredParents.add(parent);
        if (next?.dishId === parent) next = null;
      } else if (publishEpoch !== null && (dishLock.exists || restaurantLock?.exists ||
          proposalLock.data()?.blocksClientReviews === true || proposalLock.data()?.blocksClientAggregates === true)) {
        // Retry the event after the established destructive-operation lock is
        // released. No projection/accounting writes commit ahead of publication.
        throw new HttpsError("unavailable", "Dish images are temporarily locked. Retry after the operation completes.");
      }
    }
    const winners: (Data | undefined)[] = [];
    for (const parent of parents) {
      // At most one row is replaced. The best two existing rows contain the
      // best unaffected candidate; merge the new row before choosing globally.
      const current = await tx.get(imageQuery(db, parent).limit(2));
      const candidates = current.docs.filter((doc) => doc.id !== stateRef.id).map((doc) => doc.data());
      if (next?.dishId === parent) candidates.push(next);
      winners.push(candidates.sort(imageRank)[0]);
    }
    parents.forEach((parent, i) => {
      const generation = snapshots[i * 2]; const dish = snapshots[i * 2 + 1];
      const delta = (next?.dishId === parent ? 1 : 0) - (old?.dishId === parent && old.image ? 1 : 0);
      const imageCount = Math.max(0, count(generation.data()?.publicImageCount) + delta);
      tx.set(generation.ref, {...generation.data(), publicImageCount: imageCount, imageGeneration: count(generation.data()?.imageGeneration) + 1});
      if (publishEpoch !== null && dish.exists && !retiredParents.has(parent)) {
        const winner = winners[i]?.image as Data | undefined;
        const current = dish.data()!;
        if (current.imageCount !== imageCount || (current.primaryImageId ?? null) !== (winner?.id ?? null) || (current.primaryImageUrl ?? null) !== (winner?.imageUrl ?? null)) {
          tx.update(dish.ref, {imageCount, primaryImageId: winner?.id ?? FieldValue.delete(), primaryImageUrl: winner?.imageUrl ?? FieldValue.delete(), updatedAt: FieldValue.serverTimestamp()});
        }
      }
    });
    if (next) tx.set(stateRef, next); else tx.delete(stateRef);
  });
}

// Fixed established expert taxonomy; one bounded multi-get per author, no collection download.
const badgeIds = ["burger", "pizza", "wings", "ramen", "donuts", "chinese", "japanese_sushi", "steak", "mexican", "seafood", "italian", "bbq", "hot_dogs_corn_dogs", "chili", "mac_and_cheese", "meatloaf", "chicken_pie", "chicken_sandwich", "fried_chicken", "cuban", "subs_sandwiches"];
export async function readReviewerMetadata(db: Firestore, userIds: readonly string[]): Promise<Map<string, Data>> {
  const result = new Map<string, Data>();
  const refs = userIds.flatMap((userId) => [db.doc(`public_reviewer_profiles/${userId}`), db.doc(`${customerBiteScoreReviewerStats}/${hash(userId)}`), ...badgeIds.map((badgeId) => db.doc(`user_profiles/${userId}/local_expert_badges/${badgeId}`))]);
  const all = [];
  for (let start = 0; start < refs.length; start += 100) all.push(...await db.getAll(...refs.slice(start, start + 100)));
  for (let authorIndex = 0; authorIndex < userIds.length; authorIndex++) {
    const userId = userIds[authorIndex];
    const snapshots = all.slice(authorIndex * (badgeIds.length + 2), (authorIndex + 1) * (badgeIds.length + 2));
    const profile = snapshots[0].data();
    let seed = 0;
    for (let i = 0; i < userId.length; i++) seed = (seed * 31 + userId.charCodeAt(i)) & 0x7fffffff;
    const badges: Data[] = [];
    for (const snapshot of snapshots.slice(2)) {
      const source = snapshot.data();
      if (!source) continue;
      const badge: Data = {};
      for (const field of ["expertTypeId", "displayName", "level", "totalRestaurantCount", "localClusterRestaurantCount", "qualificationMethod"]) {
        if (typeof source[field] === "string" || typeof source[field] === "number") badge[field] = source[field];
      }
      badge.earnedAtMs = millis(source.earnedAt);
      badge.updatedAtMs = millis(source.updatedAt);
      badges.push(badge);
    }
    result.set(userId, {userId, displayName: text(profile?.publicDisplayName, 100) ?? text(profile?.chosenUsername, 100) ?? text(profile?.fallbackUsername, 100) ?? `anon${1 + seed % 900000}`,
      publicReviewCount: count(snapshots[1].data()?.publicReviewCount), publicHelpfulVotesReceived: count(snapshots[1].data()?.publicHelpfulVotesReceived), badges});
  }
  return result;
}

export async function biteScoreMenuSource(db: Firestore, restaurantId: string): Promise<{root: string | null; style: string; fingerprint: string; privateIds: string[]}> {
  await readCustomerBiteScoreProjection(db, "restaurant", restaurantId);
  const score = (await db.doc(`bitescore_restaurants/${restaurantId}`).get()).data()!;
  if (!biteScoreRestaurantIsActive(score)) throw new HttpsError("not-found", "This restaurant is unavailable.");
  const ownerId = typeof score.ownerUserId === "string" ? score.ownerUserId : "";
  if (score.menuSourceSide === "biteSaver") {
    const accountId = id(score.linkedBiteSaverUid);
    const account = (await db.doc(`restaurant_accounts/${accountId}`).get()).data();
    if (!account || buildBiteSaverRestaurantIndex({sourceDocumentId: accountId, source: account, now: new Date()})?.publicVisible !== true) throw new HttpsError("not-found", "This menu is unavailable.");
    const a = biteSaverAccountCatalogBindingState(account);
    const b = biteScoreCatalogBindingState(score);
    if (!(score.isClaimed === true && ownerId === accountId) && !(a.type === "bound" && b.type === "bound" && a.biteScoreCatalogRestaurantId === restaurantId && a.biteSaverCatalogBindingId === b.biteSaverCatalogBindingId)) throw new HttpsError("failed-precondition", "The menu relationship changed.");
    if (account.menuSourceSide === "biteScore") throw new HttpsError("failed-precondition", "The menu relationship changed.");
    return {root: `restaurant_accounts/${accountId}`, style: "biteSaver", fingerprint: createQueryFingerprint({restaurantId, accountId, ownerId, revision: score.restaurantWriteRevision ?? null, binding: score.biteSaverCatalogBindingId ?? null}), privateIds: [accountId, ownerId]};
  }
  if (score.menuSourceSide != null && score.menuSourceSide !== "biteScore") throw new HttpsError("failed-precondition", "The menu relationship changed.");
  const menuId = score.sharedMenuId == null ? null : id(score.sharedMenuId);
  const fingerprint = createQueryFingerprint({restaurantId, menuId, ownerId, revision: score.restaurantWriteRevision ?? null});
  if (menuId === null) return {root: null, style: "biteScore", fingerprint, privateIds: [ownerId]};
  const menu = (await db.doc(`restaurant_menus/${menuId}`).get()).data();
  if (score.isClaimed !== true || !ownerId || !menu || menu.bitescoreRestaurantId !== restaurantId || menu.createdByUserId !== ownerId) throw new HttpsError("failed-precondition", "The menu relationship changed.");
  return {root: `restaurant_menus/${menuId}`, style: "biteScore", fingerprint, privateIds: [ownerId, menuId]};
}
