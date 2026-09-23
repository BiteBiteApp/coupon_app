import {ratingRestaurantOperationLockPath} from "./rating_destructive_job_contract.js";
import {createFirestoreCustomerBiteSaverSearchDatabase} from "./customer_bitesaver_search_store.js";
import {reconcileCustomerBiteScoreMenuGeneration} from "./customer_bitescore_menu_search.js";
import {createHash} from "node:crypto";
import {FieldValue, type DocumentData} from "firebase-admin/firestore";
import type {AccountDeletionStepContext} from "./account_deletion_service.js";

const menuKinds = ["menu_images", "menu_items", "menu_sections"] as const;
const businessKinds = ["coupons", "daily_specials", ...menuKinds, "coupon_number_reservations", "coupon_code_reservations"] as const;
const financialTombstoneFields = new Set(["accountDeletionRequested", "couponPostingEnabled", "adminHidden", "stripeCustomerId", "stripeSubscriptionId", "subscriptionStatus", "cancelAtPeriodEnd", "subscriptionEndsAt", "trialEndsAt", "billingPlanName", "hasUsedTrial", "updatedAt"]);
const segment = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !/[\/\x00-\x1f]/u.test(value);

/** One exact owner-scoped leaf per pass. A different current catalog claimant
 * is never overwritten using an old A-created menu reference. */
export async function accountDeletionBusinessStep(context: AccountDeletionStepContext): Promise<boolean> {
  const {db, job} = context;
  const menus = await db.collection("restaurant_menus").where("createdByUserId", "==", job.uid).limit(1).get();
  if (!menus.empty) {
    const root = menus.docs[0];
    const restaurantId = root.get("bitescoreRestaurantId");
    if (!segment(restaurantId)) throw new Error("Shared menu catalog identity unproven");
    const catalogRef = db.doc(`bitescore_restaurants/${restaurantId}`);
    // Menu facts and B's edits are shared records, not A-personal property.
    // Retire only A's attribution; server-granted A image targets are handled
    // separately with exact object ownership and generation checks.
    await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const [current, catalog, lock] = await tx.getAll(root.ref, catalogRef, db.doc(ratingRestaurantOperationLockPath(restaurantId)));
      if (lock.exists && lock.get("permanent") !== true) throw new Error("Accepted restaurant work remains active");
      if (!current.exists || current.get("createdByUserId") !== job.uid || current.get("bitescoreRestaurantId") !== restaurantId) throw new Error("Shared menu attribution changed");
      const namespaceRef = db.doc(`private_account_deletions/${job.uid}/menu_namespaces/${createHash("sha256").update(root.id).digest("hex")}`);
      const namespace = await tx.get(namespaceRef);
      if (!namespace.exists) tx.create(namespaceRef, {menuId: root.id, complete: false, after: null, preservedSharedRoot: true});
      tx.update(root.ref, {createdByUserId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp()});
      // No new owner is invented, and the catalog/menu pointer stays intact.
      if (catalog.exists && catalog.get("sharedMenuId") === root.id) {
        const revision = catalog.get("restaurantWriteRevision") ?? 0;
        if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new Error("Catalog revision invalid");
        tx.update(catalog.ref, {restaurantWriteRevision: revision + 1, updatedAt: FieldValue.serverTimestamp()});
      }
    });
    return false;
  }
  const claims = await db.collection("bitescore_restaurants").where("ownerUserId", "==", job.uid).limit(1).get();
  if (!claims.empty) {
    await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(claims.docs[0].ref);
      if (current.get("ownerUserId") !== job.uid) return;
      const lock = await tx.get(db.doc(ratingRestaurantOperationLockPath(current.id)));
      if (lock.exists && lock.get("permanent") !== true) throw new Error("Accepted restaurant work remains active");
      const revision = current.get("restaurantWriteRevision") ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new Error("Catalog revision invalid");
      const patch: DocumentData = {ownerUserId: null, isClaimed: false, claimInvitationEpochAt: FieldValue.serverTimestamp(), restaurantWriteRevision: revision + 1, updatedAt: FieldValue.serverTimestamp()};
      if (current.get("linkedBiteSaverUid") === job.uid) {patch.linkedBiteSaverUid = FieldValue.delete(); patch.menuSourceSide = "biteScore";}
      tx.update(current.ref, patch);
    });
    return false;
  }
  const linked = await db.collection("bitescore_restaurants").where("linkedBiteSaverUid", "==", job.uid).limit(1).get();
  if (!linked.empty) {
    await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(linked.docs[0].ref);
      if (current.get("linkedBiteSaverUid") !== job.uid) return;
      const lock = await tx.get(db.doc(ratingRestaurantOperationLockPath(current.id)));
      if (lock.exists && lock.get("permanent") !== true) throw new Error("Accepted restaurant work remains active");
      const revision = current.get("restaurantWriteRevision") ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new Error("Catalog revision invalid");
      tx.update(current.ref, {linkedBiteSaverUid: FieldValue.delete(), menuSourceSide: "biteScore", restaurantWriteRevision: revision + 1, updatedAt: FieldValue.serverTimestamp()});
    });
    return false;
  }
  const root = db.doc(`restaurant_accounts/${job.uid}`);
  for (const kind of businessKinds) {
    const page = await root.collection(kind).limit(1).get();
    if (page.empty) continue;
    const leaf = page.docs[0];
    if ((menuKinds as readonly string[]).includes(kind)) await reconcileCustomerBiteScoreMenuGeneration(createFirestoreCustomerBiteSaverSearchDatabase(db), root.path, kind as typeof menuKinds[number], leaf.id);
    await db.runTransaction(async (tx) => { await context.assertLease(tx); tx.delete(leaf.ref); });
    if ((menuKinds as readonly string[]).includes(kind)) await reconcileCustomerBiteScoreMenuGeneration(createFirestoreCustomerBiteSaverSearchDatabase(db), root.path, kind as typeof menuKinds[number], leaf.id);
    return false;
  }
  const current = await root.get();
  if (current.exists) {
    const removed = await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const snapshot = await tx.get(root);
      if (!snapshot.exists) return false;
      const fields = Object.keys(snapshot.data()!).filter((field) => !financialTombstoneFields.has(field));
      if (fields.length === 0 && snapshot.get("couponPostingEnabled") === false && snapshot.get("adminHidden") === true) return false;
      tx.update(root, {...Object.fromEntries(fields.map((field) => [field, FieldValue.delete()])), accountDeletionRequested: true, couponPostingEnabled: false, adminHidden: true});
      return true;
    });
    if (removed) return false;
  }
  return true;
}
