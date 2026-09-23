import {createHash} from "node:crypto";
import {FieldValue, type DocumentData, type Firestore} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {accountDeletionPath} from "./account_deletion_guard.js";
import type {AccountDeletionIdentity} from "./account_deletion_contract.js";

export const accountDeletionMediaBucket = "coupon-app-29446.firebasestorage.app";
export const accountDeletionFinalizeEvent = "google.cloud.storage.object.v1.finalized";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const accountDeletionPhotoOwnerKey = (uid: string) => digest(`bitestar.dish-upload.v1:${uid}`);
const segment = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value !== "." && value !== ".." && !/[\/\x00-\x1f\x7f]/u.test(value);
const generationValue = (value: unknown): string | null =>
  typeof value === "string" && /^[1-9][0-9]*$/u.test(value) ? value :
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;

type Scope = {kind: "dish"; ownerKey: string; dishId: string} |
  {kind: "business"; uid: string} | {kind: "menu"; grantId: string; fileName: string};
function scope(path: unknown): Scope | null {
  if (typeof path !== "string") return null;
  const parts = path.split("/");
  if (!parts.every(segment)) return null;
  if (parts.length === 5 && parts[0] === "bitescore_user_uploads" && /^[a-f0-9]{64}$/u.test(parts[1]) && parts[2] === "dish_images") return {kind: "dish", ownerKey: parts[1], dishId: parts[3]};
  if (parts.length === 4 && parts[0] === "bitesaver_restaurants" && parts[1].length <= 128 && ["restaurant_images", "coupon_images", "menu_images"].includes(parts[2])) return {kind: "business", uid: parts[1]};
  if (parts.length === 3 && parts[0] === "public_menu_images" && /^bsmia_[A-Za-z0-9_-]{43}$/u.test(parts[1]) && /^image\.(jpg|png|webp)$/u.test(parts[2])) return {kind: "menu", grantId: parts[1], fileName: parts[2]};
  return null;
}
function metadataMatches(parsed: Scope, metadata: Record<string, unknown> | undefined): boolean {
  // Only the dish path needs client metadata: its exact three fields are bound
  // by immutable-create Storage Rules. A URL/publication UID is never evidence.
  return parsed.kind !== "dish" || (metadata?.ownershipVersion === "1" && metadata?.uploaderKey === parsed.ownerKey && metadata?.dishId === parsed.dishId);
}
function accepted(uid: string, value: DocumentData | undefined): value is DocumentData {
  return !!value && value.schemaVersion === 1 && value.uid === uid &&
    typeof value.operationId === "string" && /^[a-f0-9]{64}$/u.test(value.operationId) &&
    typeof value.authCreationTime === "string" && Number.isFinite(Date.parse(value.authCreationTime)) &&
    ["requested", "processing", "pending", "complete"].includes(value.state);
}
function grantOwner(data: DocumentData | undefined, parsed: Extract<Scope, {kind: "menu"}>): string | null {
  if (!data || data.schemaVersion !== 1 || !["revoked", "retired"].includes(data.state) ||
      !segment(data.ownerUserId) || data.ownerUserId.length > 128 || data.fileName !== parsed.fileName ||
      !["biteSaver", "sharedMenu"].includes(data.sourceType) || !segment(data.sourceId) ||
      (data.sourceType === "biteSaver" && data.sourceId !== data.ownerUserId)) return null;
  return data.ownerUserId;
}

export interface AccountDeletionFinalizedObjects {
  readGeneration(path: string, generation: string): Promise<{generation: string; metadata?: Record<string, unknown>} | null>;
  deleteGeneration(path: string, generation: string): Promise<void>;
}
export function createAccountDeletionFinalizedObjects(): AccountDeletionFinalizedObjects {
  const bucket = getStorage().bucket(accountDeletionMediaBucket);
  return {
    async readGeneration(path, generation) {
      try {
        // The pinned SDK's File constructor converts generation to Number.
        // Request options preserve the provider's complete decimal string.
        const [value] = await bucket.file(path).getMetadata({generation});
        return {generation: String(value.generation), metadata: value.metadata};
      } catch (error) { if ((error as {code?: number}).code === 404) return null; throw error; }
    },
    async deleteGeneration(path, generation) {
      const options = {generation, ifGenerationMatch: generation};
      try { await bucket.file(path).delete(options); }
      catch (error) { if ((error as {code?: number}).code !== 404) throw error; }
    },
  };
}
type GetIdentity = (uid: string) => Promise<AccountDeletionIdentity | null>;

/** Reuses the existing object journal and scheduler, including after ordinary
 * completion. No profile, business root, upload queue or lifetime estimate. */
export async function reconcileAccountDeletionFinalizedObject(
  db: Firestore, uid: string, itemId: string, getIdentity: GetIdentity,
  objects: AccountDeletionFinalizedObjects,
): Promise<void> {
  const root = db.doc(accountDeletionPath(uid));
  const ref = root.collection("object_items").doc(itemId);
  const [marker, item] = await db.getAll(root, ref);
  const job = marker.data(), data = item.data();
  if (!accepted(uid, job) || !data || data.kind !== "late_finalize" || data.operationId !== job.operationId ||
      generationValue(data.generation) !== data.generation || itemId !== digest(JSON.stringify(["finalize", data.path, data.generation]))) throw new Error("Late media authority changed");
  if (data.complete === true) return;
  const parsed = scope(data.path);
  const grant = parsed?.kind === "menu" ? (await db.doc(`private_menu_image_upload_authorizations/${parsed.grantId}`).get()).data() : undefined;
  if (!parsed || (parsed.kind === "dish" && parsed.ownerKey !== accountDeletionPhotoOwnerKey(uid)) ||
      (parsed.kind === "business" && parsed.uid !== uid) ||
      (parsed.kind === "menu" && (grantOwner(grant, parsed) !== uid ||
        (grant?.state === "retired" && grant.deletionOperationId !== job.operationId)))) throw new Error("Late media ownership unproven");
  const identity = await getIdentity(uid);
  if (identity && (identity.creationTime !== job.authCreationTime || identity.privileged)) throw new Error("Late media identity changed");
  const object = await objects.readGeneration(data.path, data.generation);
  if (object && (object.generation !== data.generation || !metadataMatches(parsed, object.metadata))) throw new Error("Late media generation or ownership changed");
  // Exact generation on BOTH read and delete: a stale event can never delete G2.
  // UID reuse by privileged operators during deletion remains prohibited, as
  // with the ordinary worker; this recheck detects an already-replaced UID.
  if (object) await objects.deleteGeneration(data.path, data.generation);
  if (await objects.readGeneration(data.path, data.generation)) throw new Error("Late media absence unproven");
  await db.runTransaction(async (tx) => {
    const [current, intent] = await tx.getAll(root, ref);
    if (!accepted(uid, current.data()) || current.get("operationId") !== job.operationId || intent.get("operationId") !== job.operationId) throw new Error("Late media authority changed");
    tx.update(ref, {complete: true, disposition: "generation_deleted"});
  });
}

/** Only an authenticated Storage finalize delivery enters here. Eventarc
 * retry handles failures before journaling; the existing deletion scheduler
 * additionally recovers durable intents after a crash/lost acknowledgement. */
export async function accountDeletionObjectFinalizedHandler(
  db: Firestore, event: {type: string; data: {bucket?: unknown; name?: unknown; generation?: unknown; metadata?: Record<string, unknown>}},
  getIdentity: GetIdentity, objects: AccountDeletionFinalizedObjects, now: () => number = Date.now,
): Promise<void> {
  const data = event.data;
  const parsed = scope(data?.name), generation = generationValue(data?.generation);
  if (event.type !== accountDeletionFinalizeEvent || data?.bucket !== accountDeletionMediaBucket || !parsed || !generation || !metadataMatches(parsed, data.metadata)) return;
  let uid: string;
  if (parsed.kind === "dish") {
    const matches = await db.collection("private_account_deletions").where("photoOwnerKey", "==", parsed.ownerKey).limit(2).get();
    if (matches.empty) return;
    if (matches.size !== 1) throw new Error("Late media owner is ambiguous");
    uid = matches.docs[0].id;
    if (accountDeletionPhotoOwnerKey(uid) !== parsed.ownerKey) throw new Error("Late media owner changed");
  } else if (parsed.kind === "business") uid = parsed.uid;
  else {
    const owner = grantOwner((await db.doc(`private_menu_image_upload_authorizations/${parsed.grantId}`).get()).data(), parsed);
    if (!owner) return;
    uid = owner;
  }
  const root = db.doc(accountDeletionPath(uid));
  const itemId = digest(JSON.stringify(["finalize", data.name, generation]));
  const ref = root.collection("object_items").doc(itemId);
  const registered = await db.runTransaction(async (tx) => {
    const [marker, existing] = await tx.getAll(root, ref);
    if (!marker.exists) return false;
    const job = marker.data();
    if (!accepted(uid, job)) throw new Error("Late media deletion marker needs recovery");
    if (parsed.kind === "menu") {
      const grant = (await tx.get(db.doc(`private_menu_image_upload_authorizations/${parsed.grantId}`))).data();
      if (grantOwner(grant, parsed) !== uid || (grant?.state === "retired" && grant.deletionOperationId !== job.operationId)) throw new Error("Late menu authority changed");
    }
    if (existing.exists) return existing.get("complete") !== true;
    tx.create(ref, {kind: "late_finalize", operationId: job.operationId, path: data.name, generation, complete: false, disposition: "pending"});
    // Serializes against completion without stealing an active worker lease.
    // A previously complete receipt becomes truthfully pending until the
    // existing worker verifies this known cleanup and completes it again.
    tx.update(root, {mediaRevision: (job.mediaRevision ?? 0) + 1,
      ...(job.state === "complete" ? {state: "pending", reason: "media", phase: "auth_verify", completedAtMs: FieldValue.delete(), nextAttemptAtMs: now()} : {})});
    return true;
  });
  if (registered) await reconcileAccountDeletionFinalizedObject(db, uid, itemId, getIdentity, objects);
}

export async function accountDeletionLateMediaStep(
  db: Firestore, uid: string, getIdentity: GetIdentity, objects?: AccountDeletionFinalizedObjects,
): Promise<boolean> {
  const pending = await db.collection(`private_account_deletions/${uid}/object_items`).where("kind", "==", "late_finalize").where("complete", "==", false).limit(1).get();
  if (pending.empty) return true;
  if (!objects) throw new Error("Late media adapter unavailable");
  await reconcileAccountDeletionFinalizedObject(db, uid, pending.docs[0].id, getIdentity, objects);
  return false;
}
