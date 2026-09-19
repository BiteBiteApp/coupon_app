import {type Firestore, type Transaction} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {requireAuthenticatedRestaurantAccountActor, requireRestaurantAccountAdminAccess} from "./admin_authorization.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {ratingDishOperationLockPath, ratingRestaurantOperationLockPath} from "./rating_destructive_job_contract.js";
import {dishMergeReviewLockPath} from "./dish_proposal_private_contract.js";
import {biteScoreReviewAggregationRuntimePath} from "./bitescore_review_aggregate.js";
import {customerBiteScoreImage} from "./customer_bitescore_reads.js";
import {biteScoreRestaurantIsActive} from "./search_index_builders.js";

type Data = Record<string, unknown>;
export type CustomerBiteScoreUploadedObject = Readonly<{
  bucket: string; name: string; size: number; contentType: string; downloadTokens: readonly string[];
}>;
export type CustomerBiteScorePhotoOptions = Readonly<{
  now?: Date;
  readUploadedObject?: (storagePath: string) => Promise<CustomerBiteScoreUploadedObject>;
}>;
function exact(value: unknown): string {
  const result = readBiteScoreCatalogRestaurantId(value);
  if (result === null || result !== value) throw new HttpsError("invalid-argument", "Invalid photo identity.");
  return result;
}
function parse(raw: unknown, keys: readonly string[]): Data {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify([...keys].sort()) || (raw as Data).schemaVersion !== 1) {
    throw new HttpsError("invalid-argument", "Invalid photo request.");
  }
  return raw as Data;
}
function signedActor(request: CallableRequest<unknown>) {
  const value = requireAuthenticatedRestaurantAccountActor(request);
  if (value.uid !== request.auth?.uid || readBiteScoreCatalogRestaurantId(value.uid) !== value.uid) {
    throw new HttpsError("unauthenticated", "A valid signed-in user is required.");
  }
  return value;
}
function actor(request: CallableRequest<unknown>, allowAdmin: boolean): string {
  const value = signedActor(request);
  if (!value.emailVerified) {
    if (!allowAdmin) throw new HttpsError("permission-denied", "Verify your email before voting.");
    requireRestaurantAccountAdminAccess(request);
  }
  return value.uid;
}
async function uploadedObject(storagePath: string): Promise<CustomerBiteScoreUploadedObject> {
  const bucket = getStorage().bucket();
  const [value] = await bucket.file(storagePath).getMetadata();
  return {bucket: bucket.name, name: value.name ?? "", size: Number(value.size), contentType: value.contentType ?? "",
    downloadTokens: String(value.metadata?.firebaseStorageDownloadTokens ?? "").split(",")};
}
function storageIdentity(value: Data, dishId: string): {storagePath: string; imageUrl: string; bucket: string; token: string} {
  if (typeof value.storagePath !== "string" || typeof value.imageUrl !== "string" || value.imageUrl.length > 4096) {
    throw new HttpsError("invalid-argument", "Invalid uploaded image.");
  }
  // Match the existing immutable dish upload layout without normalizing IDs or
  // accepting a different catalog parent through a sanitized path alias.
  const prefix = `bitescore_dishes/${dishId}/images/`;
  const fileName = value.storagePath.slice(prefix.length);
  if (!value.storagePath.startsWith(prefix) || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/.test(fileName)) {
    throw new HttpsError("invalid-argument", "Image storage does not match this dish.");
  }
  let url: URL;
  try { url = new URL(value.imageUrl); } catch { throw new HttpsError("invalid-argument", "Invalid uploaded image URL."); }
  const parts = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
  let bucket = "", object = "";
  try { if (parts) {bucket = decodeURIComponent(parts[1]); object = decodeURIComponent(parts[2]);} } catch { /* reject below */ }
  const token = url.searchParams.get("token");
  if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com" || url.port || url.username || url.password || url.hash ||
      !bucket || object !== value.storagePath || url.searchParams.get("alt") !== "media" || !token ||
      [...url.searchParams.keys()].some((key) => key !== "alt" && key !== "token") ||
      url.searchParams.getAll("alt").length !== 1 || url.searchParams.getAll("token").length !== 1) {
    throw new HttpsError("invalid-argument", "Image URL does not match its uploaded object.");
  }
  return {storagePath: value.storagePath, imageUrl: value.imageUrl, bucket, token};
}
async function parent(
  db: Firestore, tx: Transaction, dishId: string, restaurantId: string,
): Promise<Data> {
  const [runtime, dish, restaurant, dishLock, restaurantLock, mergeLock] = await tx.getAll(
    db.doc(biteScoreReviewAggregationRuntimePath), db.doc(`bitescore_dishes/${dishId}`), db.doc(`bitescore_restaurants/${restaurantId}`),
    db.doc(ratingDishOperationLockPath(dishId)), db.doc(ratingRestaurantOperationLockPath(restaurantId)), db.doc(dishMergeReviewLockPath(dishId)),
  );
  const enabled = runtime.data();
  if (enabled?.enabled !== true || enabled.version !== 1 || typeof enabled.epoch !== "string" || !enabled.epoch.length || enabled.epoch.length > 128) {
    throw new HttpsError("failed-precondition", "Trusted BiteScore photos are not enabled.");
  }
  const value = dish.data();
  if (!value || value.restaurantId !== restaurantId || value.isActive === false || value.active === false ||
      Boolean(value.mergedIntoDishId) || !restaurant.exists || !biteScoreRestaurantIsActive(restaurant.data()!)) {
    throw new HttpsError("failed-precondition", "This dish is unavailable.");
  }
  if (dishLock.exists || restaurantLock.exists || mergeLock.data()?.blocksClientReviews === true ||
      mergeLock.data()?.blocksClientAggregates === true || mergeLock.data()?.state === "merged_source") {
    throw new HttpsError("unavailable", "Dish photos are temporarily locked.");
  }
  return value;
}
function safeImage(imageId: string, source: Data, dishId: string, restaurantId: string): Data {
  const image = customerBiteScoreImage(imageId, source, dishId, restaurantId);
  if (!image) throw new HttpsError("failed-precondition", "This photo is unavailable.");
  return image;
}
function count(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new HttpsError("failed-precondition", "Invalid photo count.");
  return value as number;
}

/** Authenticated metadata publication for an already uploaded immutable image.
 * No Storage write/delete or contribution-point behavior is introduced here. */
export async function createCustomerBiteScorePhotoHandler(
  db: Firestore, request: CallableRequest<unknown>, options: CustomerBiteScorePhotoOptions = {},
): Promise<Data> {
  const userId = actor(request, true);
  const value = parse(request.data, ["schemaVersion", "expectedUserId", "imageId", "dishId", "restaurantId", "reviewId", "imageUrl", "storagePath", "mode"]);
  if (value.expectedUserId !== userId) throw new HttpsError("permission-denied", "The signed-in account changed.");
  const imageId = exact(value.imageId), dishId = exact(value.dishId), restaurantId = exact(value.restaurantId);
  const reviewId = value.reviewId === null ? null : exact(value.reviewId);
  if (!["review", "missing", "gallery"].includes(String(value.mode)) || (value.mode !== "review" && reviewId !== null)) {
    throw new HttpsError("invalid-argument", "Invalid photo operation.");
  }
  const upload = storageIdentity(value, dishId);
  let object: CustomerBiteScoreUploadedObject;
  try { object = await (options.readUploadedObject ?? uploadedObject)(upload.storagePath); }
  catch { throw new HttpsError("failed-precondition", "The uploaded image is unavailable."); }
  if (object.bucket !== upload.bucket || object.name !== upload.storagePath || !Number.isSafeInteger(object.size) || object.size <= 0 ||
      object.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(object.contentType) || !object.downloadTokens.includes(upload.token)) {
    throw new HttpsError("failed-precondition", "The uploaded image is invalid.");
  }
  const now = options.now ?? new Date();
  return db.runTransaction(async (tx) => {
    const dish = await parent(db, tx, dishId, restaurantId);
    const imageRef = db.doc(`bitescore_dish_images/${imageId}`);
    const existing = await tx.get(imageRef);
    if (reviewId !== null) {
      const review = await tx.get(db.doc(`dish_reviews/${reviewId}`));
      if (review.data()?.userId !== userId || review.data()?.dishId !== dishId || review.data()?.restaurantId !== restaurantId) {
        throw new HttpsError("permission-denied", "The review does not belong to this user and dish.");
      }
    }
    if (existing.exists) {
      const source = existing.data()!;
      if (source.uploadedByUserId !== userId || source.dishId !== dishId || source.restaurantId !== restaurantId ||
          (source.reviewId ?? null) !== reviewId || source.imageUrl !== upload.imageUrl || source.storagePath !== upload.storagePath) {
        throw new HttpsError("already-exists", "This photo identity is already in use.");
      }
      return {schemaVersion: 1, image: safeImage(imageId, source, dishId, restaurantId)};
    }
    const imageCount = count(dish.imageCount);
    const primaryImageUrl = typeof dish.primaryImageUrl === "string" && dish.primaryImageUrl.trim() ? dish.primaryImageUrl : null;
    if (value.mode === "missing" && (imageCount > 0 || primaryImageUrl !== null)) {
      throw new HttpsError("failed-precondition", "This dish already has an image.");
    }
    const source = {id: imageId, dishId, restaurantId, reviewId, uploadedByUserId: userId, imageUrl: upload.imageUrl,
      storagePath: upload.storagePath, sortOrder: 0, helpfulCount: 0, notHelpfulCount: 0, createdAt: now, updatedAt: now};
    const image = safeImage(imageId, source, dishId, restaurantId);
    tx.set(imageRef, source);
    tx.update(db.doc(`bitescore_dishes/${dishId}`), {imageCount: imageCount + 1, updatedAt: now,
      ...(primaryImageUrl === null ? {primaryImageUrl: upload.imageUrl, primaryImageId: imageId} : {})});
    return {schemaVersion: 1, image};
  });
}

/** Same toggle semantics and own vote identity as the existing client, with
 * source image/parent checks and both counter deltas in one trusted transaction. */
export async function toggleCustomerBiteScorePhotoVoteHandler(
  db: Firestore, request: CallableRequest<unknown>, options: Pick<CustomerBiteScorePhotoOptions, "now"> = {},
): Promise<Data> {
  const userId = actor(request, false);
  const value = parse(request.data, ["schemaVersion", "expectedUserId", "imageId", "dishId", "restaurantId", "voteType"]);
  if (value.expectedUserId !== userId) throw new HttpsError("permission-denied", "The signed-in account changed.");
  const imageId = exact(value.imageId), dishId = exact(value.dishId), restaurantId = exact(value.restaurantId);
  const voteType = value.voteType;
  if (voteType !== "helpful" && voteType !== "notHelpful") throw new HttpsError("invalid-argument", "Invalid photo vote.");
  const now = options.now ?? new Date();
  return db.runTransaction(async (tx) => {
    await parent(db, tx, dishId, restaurantId);
    const imageRef = db.doc(`bitescore_dish_images/${imageId}`);
    const voteRef = db.doc(`bitescore_dish_image_votes/${imageId}_${userId}`);
    const [image, vote] = await tx.getAll(imageRef, voteRef);
    const source = image.data();
    if (!source || source.dishId !== dishId || source.restaurantId !== restaurantId) throw new HttpsError("failed-precondition", "This photo is unavailable.");
    safeImage(imageId, source, dishId, restaurantId);
    const old = vote.data();
    if (old && (old.userId !== userId || old.imageId !== imageId || old.dishId !== dishId || old.restaurantId !== restaurantId || !["helpful", "notHelpful"].includes(String(old.voteType)))) {
      throw new HttpsError("failed-precondition", "The photo vote does not match its target.");
    }
    const next = old?.voteType === voteType ? null : voteType;
    const delta = (type: string) => Number(next === type) - Number(old?.voteType === type);
    const helpfulCount = Math.max(0, count(source.helpfulCount) + delta("helpful"));
    const notHelpfulCount = Math.max(0, count(source.notHelpfulCount) + delta("notHelpful"));
    if (next === null) tx.delete(voteRef);
    else tx.set(voteRef, {id: voteRef.id, imageId, dishId, restaurantId, userId, voteType: next, createdAt: old?.createdAt ?? now, updatedAt: now});
    tx.update(imageRef, {helpfulCount, notHelpfulCount, updatedAt: now});
    return {schemaVersion: 1, image: safeImage(imageId, {...source, helpfulCount, notHelpfulCount, updatedAt: now}, dishId, restaurantId), currentUserVoteType: next};
  });
}
