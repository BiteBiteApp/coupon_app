import {validOwnerPhotoIdentity, ownerPhotoMetadata, ownerPhotoPublicationPath as ownerPhotoTargetPath, ownerPhotoIsAttached} from "./owner_photo_identity.js";
import {createHash, randomUUID} from "node:crypto";
import {getStorage} from "firebase-admin/storage";
import {FieldValue, type Firestore} from "firebase-admin/firestore";

type Data = Record<string, any>;
export const screeningRuntimePath = "private_bitescore_runtime/photo_screening";
export const screeningCollection = "private_bitescore_photo_screenings";
export const retentionPolicyVersion = "photo-retention-v1";
export const dayMs = 86_400_000;
export const pendingRetentionMs = 30 * dayMs;
const cleanupLeaseMs = 120_000, maxCleanupAttempts = 8;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const generation = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]*$/.test(value);
export const terminalPhotoStates = ["rejected", "expired", "upload_failed", "withdrawn"];
export function millis(value: any): number | null {
  const result = value instanceof Date ? value.getTime() : typeof value?.toMillis === "function" ? value.toMillis() : NaN;
  return Number.isFinite(result) ? result : null;
}
export function photoExpired(row: Data, at: number): boolean {
  return !(row.state === "approved" && (row.lane !== "owner" || row.attached === true)) && !["removed", ...terminalPhotoStates].includes(row.state) &&
    (millis(row.expiresAt) === null || millis(row.expiresAt)! <= at);
}
/** Explicit candidate approval is separate from the already-approved 30 days. */
export function failureRetentionDays(runtime: Data | undefined): number | null {
  const days = runtime?.failedScreeningRetentionDays;
  return runtime?.retentionPolicyVersion === retentionPolicyVersion && runtime?.failedScreeningRetentionApproved === true &&
    Number.isInteger(days) && days > 0 && days <= 30 ? days : null;
}
export function terminalFields(state: string, at: number, reason: string): Data {
  return {state, cleanupReason: reason, cleanupStatus: "pending", cleanupAttempts: 0,
    maintenanceAt: new Date(at), terminalAt: new Date(at), queueOpen: true, updatedAt: new Date(at)};
}
function validIdentity(row: Data): boolean {
  if (row.lane === "owner") return validOwnerPhotoIdentity(row);
  if (typeof row.ownerUserId !== "string" || !row.ownerUserId || typeof row.dishId !== "string" ||
      !row.dishId || /[\/\x00-\x1f]/u.test(row.dishId) || !/^[a-f0-9]{64}$/.test(row.sha256 ?? "") ||
      typeof row.uploadToken !== "string" || !/^[a-f0-9-]{36}$/.test(row.uploadToken)) return false;
  const imageId = `bss_${digest(JSON.stringify([row.ownerUserId, row.dishId, row.restaurantId, row.reviewId, row.mode, row.contentType, row.sha256]))}`;
  return row.imageId === imageId && row.storagePath ===
    `bitescore_user_uploads/${digest(`bitestar.dish-upload.v1:${row.ownerUserId}`)}/dish_images/${row.dishId}/screened_${imageId}.jpg`;
}
export function uploadMetadata(row: Data): Record<string, string> {
  if (row.lane === "owner") return ownerPhotoMetadata(row);
  return {ownershipVersion: "1", uploaderKey: digest(`bitestar.dish-upload.v1:${row.ownerUserId}`), dishId: row.dishId,
    screeningImageId: row.imageId, screeningSha256: row.sha256, screeningUploadToken: row.uploadToken};
}
function matches(row: Data, metadata: Record<string, unknown> | undefined): boolean {
  return validIdentity(row) && Object.entries(uploadMetadata(row)).every(([key, value]) => metadata?.[key] === value);
}
export interface ScreeningCleanupObjects {
  readonly bucket: string;
  inspect(path: string, exactGeneration?: string): Promise<{generation: string; metadata?: Record<string, unknown>} | null>;
  remove(path: string, exactGeneration: string): Promise<void>;
}
export function screeningCleanupObjects(): ScreeningCleanupObjects {
  const bucket = getStorage().bucket();
  return {bucket: bucket.name,
    async inspect(path, exactGeneration) {
      try {
        const [object] = await bucket.file(path).getMetadata(exactGeneration ? {generation: exactGeneration} : {});
        return {generation: String(object.generation), metadata: object.metadata};
      } catch (e) { if ((e as {code?: number}).code === 404) return null; throw e; }
    },
    async remove(path, exactGeneration) {
      // Request options preserve long decimal strings; File({generation}) does not.
      const options = {generation: exactGeneration, ifGenerationMatch: exactGeneration};
      try { await bucket.file(path).delete(options); }
      catch (e) { if ((e as {code?: number}).code !== 404) throw e; }
    },
  };
}
export type CleanupOptions = {now?: () => number; objects?: ScreeningCleanupObjects};
/** Terminalize first, then claim one bounded deletion attempt. A public source
 * always wins: retention never deletes published or globally removed photos. */
export async function cleanupScreeningPhoto(db: Firestore, imageId: string, options: CleanupOptions = {}): Promise<void> {
  const now = options.now ?? Date.now, leaseId = randomUUID(), ref = db.doc(`${screeningCollection}/${imageId}`);
  const claimed = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const [source, runtime] = await tx.getAll(db.doc(snapshot.get("lane") === "owner" ? ownerPhotoTargetPath(snapshot.data()!) : `bitescore_dish_images/${imageId}`), db.doc(screeningRuntimePath));
    if (!snapshot.exists) return null;
    if (runtime.get("cleanupEnabled") !== true) return null;
    let row = snapshot.data()!;
    if ((row.lane === "owner" ? ownerPhotoIsAttached(row, source.data()) : source.exists) || row.state === "removed" || (row.state === "approved" && row.lane !== "owner")) {
      // A stale due marker must not occupy every subsequent bounded page.
      tx.update(ref, {maintenanceAt: FieldValue.delete(), queueOpen: false});
      return null;
    }
    const at = now();
    if (row.cleanupStatus === "complete" || row.cleanupStatus === "attention" || (row.cleanupLeaseUntil ?? 0) > at ||
        (millis(row.maintenanceAt) ?? Infinity) > at) return null;
    if (photoExpired(row, at)) row = {...row, ...terminalFields("expired", at, "retention_expired")};
    else if (row.state === "scanning" && row.leaseUntil <= at) {
      if (row.uploadStatus !== "stored") row = {...row, ...terminalFields("upload_failed", at, "upload_unconfirmed"),
        scanStatus: "failed", failurePhase: "upload", uploadStatus: "unconfirmed"};
      else row = {...row, state: "failed", scanStatus: "failed", failurePhase: "screening", maintenanceAt: row.expiresAt};
    }
    if (!terminalPhotoStates.includes(row.state)) {
      tx.set(ref, {...row, maintenanceAt: row.expiresAt});
      return null;
    }
    const attempts = (row.cleanupAttempts ?? 0) + 1;
    const next: Data = {...row, cleanupStatus: "running", cleanupAttempts: attempts, cleanupLeaseId: leaseId,
      cleanupLeaseUntil: at + cleanupLeaseMs, maintenanceAt: new Date(at + cleanupLeaseMs)};
    tx.set(ref, next);
    return next;
  });
  if (!claimed) return;
  const objects = options.objects ?? screeningCleanupObjects();
  let disposition = "absent", errorCode: string | null = null;
  try {
    if (!validIdentity(claimed)) throw new Error("identity_changed");
    const current = await objects.inspect(claimed.storagePath);
    const expected = claimed.cleanupGeneration ?? claimed.generation;
    if (expected !== undefined && !generation(expected)) throw new Error("identity_changed");
    if (current) {
      if (!generation(current.generation) || !matches(claimed, current.metadata) || (expected && expected !== current.generation)) throw new Error("identity_changed");
      // Lost upload acknowledgement: pin a proven generation before deleting.
      const pinned = await db.runTransaction(async tx => {
        const [latest, source] = await tx.getAll(ref, db.doc(claimed.lane === "owner" ? ownerPhotoTargetPath(claimed) : `bitescore_dish_images/${imageId}`));
        if (!latest.exists || (claimed.lane === "owner" ? ownerPhotoIsAttached(latest.data()!, source.data()) : source.exists) || latest.get("cleanupLeaseId") !== leaseId ||
            !terminalPhotoStates.includes(latest.get("state"))) return false;
        tx.update(ref, {cleanupGeneration: current.generation}); return true;
      });
      if (!pinned) return;
      await objects.remove(claimed.storagePath, current.generation);
      if (await objects.inspect(claimed.storagePath, current.generation)) throw new Error("absence_unproven");
      // A replacement is never deleted or represented as fully cleaned up.
      if (await objects.inspect(claimed.storagePath)) throw new Error("identity_changed");
      disposition = "generation_deleted";
    } else if (expected && await objects.inspect(claimed.storagePath, expected)) {
      throw new Error("identity_changed");
    }
  } catch (e) { errorCode = e instanceof Error && e.message === "identity_changed" ? "identity_changed" : "storage_unavailable"; }
  await db.runTransaction(async tx => {
    const row = await tx.get(ref);
    if (!row.exists || row.get("cleanupLeaseId") !== leaseId || !terminalPhotoStates.includes(row.get("state"))) return;
    const at = now();
    if ((row.get("cleanupFinalizeRevision") ?? 0) !== (claimed.cleanupFinalizeRevision ?? 0)) {
      tx.update(ref, {cleanupStatus: "pending", maintenanceAt: new Date(at), queueOpen: true,
        cleanupLeaseUntil: FieldValue.delete(), cleanupLeaseId: FieldValue.delete()});
      return;
    }
    if (!errorCode) {
      tx.update(ref, {cleanupStatus: "complete", cleanupDisposition: disposition, bytesDeletedAt: new Date(at), queueOpen: false,
        maintenanceAt: FieldValue.delete(), cleanupLeaseUntil: FieldValue.delete(), cleanupLeaseId: FieldValue.delete(),
        likelihoods: FieldValue.delete(), cleanupError: FieldValue.delete(), updatedAt: new Date(at)});
    } else {
      const attention = errorCode === "identity_changed" || claimed.cleanupAttempts >= maxCleanupAttempts;
      tx.update(ref, {cleanupStatus: attention ? "attention" : "retry", cleanupError: errorCode, queueOpen: true,
        maintenanceAt: attention ? FieldValue.delete() : new Date(at + 300_000 * 2 ** (claimed.cleanupAttempts - 1)),
        cleanupLeaseUntil: FieldValue.delete(), cleanupLeaseId: FieldValue.delete(), updatedAt: new Date(at)});
    }
  });
}

/** One indexed due page. Completed rows leave the index; failures move forward.
 * Crashes recover after per-record lease expiry. No provider calls or TTL proof. */
export async function maintainScreeningPhotos(db: Firestore, options: CleanupOptions = {}): Promise<number> {
  if ((await db.doc(screeningRuntimePath).get()).get("cleanupEnabled") !== true) return 0;
  const now = options.now ?? Date.now;
  const due = await db.collection(screeningCollection).where("maintenanceAt", "<=", new Date(now())).orderBy("maintenanceAt").limit(25).get();
  for (const row of due.docs) await cleanupScreeningPhoto(db, row.id, options);
  return due.size;
}

/** Reuses the existing Storage finalize delivery. An upload can arrive after a
 * failed/lost acknowledgement and even after an earlier probe found no bytes. */
export async function screeningPhotoFinalized(db: Firestore, event: {type: string; data: {bucket?: unknown; name?: unknown; generation?: unknown; metadata?: Record<string, unknown>}}, options: CleanupOptions = {}): Promise<void> {
  const metadata = event.data?.metadata, id = metadata?.screeningImageId;
  if (event.type !== "google.cloud.storage.object.v1.finalized" || typeof id !== "string" || !/^bs[so]_[a-f0-9]{64}$/.test(id) || !generation(event.data.generation)) return;
  const objects = options.objects ?? screeningCleanupObjects(), now = options.now ?? Date.now;
  if (event.data.bucket !== objects.bucket) return;
  const ref = db.doc(`${screeningCollection}/${id}`);
  const rearmed = await db.runTransaction(async tx => {
    const row = await tx.get(ref);
    const source = await tx.get(db.doc(row.get("lane") === "owner" ? ownerPhotoTargetPath(row.data()!) : `bitescore_dish_images/${id}`));
    const value = row.data();
    if (!value || (value.lane === "owner" ? ownerPhotoIsAttached(value, source.data()) : source.exists) || !matches(value, metadata) || value.storagePath !== event.data.name ||
        ["approved", "removed"].includes(value.state)) return false;
    // Active/stored workflows already have a durable deadline. Late delivery of
    // an old generation must not rewrite a current workflow's immutable proof.
    if (!terminalPhotoStates.includes(value.state)) return false;
    if (value.lastFinalizedGeneration === event.data.generation) return false;
    if (value.cleanupStatus === "complete" && value.cleanupDisposition === "generation_deleted" &&
        value.cleanupGeneration === event.data.generation) return false;
    const running = (value.cleanupLeaseUntil ?? 0) > now();
    tx.update(ref, {cleanupStatus: running ? value.cleanupStatus : "pending", queueOpen: true,
      cleanupFinalizeRevision: (value.cleanupFinalizeRevision ?? 0) + 1, lastFinalizedGeneration: event.data.generation,
      maintenanceAt: new Date(running ? value.cleanupLeaseUntil : now()),
      ...(value.cleanupStatus === "complete" ? {cleanupAttempts: 0} : {}),
      ...(value.generation || value.cleanupGeneration ? {} : {cleanupGeneration: event.data.generation})});
    return true;
  });
  if (rearmed && (await db.doc(screeningRuntimePath).get()).get("cleanupEnabled") === true) await cleanupScreeningPhoto(db, id, {...options, objects});
}
