import {randomUUID} from "node:crypto";
import {requireBiteScoreTermsInFirestore, type ApprovedBiteScoreTerms} from "./bitescore_terms.js";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, type Firestore, type Transaction} from "firebase-admin/firestore";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {requireAuthenticatedRestaurantAccountActor, requireRestaurantAccountAdminAccess} from "./admin_authorization.js";
import {requireAccountWritable} from "./account_deletion_guard.js";
import {decodeScreeningPhoto, screeningObjects, type ScreeningOptions} from "./photo_screening.js";
import {classifySafeSearch, parseSafeSearch, GoogleSafeSearchProvider} from "./photo_screening_provider.js";
import {reservePhotoScreening} from "./photo_screening_admission.js";
import {screeningCollection, screeningRuntimePath, failureRetentionDays, photoExpired, pendingRetentionMs, dayMs,
  terminalFields, terminalPhotoStates, millis, cleanupScreeningPhoto, uploadMetadata} from "./photo_screening_retention.js";
import {ownerPhotoHash, ownerPhotoId, ownerPhotoPath, ownerPhotoTargetPath, ownerPhotoBoundTargetPath, ownerPhotoPublicationPath, ownerPhotoIsAttached} from "./owner_photo_identity.js";
import {ensureExistingBiteSaverProfile} from "./bitesaver_restaurant_profile.js";

type Data = Record<string, any>;
function fail(message = "This photo or its publishing authority changed."): never { throw new HttpsError("failed-precondition", message); }
const id = (v: unknown): string => {
  if (typeof v !== "string" || !v || v.length > 512 || v.trim() !== v || /[\/\p{Cc}\p{Cf}]/u.test(v) || v === "." || v === "..") throw new HttpsError("invalid-argument", "Invalid image source.");
  return v;
};
function input(request: CallableRequest<unknown>, keys: string[]): Data {
  const uid = requireAuthenticatedRestaurantAccountActor(request).uid;
  const data = request.data as Data;
  if (!data || typeof data !== "object" || Array.isArray(data) || data.schemaVersion !== 1 ||
      Object.keys(data).some(k => !["schemaVersion", "expectedUserId", ...keys].includes(k))) throw new HttpsError("invalid-argument", "Invalid image request.");
  if (data.expectedUserId !== uid) throw new HttpsError("permission-denied", "The signed-in account changed.");
  return data;
}
async function authVersion(uid: string, options: ScreeningOptions): Promise<string> {
  if (options.identity) return options.identity(uid);
  try { const user = await getAuth().getUser(uid); if (!user.disabled) return user.metadata.creationTime; } catch { /* neutral */ }
  return fail("This account is unavailable.");
}
function isAdmin(request: CallableRequest<unknown>): boolean {
  try { requireRestaurantAccountAdminAccess(request); return true; } catch { return false; }
}
function runtimeAllows(runtime: Data | undefined, scanning = false) {
  if (runtime?.ownerRequired !== true || runtime.policyVersion !== "conservative-hold-v1" || runtime.retentionApproved !== true ||
      (scanning && (runtime.ownerEnabled !== true || runtime.enabled !== true || runtime.cleanupEnabled !== true || failureRetentionDays(runtime) === null))) {
    throw new HttpsError("unavailable", "Photo checking is unavailable. Your saved text and photos are unchanged.");
  }
}
/** Re-read the actual source, never resolve a business by catalog name/address. */
export async function requireOwnerPhotoAuthority(db: Firestore, tx: Transaction, row: Data): Promise<void> {
  await requireAccountWritable(db, tx, row.uploaderUserId);
  await requireAccountWritable(db, tx, row.ownerUserId);
  const source = await tx.get(db.doc(`${row.sourceType === "biteSaver" ? "restaurant_accounts" : "restaurant_menus"}/${row.sourceId}`));
  if (!source.exists || `${source.createTime!.seconds}:${source.createTime!.nanoseconds}` !== row.sourceVersion) fail();
  if (row.sourceType === "biteSaver") {
    if (row.ownerUserId !== row.sourceId) fail();
    if (row.family === "main") {
      if (source.get("uid") !== row.ownerUserId || row.uploaderUserId !== row.ownerUserId) fail();
      ensureExistingBiteSaverProfile(source.data()!);
    } else if (row.family === "menu" && row.uploaderWasAdmin === true) {
      const uploader = await getAuth().getUser(row.uploaderUserId);
      if (uploader.disabled || uploader.metadata.creationTime !== row.authCreatedAt ||
          (uploader.customClaims?.admin !== true && uploader.email !== "schuyler.cole@gmail.com")) fail();
    } else if (source.get("uid") !== row.ownerUserId || source.get("approvalStatus") !== "approved" || source.get("couponPostingEnabled") !== true) fail();
  } else if (source.get("createdByUserId") !== row.ownerUserId || row.family !== "menu") fail();
  if ((["coupon", "menu"].includes(row.family) || (row.family === "managed" && !["gallery", "board"].includes(row.targetId))) && !terminalPhotoStates.includes(row.state) && (row.targetVersion !== null || row.targetToken)) {
    const target = await tx.get(db.doc(ownerPhotoBoundTargetPath(row)));
    if (!target.exists || (row.targetVersion !== null && `${target.createTime!.seconds}:${target.createTime!.nanoseconds}` !== row.targetVersion) ||
        (row.targetToken && target.get("screeningTargetToken") !== row.targetToken)) fail();
  }
}
export function ownerPhotoResponse(row: Data): Data {
  return {schemaVersion: 1, imageId: row.imageId, state: row.state === "approved" ? "available" : row.state,
    family: row.family, sourceType: row.sourceType, sourceId: row.sourceId, targetId: row.targetId,
    expiresAtMillis: millis(row.expiresAt), cleanupStatus: row.cleanupStatus ?? null,
    ...(row.state === "approved" ? {imageUrl: row.publicUrl, storagePath: row.storagePath, generation: row.generation} : {})};
}
export async function submitScreenedOwnerPhotoHandler(db: Firestore, request: CallableRequest<unknown>, options: ScreeningOptions = {}): Promise<Data> {
  const data = input(request, ["sourceType", "sourceId", "family", "targetId", "contentType", "bytesBase64", "retry"]);
  const uid = request.auth!.uid, sourceId = id(data.sourceId), targetId = id(data.targetId);
  if (!["biteSaver", "sharedMenu"].includes(data.sourceType) || !["main", "managed", "coupon", "menu"].includes(data.family) ||
      (data.sourceType === "sharedMenu" && data.family !== "menu") || typeof data.retry !== "boolean" ||
      (data.family === "main" && targetId !== sourceId) ||
      (data.family === "managed" && !/^[A-Za-z0-9_-]{1,128}$/.test(targetId))) throw new HttpsError("invalid-argument", "Invalid image target.");
  const bytes = decodeScreeningPhoto(data), authCreatedAt = await authVersion(uid, options), sha256 = ownerPhotoHash(bytes);
  const now = options.now ?? Date.now, at = now(), attemptId = randomUUID();
  const objects = options.objects ?? screeningObjects(), slotsRef = db.doc("private_bitescore_screening_usage/concurrency");
  const admitted = await db.runTransaction(async tx => {
    const source = await tx.get(db.doc(`${data.sourceType === "biteSaver" ? "restaurant_accounts" : "restaurant_menus"}/${sourceId}`));
    const ownerUserId = data.sourceType === "biteSaver" ? sourceId : source.get("createdByUserId");
    if (!source.exists || typeof ownerUserId !== "string" || (uid !== ownerUserId && !isAdmin(request))) throw new HttpsError("permission-denied", "This image source is not yours to manage.");
    const context: Data = {lane: "owner", uploaderUserId: uid, ownerUserId, authCreatedAt, sourceType: data.sourceType, sourceId,
      sourceVersion: `${source.createTime!.seconds}:${source.createTime!.nanoseconds}`, family: data.family, targetId, targetVersion: null, contentType: data.contentType, sha256,
      uploaderWasAdmin: isAdmin(request)};
    if (["coupon", "menu"].includes(context.family) || (context.family === "managed" && !["gallery", "board"].includes(targetId))) {
      const target = await tx.get(db.doc(ownerPhotoBoundTargetPath(context)));
      context.targetVersion = target.exists ? `${target.createTime!.seconds}:${target.createTime!.nanoseconds}` : null;
      const currentUrl = target.get("imageUrl");
      const currentId = typeof currentUrl === "string" ? /screened_(bso_[a-f0-9]{64})[.]jpg\?/.exec(decodeURIComponent(currentUrl))?.[1] : null;
      if (currentId) {
        const previous = (await tx.get(db.doc(`${screeningCollection}/${currentId}`))).data();
        if (previous?.state === "approved" && previous.uploaderUserId === uid && previous.authCreatedAt === authCreatedAt &&
            previous.sourceType === context.sourceType && previous.sourceId === sourceId && previous.family === context.family &&
            previous.targetId === targetId && previous.sha256 === sha256 && previous.contentType === data.contentType) {
          await requireOwnerPhotoAuthority(db, tx, previous); return {result: ownerPhotoResponse(previous)};
        }
      }
    }
    await requireOwnerPhotoAuthority(db, tx, context);
    const imageId = ownerPhotoId(context), ref = db.doc(`${screeningCollection}/${imageId}`);
    const [old, runtime] = await tx.getAll(ref, db.doc(screeningRuntimePath));
    const value: Data = old.data() ?? {...context, schemaVersion: 1, imageId, storagePath: ownerPhotoPath({...context, imageId}),
      createdAt: new Date(at), uploadToken: randomUUID(), attempts: 0};
    const retryCleanedUpload = value.state === "upload_failed" && value.cleanupStatus === "complete" &&
      (millis(value.expiresAt) ?? 0) > at && data.retry && value.attempts < 2 && at >= value.retryAfter;
    if (old.exists && !photoExpired(value, at) && ["approved", "removed", ...terminalPhotoStates].includes(value.state) && !retryCleanedUpload) return {result: ownerPhotoResponse(value)};
    if (old.exists && photoExpired(value, at)) {
      const expired = {...value, ...terminalFields("expired", at, "retention_expired")}; tx.set(ref, expired); return {result: ownerPhotoResponse(expired)};
    }
    if (value.state === "needs_review" || (value.state === "scanning" && value.leaseUntil > at) ||
        (old.exists && (!data.retry || value.attempts >= 2 || at < value.retryAfter))) return {result: ownerPhotoResponse(value)};
    runtimeAllows(runtime.data(), true);
    await requireBiteScoreTermsInFirestore(db, tx, ownerUserId, options.approvedTerms, new Date(at));
    await reservePhotoScreening(db, tx, uid, at, attemptId, runtime.get("monthlyAllowance"));
    const next: Data = {...value, state: "scanning", scanStatus: "pending", attempts: value.attempts + 1, attemptId,
      leaseUntil: at + 120_000, retryAfter: at + 120_000 + 60_000 * 2 ** value.attempts, updatedAt: new Date(at),
      uploadStatus: value.uploadStatus ?? "pending", queueOpen: true, policyVersion: "conservative-hold-v1",
      expiresAt: value.expiresAt ?? new Date(at + failureRetentionDays(runtime.data())! * dayMs), maintenanceAt: new Date(at + 120_000)};
    if (retryCleanedUpload) {
      next.uploadStatus = "pending";
      for (const key of ["generation", "cleanupGeneration", "cleanupStatus", "cleanupReason", "cleanupAttempts", "cleanupError",
        "cleanupDisposition", "cleanupLeaseId", "cleanupLeaseUntil", "cleanupFinalizeRevision", "lastFinalizedGeneration",
        "bytesDeletedAt", "terminalAt", "failurePhase"]) delete next[key];
    }
    tx.set(ref, next); return {record: next};
  });
  if (admitted.result) {
    if (admitted.result.state === "available") {
      const saved = (await db.doc(`${screeningCollection}/${admitted.result.imageId}`).get()).data()!;
      await objects.read(saved.storagePath, saved.generation, saved.sha256).catch(() => fail("The exact photo is no longer available."));
    }
    return admitted.result;
  }
  const row: Data = admitted.record!, ref = db.doc(`${screeningCollection}/${row.imageId}`);
  let generation: string | undefined, likelihoods: Data | null = null, state = "failed";
  try {
    generation = await objects.put(row.storagePath, bytes, row.contentType, uploadMetadata(row));
    await db.runTransaction(async tx => {
      const [current, runtime] = await tx.getAll(ref, db.doc(screeningRuntimePath));
      runtimeAllows(runtime.data(), true); await requireOwnerPhotoAuthority(db, tx, row);
      await requireBiteScoreTermsInFirestore(db, tx, row.ownerUserId, options.approvedTerms, new Date(now()));
      if (current.get("attemptId") !== attemptId || current.get("state") !== "scanning" || photoExpired(current.data()!, now())) fail();
      tx.update(ref, {generation, uploadStatus: "stored"});
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      likelihoods = parseSafeSearch(await Promise.race([(options.provider ?? new GoogleSafeSearchProvider()).screen(bytes),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), options.providerTimeoutMs ?? 22_000); })]));
    } finally { if (timer) clearTimeout(timer); }
    state = classifySafeSearch(likelihoods);
    await objects.read(row.storagePath, generation, sha256);
    if (await authVersion(uid, options) !== authCreatedAt) fail();
  } catch { state = "failed"; likelihoods = null; }
  const result = await db.runTransaction(async tx => {
    const [current, runtime, slots] = await tx.getAll(ref, db.doc(screeningRuntimePath), slotsRef);
    const active = {...(slots.get("active") ?? {})}; delete active[attemptId];
    if (!current.exists || current.get("attemptId") !== attemptId || current.get("state") !== "scanning") {
      tx.set(slotsRef, {active}); return current.exists ? ownerPhotoResponse(current.data()!) : {schemaVersion: 1, state: "unavailable", imageId: row.imageId};
    }
    try { runtimeAllows(runtime.data(), true); await requireOwnerPhotoAuthority(db, tx, row); }
    catch (error) {
      // Keep policy denials private while preserving SDK transaction retries.
      if (!(error instanceof HttpsError)) throw error;
      state = "failed";
    }
    if (now() >= row.leaseUntil) state = "failed";
    const next: Data = {...current.data(), state, likelihoods, scanStatus: likelihoods ? "completed" : "failed",
      provider: options.provider?.name ?? "google-vision-safesearch-v1", updatedAt: new Date(now()),
      ...(generation ? {generation, uploadStatus: "stored"} : {})};
    if (photoExpired(current.data()!, now())) Object.assign(next, terminalFields("expired", now(), "retention_expired"));
    else if (!generation && current.get("uploadStatus") !== "stored") Object.assign(next, terminalFields("upload_failed", now(), "upload_unconfirmed"),
      {failurePhase: "upload", uploadStatus: "unconfirmed", maintenanceAt: new Date(Math.max(now(), row.leaseUntil))});
    else if (["approved", "needs_review"].includes(state)) {
      next.expiresAt = new Date(millis(next.createdAt)! + pendingRetentionMs); next.maintenanceAt = next.expiresAt;
      next.queueOpen = state !== "approved";
      if (state === "approved") next.publicUrl = objects.url(row.storagePath);
    } else { next.failurePhase = "screening"; next.maintenanceAt = next.expiresAt; }
    tx.set(ref, next); tx.set(slotsRef, {active}); return ownerPhotoResponse(next);
  });
  if (terminalPhotoStates.includes(result.state)) await cleanupScreeningPhoto(db, row.imageId, {now, objects: options.cleanupObjects});
  return result;
}

/** Availability/status lookup is private, explicit, and never calls Vision. */
export async function getOwnerScreenedPhotoHandler(db: Firestore, request: CallableRequest<unknown>, options: ScreeningOptions = {}): Promise<Data> {
  const data = input(request, ["imageId", "preview"]);
  const result = await db.runTransaction(async tx => {
    const row = (await tx.get(db.doc(`${screeningCollection}/${id(data.imageId)}`))).data();
    if (!row || row.lane !== "owner" || (row.uploaderUserId !== request.auth!.uid && row.ownerUserId !== request.auth!.uid && !isAdmin(request))) throw new HttpsError("not-found", "Photo unavailable.");
    await requireOwnerPhotoAuthority(db, tx, row);
    return {row, response: ownerPhotoResponse(photoExpired(row, (options.now ?? Date.now)()) ? {...row, state: "expired"} : row)};
  });
  if (await authVersion(result.row.uploaderUserId, options) !== result.row.authCreatedAt) fail();
  if (result.response.state === "available" && data.preview !== true)
    await (options.objects ?? screeningObjects()).read(result.row.storagePath, result.row.generation, result.row.sha256).catch(() => fail("The exact photo is no longer available."));
  if (data.preview === true && result.row.generation && !photoExpired(result.row, (options.now ?? Date.now)()) && !terminalPhotoStates.includes(result.row.state)) {
    const object = await (options.objects ?? screeningObjects()).read(result.row.storagePath, result.row.generation, result.row.sha256);
    return {...result.response, bytesBase64: object.bytes.toString("base64")};
  }
  return result.response;
}

/** Called inside existing save transactions. New URLs require an exact approved
 * asset; unchanged historical references and text-only updates remain valid. */
export async function requireOwnerPhotoReference(db: Firestore, tx: Transaction, sourceType: string, sourceId: string,
  family: string, targetId: string, url: unknown, previous: unknown, terms?: ApprovedBiteScoreTerms | null): Promise<Data | null> {
  if (url == null || url === "" || url === previous) return null;
  const runtime = await tx.get(db.doc(screeningRuntimePath));
  if (runtime.get("ownerRequired") !== true) return null;
  requireOwnerPhotoPublication(runtime.data());
  const imageId = typeof url === "string" ? /screened_(bso_[a-f0-9]{64})[.]jpg(?:%3F|\?)/.exec(decodeURIComponent(url))?.[1] : undefined;
  if (!imageId) fail("Use an approved photo from the current app version.");
  const row = (await tx.get(db.doc(`${screeningCollection}/${imageId}`))).data();
  if (!row || row.lane !== "owner" || row.state !== "approved" || row.publicUrl !== url || row.sourceType !== sourceType ||
      row.sourceId !== sourceId || row.family !== family || row.targetId !== targetId || photoExpired(row, Date.now())) fail();
  await requireOwnerPhotoAuthority(db, tx, row);
  await requireBiteScoreTermsInFirestore(db, tx, row.ownerUserId, terms);
  if (await authVersion(row.uploaderUserId, {}) !== row.authCreatedAt) fail();
  await screeningObjects().read(row.storagePath, row.generation, row.sha256).catch(() => fail("The exact photo is no longer available."));
  return row;
}
export function requireOwnerPhotoPublication(runtime: Data | undefined): void {
  runtimeAllows(runtime);
  if (runtime?.enabled !== true || runtime?.ownerEnabled !== true) fail("Photo publication is paused. Your saved content is unchanged.");
}
export function markOwnerPhotoAttached(db: Firestore, tx: Transaction, row: Data | null): void {
  if (row) tx.update(db.doc(`${screeningCollection}/${row.imageId}`), {attached: true, expiresAt: FieldValue.delete(), maintenanceAt: FieldValue.delete()});
}

/** Explicit owner action only. Coupon text must already be saved; menu Upload
 * already means add a menu image. Admin approval never invokes this function. */
export async function useOwnerScreenedPhotoHandler(db: Firestore, request: CallableRequest<unknown>, options: ScreeningOptions = {}): Promise<Data> {
  const data = input(request, ["imageId", "action"]), uid = request.auth!.uid;
  if (!["attach", "remove", "discard"].includes(data.action)) throw new HttpsError("invalid-argument", "Invalid image action.");
  const ref = db.doc(`${screeningCollection}/${id(data.imageId)}`), before = (await ref.get()).data();
  const now = options.now ?? Date.now;
  if (!before || before.lane !== "owner" || (before.ownerUserId !== uid && !isAdmin(request))) throw new HttpsError("permission-denied", "This image is not yours to manage.");
  if (data.action === "attach") {
    if (await authVersion(before.uploaderUserId, options) !== before.authCreatedAt) fail();
    if (before.state !== "approved" || photoExpired(before, now())) fail();
    await (options.objects ?? screeningObjects()).read(before.storagePath, before.generation, before.sha256).catch(() => fail());
  }
  const result = await db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, uid);
    const [snapshot, runtime, target] = await tx.getAll(ref, db.doc(screeningRuntimePath), db.doc(ownerPhotoTargetPath(before)));
    const row = snapshot.data();
    if (!row || row.generation !== before.generation || row.attemptId !== before.attemptId) fail();
    if (data.action !== "discard") await requireOwnerPhotoAuthority(db, tx, row);
    if (data.action === "attach" && row.sourceType === "biteSaver" && row.family === "menu" && !isAdmin(request)) {
      const source = await tx.get(db.doc(`restaurant_accounts/${row.sourceId}`));
      if (source.get("approvalStatus") !== "approved" || source.get("couponPostingEnabled") !== true) fail();
    }
    if (data.action === "remove" || data.action === "discard") {
      if (data.action === "discard" && row.attached === true) fail("Remove a published photo in its editor.");
      if (data.action === "remove" && !["coupon", "menu"].includes(row.family)) fail("Remove this image in the restaurant photo editor.");
      if (target.get("imageUrl") === row.publicUrl) {
        if (row.family === "menu") tx.delete(target.ref);
        else tx.update(target.ref, {imageUrl: null, updatedAt: new Date(now())});
      }
      if (terminalPhotoStates.includes(row.state)) return ownerPhotoResponse(row);
      const removed = {...row, ...terminalFields("withdrawn", now(), "owner_removed")}; tx.set(ref, removed);
      return ownerPhotoResponse(removed);
    }
    if (row.state !== "approved" || photoExpired(row, now())) fail("Photo publication is paused or this photo expired.");
    if (!["coupon", "menu"].includes(row.family)) fail("Save this image in the restaurant photo editor.");
    if (row.attached === true && ownerPhotoIsAttached(row, target.data()))
      return {schemaVersion: 1, state: "published", image: target.data()};
    await requireBiteScoreTermsInFirestore(db, tx, row.ownerUserId, options.approvedTerms, new Date(now()));
    requireOwnerPhotoPublication(runtime.data());
    if (row.family === "coupon" && !target.exists) fail("Save the coupon text before attaching its photograph.");
    if (row.family === "menu" && target.exists && target.get("imageUrl") !== row.publicUrl) fail();
    const targetToken = row.targetToken ?? target.get("screeningTargetToken") ?? randomUUID();
    const image = {id: row.targetId, screeningTargetToken: targetToken, imageUrl: row.publicUrl, storagePath: row.storagePath, screeningImageId: row.imageId,
      sortOrder: millis(row.createdAt), createdAt: new Date(now()), updatedAt: new Date(now())};
    if (row.family === "menu" && !target.exists) tx.create(target.ref, image);
    else tx.update(target.ref, {imageUrl: row.publicUrl, screeningTargetToken: targetToken, updatedAt: new Date(now())});
    tx.update(ref, {targetToken});
    markOwnerPhotoAttached(db, tx, row);
    return {schemaVersion: 1, state: "published", image};
  });
  if (terminalPhotoStates.includes(result.state)) await cleanupScreeningPhoto(db, before.imageId, {now, objects: options.cleanupObjects});
  return result;
}

export async function decideOwnerScreenedPhoto(db: Firestore, request: CallableRequest<unknown>, options: ScreeningOptions = {}): Promise<Data> {
  requireRestaurantAccountAdminAccess(request);
  const data = input(request, ["imageId", "generation", "decision"]), ref = db.doc(`${screeningCollection}/${id(data.imageId)}`);
  if (!["approved", "rejected", "retry_cleanup"].includes(data.decision)) throw new HttpsError("invalid-argument", "Invalid decision.");
  const before = (await ref.get()).data(), now = options.now ?? Date.now, objects = options.objects ?? screeningObjects();
  if (!before || before.lane !== "owner" || (before.generation ?? null) !== data.generation) fail();
  if (data.decision === "approved") {
    if (photoExpired(before, now()) || terminalPhotoStates.includes(before.state) || !before.generation) fail();
    if (await authVersion(before.uploaderUserId, options) !== before.authCreatedAt) fail();
    await objects.read(before.storagePath, before.generation, before.sha256).catch(() => fail("The exact photo is no longer available."));
  }
  const next: Data = await db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, request.auth!.uid);
    const [current, runtime] = await tx.getAll(ref, db.doc(screeningRuntimePath));
    const row = current.data();
    if (!row || row.attemptId !== before.attemptId || (row.generation ?? null) !== data.generation) fail();
    if (data.decision === "retry_cleanup") {
      if (!terminalPhotoStates.includes(row.state) || row.cleanupStatus !== "attention") fail();
      const retried = {...row, cleanupStatus: "pending", cleanupAttempts: 0, maintenanceAt: new Date(now())}; tx.set(ref, retried); return retried;
    }
    if (row.state === data.decision) return row;
    if (row.state === "approved" || row.state === "removed" || terminalPhotoStates.includes(row.state) || (row.state === "scanning" && row.leaseUntil > now())) fail();
    if (photoExpired(row, now())) { const expired = {...row, ...terminalFields("expired", now(), "retention_expired")}; tx.set(ref, expired); return expired; }
    if (data.decision === "approved") { runtimeAllows(runtime.data()); await requireOwnerPhotoAuthority(db, tx, row); }
    const decided = {...row, state: data.decision, decidedBy: request.auth!.uid, decidedAt: new Date(now()), decisionSource: "admin",
      ...(data.decision === "rejected" ? terminalFields("rejected", now(), "admin_rejected") :
        {publicUrl: objects.url(row.storagePath), queueOpen: false, expiresAt: new Date(millis(row.createdAt)! + pendingRetentionMs), maintenanceAt: new Date(millis(row.createdAt)! + pendingRetentionMs)})};
    tx.set(ref, decided); return decided;
  });
  if (terminalPhotoStates.includes(next.state)) await cleanupScreeningPhoto(db, next.imageId, {now, objects: options.cleanupObjects});
  return ownerPhotoResponse(next);
}

/** Reuses existing source-write delivery; only retire the exact former reference
 * after checking the current target, so delayed events cannot remove a live photo.
 * No scans, source deletion, or new scheduler. */
export async function retireDetachedOwnerPhoto(db: Firestore, url: unknown, options: ScreeningOptions = {}): Promise<void> {
  if (typeof url !== "string") return;
  let imageId: string | undefined;
  try { imageId = /screened_(bso_[a-f0-9]{64})[.]jpg\?/.exec(decodeURIComponent(url))?.[1]; } catch { return; }
  if (!imageId) return;
  const now = options.now ?? Date.now, ref = db.doc(`${screeningCollection}/${imageId}`);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref), row = snapshot.data();
    if (!row || row.lane !== "owner" || row.publicUrl !== url || row.state !== "approved" || (row.family === "managed" && row.targetId === "gallery")) return false;
    const target = await tx.get(db.doc(ownerPhotoPublicationPath(row)));
    if (ownerPhotoIsAttached(row, target.data())) return false;
    tx.update(ref, terminalFields("withdrawn", now(), "owner_reference_removed")); return true;
  });
  // The existing retention worker performs deletion. Projection triggers need
  // only their existing Firestore access, never bucket deletion privileges.
}
