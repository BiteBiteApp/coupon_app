import {ratingDishOperationLockPath, ratingRestaurantOperationLockPath} from "./rating_destructive_job_contract.js";
import {dishMergeReviewLockPath} from "./dish_proposal_private_contract.js";
import {createFirestoreCustomerBiteSaverSearchDatabase} from "./customer_bitesaver_search_store.js";
import {reconcileCustomerBiteScoreMenuGeneration} from "./customer_bitescore_menu_search.js";
import {createHash} from "node:crypto";
import {getStorage} from "firebase-admin/storage";
import type {AccountDeletionStepContext} from "./account_deletion_service.js";
import {reconcileCustomerBiteScoreImage} from "./customer_bitescore_reads.js";

export interface AccountDeletionObjects {
  nextOwnedPath(uid: string, after?: string): Promise<string | null>;
  nextPersonalPath(uid: string, after?: string): Promise<string | null>;
  personalGeneration(path: string, uid: string): Promise<string | null>;
  nextMenuPath(menuId: string, after?: string): Promise<string | null>;
  referenceUrls(path: string): Promise<string[]>;
  generation(path: string): Promise<string | null>;
  deleteGeneration(path: string, generation: string): Promise<void>;
}
export function createAccountDeletionObjects(): AccountDeletionObjects {
  // This adapter accepts only server-validated paths, never a URL or bucket.
  const bucket = getStorage().bucket("coupon-app-29446.firebasestorage.app");
  return {
    async nextOwnedPath(uid, after) {
      if (!validId(uid)) throw new Error("Invalid account object namespace");
      const prefix = `bitesaver_restaurants/${uid}/`;
      const [files] = await bucket.getFiles({prefix, maxResults: 2, autoPaginate: false, ...(after ? {startOffset: after} : {})});
      return files.map((file) => file.name).find((name) => !after || name !== after) ?? null;
    },
    async nextPersonalPath(uid, after) {
      if (!validId(uid)) throw new Error("Invalid personal object namespace");
      const prefix = `bitescore_user_uploads/${key(`bitestar.dish-upload.v1:${uid}`)}/dish_images/`;
      const [files] = await bucket.getFiles({prefix, maxResults: 2, autoPaginate: false, ...(after ? {startOffset: after} : {})});
      return files.map((file) => file.name).find((name) => !after || name !== after) ?? null;
    },
    async personalGeneration(path, uid) {
      const parts = path.split("/");
      if (parts.length !== 5 || parts[0] !== "bitescore_user_uploads" || parts[1] !== key(`bitestar.dish-upload.v1:${uid}`) || parts[2] !== "dish_images" || !validId(parts[3]) || !validId(parts[4])) throw new Error("Personal object scope changed");
      try {
        const value = (await bucket.file(path).getMetadata())[0];
        if (value.metadata?.ownershipVersion !== "1" || value.metadata?.uploaderKey !== parts[1] || value.metadata?.dishId !== parts[3] || !/^[0-9]+$/.test(String(value.generation))) throw new Error("Personal object ownership unproven");
        return String(value.generation);
      } catch (error) { if ((error as {code?: number}).code === 404) return null; throw error; }
    },
    async nextMenuPath(menuId, after) {
      if (!validId(menuId)) throw new Error("Invalid menu object namespace");
      const prefix = `restaurant_menus/${menuId}/menu_images/`;
      const [files] = await bucket.getFiles({prefix, maxResults: 2, autoPaginate: false, ...(after ? {startOffset: after} : {})});
      return files.map((file) => file.name).find((name) => !after || name !== after) ?? null;
    },
    async referenceUrls(path) {
      try {
        const metadata = (await bucket.file(path).getMetadata())[0];
        const raw = metadata.metadata?.firebaseStorageDownloadTokens;
        const tokens = typeof raw === "string" ? raw.split(",").filter(Boolean) : [];
        if (tokens.length > 10) throw new Error("Object token variants require recovery");
        return tokens.map((token) => `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`);
      } catch (error) { if ((error as {code?: number}).code === 404) return []; throw error; }
    },
    async generation(path) {
      try { return String((await bucket.file(path).getMetadata())[0].generation); }
      catch (error) { if ((error as {code?: number}).code === 404) return null; throw error; }
    },
    async deleteGeneration(path, generation) {
      // Request options avoid the SDK constructor's lossy Number conversion.
      const options = {generation, ifGenerationMatch: generation};
      try { await bucket.file(path).delete(options); }
      catch (error) { if ((error as {code?: number}).code !== 404) throw error; }
    },
  };
}
const key = (value: string) => createHash("sha256").update(value).digest("hex");
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !/[\/\x00-\x1f]/u.test(value);

/** One durable publication journal at a time. Public dish URLs prove publication,
 * not original upload ownership. Only the new Rules-bound namespace can be
 * attributed by its immutable object metadata; old bytes remain unresolved. */
export async function accountDeletionPhotoStep(context: AccountDeletionStepContext, objects?: AccountDeletionObjects): Promise<boolean> {
  const {db, job} = context;
  const journal = db.collection(`private_account_deletions/${job.uid}/media_items`);
  const inProgress = await journal.where("publicationComplete", "==", false).limit(1).get();
  let item = inProgress.docs[0];
  if (!item) {
    const found = await db.collection("bitescore_dish_images").where("uploadedByUserId", "==", job.uid).limit(1).get();
    if (found.empty) return true;
    const source = found.docs[0], data = source.data();
    if (!validId(data.dishId) || !validId(data.restaurantId)) throw new Error("Photo scope requires recovery");
    const ownedPath = `bitescore_user_uploads/${key(`bitestar.dish-upload.v1:${job.uid}`)}/dish_images/${data.dishId}/`;
    const proven = typeof data.storagePath === "string" && data.storagePath.startsWith(ownedPath) && objects !== undefined;
    // Read only the new namespace's Rules-bound proof; old arbitrary metadata
    // and a publication UID never authorize object deletion.
    if (proven) await objects!.personalGeneration(data.storagePath, job.uid);
    const ref = journal.doc(key(source.ref.path));
    await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(source.ref);
      if (!current.exists || current.get("uploadedByUserId") !== job.uid || current.get("dishId") !== data.dishId || current.get("storagePath") !== data.storagePath) throw new Error("Photo ownership changed");
      tx.create(ref, {kind: "dish", imageId: source.id, dishId: data.dishId, restaurantId: data.restaurantId,
        storagePath: typeof data.storagePath === "string" ? data.storagePath : safeObjectLocator(data.imageUrl),
        externalLocation: safeExternalLocation(data.imageUrl), publicationComplete: false, disposition: proven ? "owned_personal_namespace" : "unproven_original_uploader"});
    });
    return false;
  }
  const value = item.data();
  if (value.kind !== "dish" || !validId(value.imageId)) throw new Error("Unknown media journal");
  // Capture the actual source in existing accounting before removing it. This
  // covers deletion racing ahead of the source-create event.
  await reconcileCustomerBiteScoreImage(db, value.imageId);
  const votes = await db.collection("bitescore_dish_image_votes").where("imageId", "==", value.imageId).limit(1).get();
  if (!votes.empty) {
    await db.runTransaction(async (tx) => { await context.assertLease(tx); const current = await tx.get(votes.docs[0].ref); if (current.get("imageId") === value.imageId) tx.delete(current.ref); });
    return false;
  }
  const removed = await db.runTransaction(async (tx) => {
    await context.assertLease(tx);
    const source = await tx.get(db.doc(`bitescore_dish_images/${value.imageId}`));
    if (!await deletionContributionIsUnlocked(context, tx, value.dishId, value.restaurantId)) return false;
    if (source.exists) {
      if (source.get("uploadedByUserId") !== job.uid || source.get("dishId") !== value.dishId || (source.get("storagePath") ?? safeObjectLocator(source.get("imageUrl"))) !== value.storagePath) throw new Error("Photo scope changed");
      tx.delete(source.ref);
    }
    return true;
  });
  if (!removed) return false;
  await reconcileCustomerBiteScoreImage(db, value.imageId);
  await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.update(item.ref, {publicationComplete: true}); });
  return false;
}

/** Generation is persisted before deletion; a replaced current generation is
 * never deleted using a stale intent. Replays verify the captured generation. */
export async function deleteAccountOwnedMenuObject(context: AccountDeletionStepContext, grantId: string, objects: AccountDeletionObjects): Promise<boolean> {
  const {db, job} = context;
  if (!/^bsmia_[A-Za-z0-9_-]{43}$/u.test(grantId)) throw new Error("Invalid upload authorization identity");
  const grantRef = db.doc(`private_menu_image_upload_authorizations/${grantId}`);
  const grant = await grantRef.get();
  if (!grant.exists) return true;
  const data = grant.data()!;
  if (data.schemaVersion !== 1 || data.ownerUserId !== job.uid || data.state !== "revoked" || !["biteSaver", "sharedMenu"].includes(data.sourceType) || !validId(data.sourceId) || (data.sourceType === "biteSaver" && data.sourceId !== job.uid) || !/^image\.(jpg|png|webp)$/u.test(data.fileName)) throw new Error("Menu object ownership unproven");
  const path = `public_menu_images/${grantId}/${data.fileName}`;
  const ref = db.doc(`private_account_deletions/${job.uid}/object_items/${key(path)}`);
  const existing = await ref.get();
  if (!existing.exists) {
    const generation = await objects.generation(path);
    await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(grantRef);
      if (current.get("ownerUserId") !== job.uid || current.get("state") !== "revoked" || current.get("fileName") !== data.fileName) throw new Error("Upload authority changed");
      tx.create(ref, {path, generation, complete: generation === null, disposition: generation === null ? "already_absent" : "pending"});
    });
    return false;
  }
  if (await removeOwnedMenuReference(context, path, objects)) return false;
  if (existing.get("complete") === true || existing.get("disposition") === "retained_shared") return true;
  // Reusing an A-owned object URL does not transfer its bytes to another user.
  const generation = existing.get("generation");
  const current = await objects.generation(path);
  if (current !== null && current !== generation) throw new Error("Object generation changed; retained for recovery");
  await db.runTransaction(async (tx) => { await context.assertLease(tx); });
  if (current !== null) await objects.deleteGeneration(path, generation);
  if (await objects.generation(path) !== null) throw new Error("Object absence unproven");
  await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.update(ref, {complete: true, disposition: "generation_deleted"}); });
  return true;
}

export async function deletionContributionIsUnlocked(context: AccountDeletionStepContext, tx: FirebaseFirestore.Transaction, dishId: string, restaurantId: string): Promise<boolean> {
  if (!validId(dishId) || !validId(restaurantId)) return false;
  const [dish, restaurant, proposal] = await tx.getAll(context.db.doc(ratingDishOperationLockPath(dishId)), context.db.doc(ratingRestaurantOperationLockPath(restaurantId)), context.db.doc(dishMergeReviewLockPath(dishId)));
  return (!dish.exists || dish.get("permanent") === true) && (!restaurant.exists || restaurant.get("permanent") === true) &&
    (!proposal.exists || proposal.get("state") === "merged_source" || (proposal.get("blocksClientReviews") === false && proposal.get("blocksClientAggregates") === false));
}

async function removeOwnedMenuReference(context: AccountDeletionStepContext, path: string, objects: AccountDeletionObjects): Promise<boolean> {
  const queries: Array<[string, string]> = [["storagePath", path], ...(await objects.referenceUrls(path)).map((url): [string, string] => ["imageUrl", url])];
  for (const [field, value] of queries) {
    const found = await context.db.collectionGroup("menu_images").where(field, "==", value).limit(1).get();
    if (found.empty) continue;
    const source = found.docs[0];
    const parts = source.ref.path.split("/");
    if (parts.length !== 4 || !["restaurant_accounts", "restaurant_menus"].includes(parts[0])) throw new Error("Unknown menu reference scope");
    const parentPath = parts.slice(0, 2).join("/");
    await reconcileCustomerBiteScoreMenuGeneration(createFirestoreCustomerBiteSaverSearchDatabase(context.db), parentPath, "menu_images", source.id);
    await context.db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(source.ref);
      if (current.get(field) === value) tx.delete(source.ref);
    });
    await reconcileCustomerBiteScoreMenuGeneration(createFirestoreCustomerBiteSaverSearchDatabase(context.db), parentPath, "menu_images", source.id);
    return true;
  }
  return false;
}

export async function accountDeletionOwnedObjectStep(context: AccountDeletionStepContext, objects: AccountDeletionObjects): Promise<boolean> {
  const {db, job} = context;
  const menus = await db.collection(`private_account_deletions/${job.uid}/menu_namespaces`).where("complete", "==", false).limit(1).get();
  const menu = menus.docs[0];
  const menuId = menu?.get("menuId");
  if (menu && (!validId(menuId) || (menu.get("preservedSharedRoot") !== true && (await db.doc(`restaurant_menus/${menuId}`).get()).exists))) throw new Error("Captured menu namespace is not retired");
  if (!menu && job.objectScanComplete === true) return true;
  const stateRef = menu?.ref ?? db.doc(`private_account_deletions/${job.uid}`);
  const after = menu ? menu.get("after") : job.objectScanAfter;
  const namespaceKey = menu ? `restaurant_menus/${menuId}` : `bitesaver_restaurants/${job.uid}`;
  const unresolved = await db.collection(`private_account_deletions/${job.uid}/object_items`).where("namespaceKey", "==", namespaceKey).where("disposition", "==", "pending").limit(1).get();
  const pendingItem = unresolved.docs[0];
  // A missing object after a lost delete acknowledgement must revisit its saved
  // intent, even though it no longer appears in the bucket listing.
  const path = pendingItem?.get("path") ?? (menu ? await objects.nextMenuPath(menuId, after ?? undefined) : await objects.nextOwnedPath(job.uid, after ?? undefined));
  if (path === null) {
    await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.update(stateRef, menu ? {complete: true} : {objectScanComplete: true}); });
    return false;
  }
  if (menu?.get("preservedSharedRoot") === true) throw new Error("Retained shared menu has historical objects without immutable uploader proof");
  const parts = String(path).split("/");
  const validScope = menu ? parts[0] === "restaurant_menus" && parts[1] === menuId && parts[2] === "menu_images" : parts[0] === "bitesaver_restaurants" && parts[1] === job.uid && ["restaurant_images", "coupon_images", "menu_images"].includes(parts[2]);
  if (parts.length !== 4 || !validScope || !validId(parts[3])) throw new Error("Unexpected account object path");
  const ref = db.doc(`private_account_deletions/${job.uid}/object_items/${key(path)}`);
  const item = pendingItem ?? await ref.get();
  if (!item.exists) {
    const generation = await objects.generation(path);
    await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.create(ref, {namespaceKey, path, generation, complete: generation === null, disposition: generation === null ? "already_absent" : "pending"}); });
    return false;
  }
  if (item.get("complete") !== true && item.get("disposition") !== "retained_shared") {
    {
      const current = await objects.generation(path);
      if (current !== null && current !== item.get("generation")) throw new Error("Account object generation changed");
      await db.runTransaction(async (tx) => { await context.assertLease(tx); });
      if (current !== null) await objects.deleteGeneration(path, item.get("generation"));
      if (await objects.generation(path) !== null) throw new Error("Account object absence unproven");
      await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.update(ref, {complete: true, disposition: "generation_deleted"}); });
    }
  }
  await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.update(stateRef, menu ? {after: path} : {objectScanAfter: path}); });
  return false;
}

function safeObjectLocator(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const prefix = "/v0/b/coupon-app-29446.firebasestorage.app/o/";
    if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com" || !url.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(url.pathname.slice(prefix.length));
  } catch { return null; }
}

function safeExternalLocation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" ? `${url.origin}${url.pathname}` : null; } catch { return null; }
}

/** Account-scoped abandoned and published immutable photos share this scan.
 * A copied URL is not independent ownership of A's bytes. B's own namespace
 * and publications are never deleted by this operation. */
export async function accountDeletionPersonalObjectStep(context: AccountDeletionStepContext, objects: AccountDeletionObjects): Promise<boolean> {
  const {db, job} = context;
  if (job.personalObjectScanComplete === true) return true;
  const namespaceKey = `bitescore_user_uploads/${job.uid}`;
  const unresolved = await db.collection(`private_account_deletions/${job.uid}/object_items`).where("namespaceKey", "==", namespaceKey).where("disposition", "==", "pending").limit(1).get();
  const pendingItem = unresolved.docs[0];
  const path = pendingItem?.get("path") ?? await objects.nextPersonalPath(job.uid, job.personalObjectScanAfter);
  if (path === null) {
    await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.update(db.doc(`private_account_deletions/${job.uid}`), {personalObjectScanComplete: true}); });
    return false;
  }
  const ref = db.doc(`private_account_deletions/${job.uid}/object_items/${key(path)}`);
  const item = pendingItem ?? await ref.get();
  const current = await objects.personalGeneration(path, job.uid);
  if (!item.exists) {
    await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.create(ref, {namespaceKey, path, generation: current, complete: current === null, disposition: current === null ? "already_absent" : "pending"}); });
    return false;
  }
  if (item.get("complete") !== true) {
    if (current !== null && current !== item.get("generation")) throw new Error("Personal object generation changed");
    await db.runTransaction(async (tx) => { await context.assertLease(tx); });
    if (current !== null) await objects.deleteGeneration(path, item.get("generation"));
    if (await objects.generation(path) !== null) throw new Error("Personal object absence unproven");
    await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.update(ref, {complete: true, disposition: "generation_deleted"}); });
  }
  await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.update(db.doc(`private_account_deletions/${job.uid}`), {personalObjectScanAfter: path}); });
  return false;
}
