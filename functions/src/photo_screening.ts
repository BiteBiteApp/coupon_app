import {requireBiteScoreTermsInFirestore, type ApprovedBiteScoreTerms} from "./bitescore_terms.js";
import {reservePhotoScreening} from "./photo_screening_admission.js";
import {awardPublishedDishImageContributionPoints} from "./contribution_points_helpers.js";
import {createHash, randomUUID} from "node:crypto";
import {getAuth} from "firebase-admin/auth";
import {getStorage} from "firebase-admin/storage";
import {FieldPath, type Firestore, type Transaction} from "firebase-admin/firestore";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {requireRestaurantAccountAdminAccess} from "./admin_authorization.js";
import {requireAccountWritable} from "./account_deletion_guard.js";
import {requireCustomerPostingAllowed} from "./posting_restriction_guard.js";
import {actor, exact, parse, parent, safeImage, count} from "./customer_bitescore_photos.js";
import {classifySafeSearch, parseSafeSearch, GoogleSafeSearchProvider, type PhotoScreeningProvider} from "./photo_screening_provider.js";
import {screeningRuntimePath, screeningCollection, dayMs, pendingRetentionMs, failureRetentionDays, photoExpired,
  terminalFields, terminalPhotoStates, uploadMetadata, millis, cleanupScreeningPhoto, type ScreeningCleanupObjects} from "./photo_screening_retention.js";
export {screeningRuntimePath, screeningCollection} from "./photo_screening_retention.js";

type Data = Record<string, any>;
export const screeningPolicyVersion = "conservative-hold-v1";
const maxBytes = 5 * 1024 * 1024, leaseMs = 120_000, maxAttempts = 2;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const ownerKey = (uid: string) => hash(`bitestar.dish-upload.v1:${uid}`);
export interface ScreeningObjects {
  put(path: string, bytes: Buffer, contentType: string, metadata: Record<string, string>): Promise<string>;
  read(path: string, generation: string, sha256: string): Promise<{bytes: Buffer; contentType: string}>;
  url(path: string): string;
}
export function screeningObjects(): ScreeningObjects {
  const bucket = getStorage().bucket();
  async function read(path: string, generation: string, sha256: string) {
    const file = bucket.file(path), [before] = await file.getMetadata();
    if (String(before.generation) !== generation || Number(before.size) > maxBytes || Number(before.size) <= 0) throw new Error("Image generation changed");
    const [bytes] = await file.download();
    const [after] = await file.getMetadata();
    // Current-only read, checked on both sides, avoids SDK generation Number
    // conversion. Digest proves exact screened bytes even during replacement.
    if (String(after.generation) !== generation || hash(bytes) !== sha256) throw new Error("Image bytes changed");
    return {bytes, contentType: before.contentType ?? "application/octet-stream"};
  }
  return {
    async put(path, bytes, contentType, metadata) {
      const file = bucket.file(path);
      try {
        await file.save(bytes, {resumable: false, preconditionOpts: {ifGenerationMatch: 0},
          metadata: {contentType, cacheControl: "private, no-store, max-age=0", metadata}});
      } catch (e) { if ((e as {code?: number}).code !== 412) throw e; }
      const [object] = await file.getMetadata();
      if (object.metadata?.firebaseStorageDownloadTokens || Object.entries(metadata).some(([k, v]) => object.metadata?.[k] !== v) || object.contentType !== contentType) throw new Error("Invalid private object");
      const generation = String(object.generation);
      if (!/^[1-9][0-9]*$/.test(generation)) throw new Error("Invalid generation");
      await read(path, generation, hash(bytes));
      return generation;
    }, read,
    url: path => `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`,
  };
}
export type ScreeningOptions = {
  approvedTerms?: ApprovedBiteScoreTerms | null;
  now?: () => number; objects?: ScreeningObjects; provider?: PhotoScreeningProvider;
  identity?: (uid: string) => Promise<string>;
  providerTimeoutMs?: number;
  cleanupObjects?: ScreeningCleanupObjects;
};
async function identity(uid: string, options: ScreeningOptions): Promise<string> {
  if (options.identity) return options.identity(uid);
  try { const user = await getAuth().getUser(uid); if (!user.disabled) return user.metadata.creationTime; } catch { /* neutral */ }
  throw new HttpsError("failed-precondition", "This account is unavailable.");
}
function requireRuntime(data: Data | undefined, admission: boolean): void {
  if (data?.required !== true || data.policyVersion !== screeningPolicyVersion || data.retentionApproved !== true ||
      (admission && (data.enabled !== true || data.cleanupEnabled !== true || failureRetentionDays(data) === null || !Number.isSafeInteger(data.monthlyAllowance) || data.monthlyAllowance <= 0))) {
    throw new HttpsError("unavailable", "Photographs cannot be checked right now. Please try later.");
  }
}
async function eligible(db: Firestore, tx: Transaction, value: Data, now: number, options: ScreeningOptions): Promise<Data> {
  await requireAccountWritable(db, tx, value.ownerUserId);
  await requireCustomerPostingAllowed(db, tx, value.ownerUserId, now);
  await requireBiteScoreTermsInFirestore(db, tx, value.ownerUserId, options.approvedTerms, new Date(now));
  const dish = await parent(db, tx, value.dishId, value.restaurantId);
  if (value.reviewId !== null) {
    const review = await tx.get(db.doc(`dish_reviews/${value.reviewId}`));
    if (review.get("userId") !== value.ownerUserId || review.get("dishId") !== value.dishId || review.get("restaurantId") !== value.restaurantId) {
      throw new HttpsError("failed-precondition", "The associated review is unavailable.");
    }
  }
  return dish;
}
function response(record: Data, source?: Data): Data {
  const state = source?.moderationStatus === "removed" || (record.state === "approved" && !source) ? "removed" : record.state;
  return {schemaVersion: 1, imageId: record.imageId, state, cleanupStatus: record.cleanupStatus ?? null,
    ...(state === "approved" && source ? {image: safeImage(record.imageId, source, record.dishId, record.restaurantId)} : {})};
}
function imageSource(record: Data, url: string, now: number): Data {
  return {id: record.imageId, dishId: record.dishId, restaurantId: record.restaurantId, reviewId: record.reviewId,
    uploadedByUserId: record.ownerUserId, originalUploaderUid: record.ownerUserId, ownershipVersion: 1,
    imageUrl: url, storagePath: record.storagePath, storageGeneration: record.generation, screeningStatus: "approved",
    sortOrder: 0, helpfulCount: 0, notHelpfulCount: 0, createdAt: new Date(now), updatedAt: new Date(now)};
}
function publish(tx: Transaction, db: Firestore, record: Data, dish: Data, url: string, now: number): Data {
  if (record.mode === "missing" && (count(dish.imageCount) > 0 || dish.primaryImageUrl)) {
    throw new HttpsError("failed-precondition", "This dish already has an image.");
  }
  const source = imageSource(record, url, now);
  tx.create(db.doc(`bitescore_dish_images/${record.imageId}`), source);
  const primary = typeof dish.primaryImageUrl === "string" && dish.primaryImageUrl.trim();
  tx.update(db.doc(`bitescore_dishes/${record.dishId}`), {imageCount: count(dish.imageCount) + 1, updatedAt: new Date(now),
    ...(!primary ? {primaryImageId: record.imageId, primaryImageUrl: url} : {})});
  return source;
}
export function decodeScreeningPhoto(data: Data): Buffer {
  if (typeof data.bytesBase64 !== "string" || data.bytesBase64.length > Math.ceil(maxBytes / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data.bytesBase64)) throw new HttpsError("invalid-argument", "Invalid photo bytes.");
  const bytes = Buffer.from(data.bytesBase64, "base64");
  const type = data.contentType;
  const valid = type === "image/jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) :
    type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      type === "image/webp" && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid || bytes.length === 0 || bytes.length > maxBytes || bytes.toString("base64") !== data.bytesBase64) throw new HttpsError("invalid-argument", "Choose a JPEG, PNG or WebP photo up to 5 MB.");
  return bytes;
}
/** No trigger invokes the provider. Duplicate uploads read the same durable
 * identity; only an explicit retry can reserve a second billable attempt. */
export async function submitScreenedPhotoHandler(db: Firestore, request: CallableRequest<unknown>, options: ScreeningOptions = {}): Promise<Data> {
  const uid = actor(request, true);
  const data = parse(request.data, ["schemaVersion", "expectedUserId", "dishId", "restaurantId", "reviewId", "mode", "contentType", "bytesBase64", "retry"]);
  if (data.expectedUserId !== uid) throw new HttpsError("permission-denied", "The signed-in account changed.");
  const dishId = exact(data.dishId), restaurantId = exact(data.restaurantId), reviewId = data.reviewId === null ? null : exact(data.reviewId);
  if (!["review", "missing", "gallery"].includes(String(data.mode)) || (data.mode === "review") !== (reviewId !== null) || typeof data.retry !== "boolean") throw new HttpsError("invalid-argument", "Invalid photo operation.");
  const bytes = decodeScreeningPhoto(data), sha256 = hash(bytes), authCreatedAt = await identity(uid, options);
  const imageId = `bss_${hash(JSON.stringify([uid, dishId, restaurantId, reviewId, data.mode, data.contentType, sha256]))}`;
  const storagePath = `bitescore_user_uploads/${ownerKey(uid)}/dish_images/${dishId}/screened_${imageId}.jpg`;
  const ref = db.doc(`${screeningCollection}/${imageId}`), sourceRef = db.doc(`bitescore_dish_images/${imageId}`);
  const now = options.now ?? Date.now, at = now(), attemptId = randomUUID();
  const slotsRef = db.doc("private_bitescore_screening_usage/concurrency");
  const admitted = await db.runTransaction(async tx => {
    const [runtime, old, source] = await tx.getAll(db.doc(screeningRuntimePath), ref, sourceRef);
    const value: Data = old.data() ?? {schemaVersion: 1, imageId, ownerUserId: uid, authCreatedAt, dishId, restaurantId, reviewId, mode: data.mode,
      contentType: data.contentType, sha256, storagePath, uploadToken: randomUUID(), attempts: 0, createdAt: new Date(at)};
    if (value.authCreatedAt !== authCreatedAt) throw new HttpsError("failed-precondition", "The upload account changed.");
    const dish = await eligible(db, tx, value, at, options);
    if (!old.exists && data.mode === "missing" && (count(dish.imageCount) > 0 || dish.primaryImageUrl)) {
      throw new HttpsError("failed-precondition", "This dish already has an image.");
    }
    const retryCleanedUpload = value.state === "upload_failed" && value.cleanupStatus === "complete" &&
      (millis(value.expiresAt) ?? 0) > at && data.retry === true && value.attempts < maxAttempts && at >= value.retryAfter;
    if (source.exists || (["approved", "removed", ...terminalPhotoStates].includes(value.state) && !retryCleanedUpload)) return {result: response(value, source.data())};
    if (old.exists && photoExpired(value, at)) {
      const expired = {...value, ...terminalFields("expired", at, "retention_expired")};
      tx.set(ref, expired); return {result: response(expired)};
    }
    if (value.state === "needs_review") return {result: response(value)};
    requireRuntime(runtime.data(), true);
    if (value.state === "scanning" && value.leaseUntil > at) return {result: response(value)};
    if (old.exists && (data.retry !== true || value.attempts >= maxAttempts || at < value.retryAfter)) return {result: response({...value, state: "failed"})};
    await reservePhotoScreening(db, tx, uid, at, attemptId, runtime.get("monthlyAllowance"));
    const next: Data = {...value, state: "scanning", scanStatus: "pending", attempts: value.attempts + 1, attemptId, leaseUntil: at + leaseMs,
      retryAfter: at + leaseMs + 60_000 * 2 ** value.attempts, policyVersion: screeningPolicyVersion, updatedAt: new Date(at),
      uploadStatus: value.uploadStatus ?? "pending", queueOpen: true,
      expiresAt: value.expiresAt ?? new Date(at + failureRetentionDays(runtime.data())! * dayMs),
      maintenanceAt: new Date(at + leaseMs)};
    if (retryCleanedUpload) {
      // Keep immutable bytes/ownership identity and the original deadline. A
      // fresh bounded attempt can start only after prior bytes are absent.
      next.uploadStatus = "pending";
      for (const key of ["generation", "cleanupGeneration", "cleanupStatus", "cleanupReason", "cleanupAttempts", "cleanupError",
        "cleanupDisposition", "cleanupLeaseId", "cleanupLeaseUntil", "cleanupFinalizeRevision", "lastFinalizedGeneration",
        "bytesDeletedAt", "terminalAt", "failurePhase"]) delete next[key];
    }
    tx.set(ref, next);
    return {record: next};
  });
  if (admitted.result) return admitted.result;
  const value = admitted.record!, objects = options.objects ?? screeningObjects();
  let generation: string | undefined, classification: "approved" | "needs_review" | "failed" = "failed", likelihoods: unknown = null;
  try {
    generation = await objects.put(storagePath, bytes, String(data.contentType), uploadMetadata(value));
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      requireRuntime((await tx.get(db.doc(screeningRuntimePath))).data(), true);
      await eligible(db, tx, value, now(), options);
      if (current.get("attemptId") !== attemptId || current.get("state") !== "scanning" || photoExpired(current.data()!, now())) throw new Error("Stale screening");
      tx.update(ref, {generation, uploadStatus: "stored"});
    });
    const provider = options.provider ?? new GoogleSafeSearchProvider();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      likelihoods = parseSafeSearch(await Promise.race([provider.screen(bytes), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Screening timeout")), options.providerTimeoutMs ?? 22_000);
      })]));
    } finally { if (timer) clearTimeout(timer); }
    classification = classifySafeSearch(likelihoods);
    await objects.read(storagePath, generation, sha256);
    if (await identity(uid, options) !== authCreatedAt) throw new Error("Upload account changed");
  } catch { classification = "failed"; likelihoods = null; }
  const result = await db.runTransaction(async tx => {
    const [current, source, runtime, slots] = await tx.getAll(ref, sourceRef, db.doc(screeningRuntimePath), slotsRef);
    const active = {...(slots.get("active") ?? {})}; delete active[attemptId];
    if (!current.exists || current.get("attemptId") !== attemptId || current.get("state") !== "scanning") {
      tx.set(slotsRef, {active});
      return current.exists ? response(current.data()!, source.data()) : {schemaVersion: 1, imageId, state: "failed"};
    }
    let dish: Data | undefined;
    try { requireRuntime(runtime.data(), false); dish = await eligible(db, tx, value, now(), options); }
    catch { classification = "failed"; }
    // A paused runtime also stops publication of an in-flight auto approval.
    if (runtime.get("enabled") !== true || now() >= value.leaseUntil) classification = "failed";
    const final: Data = {...current.data(), state: classification, scanStatus: likelihoods ? "completed" : "failed", likelihoods,
      provider: options.provider?.name ?? "google-vision-safesearch-v1", updatedAt: new Date(now()),
      ...(generation ? {generation, uploadStatus: "stored"} : {})};
    let published = source.data();
    if (source.exists) final.state = source.get("moderationStatus") === "removed" ? "removed" : "failed";
    else if (photoExpired(current.data()!, now())) Object.assign(final, terminalFields("expired", now(), "retention_expired"));
    else if (!generation && current.get("uploadStatus") !== "stored") {
      Object.assign(final, terminalFields("upload_failed", now(), "upload_unconfirmed"), {failurePhase: "upload", uploadStatus: "unconfirmed", maintenanceAt: new Date(Math.max(now(), value.leaseUntil))});
    }
    else if (classification === "approved" && dish && generation) {
      if (final.mode === "missing" && (count(dish.imageCount) > 0 || dish.primaryImageUrl)) final.state = "needs_review";
      else published = publish(tx, db, final, dish, objects.url(storagePath), now());
    }
    if (final.state === "approved") { final.queueOpen = false; delete final.expiresAt; delete final.maintenanceAt; }
    else if (final.state === "needs_review") {
      final.expiresAt = new Date(millis(final.createdAt)! + pendingRetentionMs); final.maintenanceAt = final.expiresAt;
    } else if (final.state === "failed") { final.failurePhase = "screening"; final.maintenanceAt = final.expiresAt; }
    tx.set(ref, final); tx.set(slotsRef, {active});
    return response(final, published);
  });
  if (terminalPhotoStates.includes(result.state)) await cleanupScreeningPhoto(db, imageId, {now, objects: options.cleanupObjects});
  return result;
}
function admin(request: CallableRequest<unknown>, data: Data): string {
  requireRestaurantAccountAdminAccess(request);
  const uid = actor(request, true);
  if (data.expectedUserId !== uid) throw new HttpsError("permission-denied", "The signed-in account changed.");
  return uid;
}
export async function listScreeningPhotosHandler(db: Firestore, request: CallableRequest<unknown>, options: ScreeningOptions = {}): Promise<Data> {
  const data = parse(request.data, ["schemaVersion", "expectedUserId", "after"]), uid = admin(request, data);
  await db.runTransaction(async tx => requireAccountWritable(db, tx, uid));
  const at = (options.now ?? Date.now)();
  let query = db.collection(screeningCollection).where("queueOpen", "==", true).orderBy(FieldPath.documentId()).limit(26);
  if (data.after !== null) query = query.startAfter(exact(data.after));
  const rows = await query.get(), selected = rows.docs.slice(0, 25);
  const items = await Promise.all(selected.map(async row => {
    const value = row.data();
    if (value.lane === "owner") {
      const source = await db.doc(`${value.sourceType === "biteSaver" ? "restaurant_accounts" : "restaurant_menus"}/${exact(value.sourceId)}`).get();
      return {imageId: row.id, dishId: null, restaurantId: value.sourceId, dishName: `${value.family === "managed" ? value.targetId === "gallery" ? "Restaurant gallery" : value.targetId === "board" ? "Daily Specials board" : "Manual special" : value.family} image · ${value.targetId}`,
        restaurantName: source.get("restaurantName") ?? source.get("name") ?? "Owner menu", family: value.family,
        sourceType: value.sourceType, sourceId: value.sourceId, targetId: value.targetId, ownerUserId: value.ownerUserId,
        state: photoExpired(value, at) ? "expired" : value.state, scanStatus: value.scanStatus, generation: value.generation ?? null,
        likelihoods: value.likelihoods ?? null, createdAtMillis: millis(value.createdAt), expiresAtMillis: millis(value.expiresAt), serverNowMillis: at,
        cleanupStatus: value.cleanupStatus ?? null, cleanupError: value.cleanupError ?? null,
        canDecide: !photoExpired(value, at) && !terminalPhotoStates.includes(value.state) && !(value.state === "scanning" && value.leaseUntil > at)};
    }
    const [dish, restaurant] = await db.getAll(db.doc(`bitescore_dishes/${exact(value.dishId)}`), db.doc(`bitescore_restaurants/${exact(value.restaurantId)}`));
    return {imageId: row.id, dishId: value.dishId, restaurantId: value.restaurantId, dishName: dish.get("name") ?? "Unavailable dish",
      restaurantName: restaurant.get("name") ?? "Unavailable restaurant", state: photoExpired(value, at) ? "expired" : value.state, scanStatus: value.scanStatus,
      generation: value.generation ?? null, likelihoods: value.likelihoods ?? null,
      createdAtMillis: millis(value.createdAt), expiresAtMillis: millis(value.expiresAt), serverNowMillis: at,
      cleanupStatus: value.cleanupStatus ?? (photoExpired(value, at) ? "pending" : null), cleanupError: value.cleanupError ?? null,
      canDecide: !photoExpired(value, at) && !terminalPhotoStates.includes(value.state) && !(value.state === "scanning" && value.leaseUntil > at)};
  }));
  return {schemaVersion: 1, items, nextCursor: rows.size > 25 ? selected[24].id : null};
}
export async function previewScreeningPhotoHandler(db: Firestore, request: CallableRequest<unknown>, options: ScreeningOptions = {}): Promise<Data> {
  const data = parse(request.data, ["schemaVersion", "expectedUserId", "imageId", "generation"]), uid = admin(request, data);
  const value = await db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, uid);
    const row = (await tx.get(db.doc(`${screeningCollection}/${exact(data.imageId)}`))).data();
    if (!row || row.generation !== data.generation || typeof row.generation !== "string") throw new HttpsError("not-found", "Photo unavailable.");
    if (photoExpired(row, (options.now ?? Date.now)()) || terminalPhotoStates.includes(row.state)) throw new HttpsError("failed-precondition", "This unpublished photograph has expired or been rejected.");
    await requireAccountWritable(db, tx, row.ownerUserId);
    if (row.lane === "owner") await (await import("./owner_photo_screening.js")).requireOwnerPhotoAuthority(db, tx, row);
    return row;
  });
  try {
    const object = await (options.objects ?? screeningObjects()).read(value.storagePath, value.generation, value.sha256);
    return {schemaVersion: 1, imageId: data.imageId, generation: value.generation, contentType: object.contentType, bytesBase64: object.bytes.toString("base64")};
  } catch { throw new HttpsError("not-found", "The exact photo is no longer available."); }
}
export async function decideScreeningPhotoHandler(db: Firestore, request: CallableRequest<unknown>, options: ScreeningOptions = {}): Promise<Data> {
  const data = parse(request.data, ["schemaVersion", "expectedUserId", "imageId", "generation", "decision"]), uid = admin(request, data);
  if (typeof data.imageId === "string" && data.imageId.startsWith("bso_")) return (await import("./owner_photo_screening.js")).decideOwnerScreenedPhoto(db, request, options);
  if (!["approved", "rejected", "retry_cleanup"].includes(String(data.decision))) throw new HttpsError("invalid-argument", "Invalid decision.");
  const ref = db.doc(`${screeningCollection}/${exact(data.imageId)}`), before = (await ref.get()).data();
  if (!before || (before.generation ?? null) !== data.generation) throw new HttpsError("failed-precondition", "Photo changed. Refresh before deciding.");
  const objects = options.objects ?? screeningObjects(), now = options.now ?? Date.now;
  if (data.decision === "approved") {
    if (photoExpired(before, now()) || terminalPhotoStates.includes(before.state)) throw new HttpsError("failed-precondition", "This photograph can no longer be approved.");
    if (typeof before.generation !== "string" || await identity(before.ownerUserId, options) !== before.authCreatedAt) throw new HttpsError("failed-precondition", "Upload account changed.");
    try { await objects.read(before.storagePath, before.generation, before.sha256); }
    catch { throw new HttpsError("failed-precondition", "The exact photo is no longer available."); }
  }
  const decision = await db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, uid);
    const [row, source, runtime] = await tx.getAll(ref, db.doc(`bitescore_dish_images/${data.imageId}`), db.doc(screeningRuntimePath));
    const value = row.data();
    if (!value || (value.generation ?? null) !== data.generation || value.attemptId !== before.attemptId) throw new HttpsError("failed-precondition", "Photo changed. Refresh before deciding.");
    if (data.decision === "retry_cleanup") {
      if (source.exists || !terminalPhotoStates.includes(value.state) || value.cleanupStatus !== "attention") throw new HttpsError("failed-precondition", "Deletion is not awaiting a manual retry.");
      const next = {...value, cleanupStatus: "pending", cleanupAttempts: 0, maintenanceAt: new Date(now())};
      tx.set(ref, next); return response(next);
    }
    if (value.state === data.decision) return response(value, source.data());
    if (!source.exists && photoExpired(value, now())) {
      const expired = {...value, ...terminalFields("expired", now(), "retention_expired")};
      tx.set(ref, expired); return response(expired);
    }
    if (source.exists || ["approved", "removed", ...terminalPhotoStates].includes(value.state) || (value.state === "scanning" && value.leaseUntil > now())) throw new HttpsError("failed-precondition", "This photo already has a decision or is still checking.");
    let dish: Data | undefined;
    if (data.decision === "approved") { requireRuntime(runtime.data(), false); dish = await eligible(db, tx, value, now(), options); }
    const final: Data = {...value, state: data.decision, decidedBy: uid, decidedAt: new Date(now()), updatedAt: new Date(now()), decisionSource: "admin"};
    if (data.decision === "rejected") Object.assign(final, terminalFields("rejected", now(), "admin_rejected"));
    else { final.queueOpen = false; delete final.expiresAt; delete final.maintenanceAt; }
    const published = dish ? publish(tx, db, final, dish, objects.url(value.storagePath), now()) : undefined;
    tx.set(ref, final);
    return response(final, published);
  });
  if (terminalPhotoStates.includes(decision.state)) {
    await cleanupScreeningPhoto(db, exact(data.imageId), {now, objects: options.cleanupObjects});
    const latest = (await ref.get()).data();
    return latest ? response(latest) : decision;
  }
  return decision;
}

/** Reuses the existing image trigger/ledger for review-photo awards, including
 * delayed Admin approvals and lost callable responses. Never invokes Vision. */
export async function awardApprovedScreenedPhotoPoints(db: Firestore, imageId: string): Promise<void> {
  const [row, source] = await db.getAll(db.doc(`${screeningCollection}/${imageId}`), db.doc(`bitescore_dish_images/${imageId}`));
  const value = row.data();
  if (!value || value.state !== "approved" || value.mode !== "review" || !source.exists || source.get("moderationStatus") === "removed" ||
      source.get("uploadedByUserId") !== value.ownerUserId || source.get("storageGeneration") !== value.generation) return;
  await awardPublishedDishImageContributionPoints(db, value.ownerUserId, imageId, value.dishId);
}
