import {ratingRestaurantOperationLockPath} from "./rating_destructive_job_contract.js";
import {accountDeletionLateMediaStep, type AccountDeletionFinalizedObjects} from "./account_deletion_finalized_media.js";
import {accountDeletionSettledWorkStep} from "./account_deletion_work.js";
import {createFirestoreDishProposalPrivateDatabase} from "./dish_proposal_private_store.js";
import {maintainDishEditProposalPrivateState, applyDishProposalMemberChange, parseDishProposalMemberDocument} from "./dish_proposal_private_maintenance.js";
import {dishProposalMemberPath} from "./dish_proposal_private_contract.js";
import {accountDeletionBusinessStep} from "./account_deletion_business.js";
import {accountDeletionPersonalObjectStep, accountDeletionOwnedObjectStep, deletionContributionIsUnlocked, accountDeletionPhotoStep, deleteAccountOwnedMenuObject, type AccountDeletionObjects} from "./account_deletion_media.js";
import {createHash} from "node:crypto";
import {FieldValue, type DocumentData, type Query, type Firestore} from "firebase-admin/firestore";
import {accountDeletionPath} from "./account_deletion_guard.js";
import {type AccountDeletionStep, type AccountDeletionStepContext, type DeletionStepResult} from "./account_deletion_service.js";
import {type AccountDeletionIdentity, type AccountDeletionReason} from "./account_deletion_contract.js";
import {reconcileAccountDeletionBilling, type AccountDeletionBillingAdapter} from "./account_deletion_billing.js";
import {createFirestoreRatingDestructivePrivateDatabase} from "./rating_destructive_job_store.js";
import {reconcileBiteScoreReviewAggregateEvent, biteScoreReviewAggregateStatePath, customerBiteScoreReviewDocumentId} from "./bitescore_review_aggregate.js";
import {reconcileCustomerBiteScoreFeedback, reconcileCustomerBiteScoreReview, reconcileCustomerBiteScoreImage} from "./customer_bitescore_reads.js";
import {customerBiteScoreProfileGenerationPath, reconcileCustomerBiteScoreFavoriteGeneration} from "./customer_bitescore_profile_generation.js";
import {createFirestoreCustomerBiteSaverSearchDatabase} from "./customer_bitesaver_search_store.js";
import {adminUserDirectoryDocumentPath, adminUserSourceSummaryDocumentPath, adminUserSourceKinds} from "./admin_user_directory_contract.js";
import {createDishReviewAggregateReviewerFingerprint} from "./dish_review_aggregate_accumulator.js";
import {reviewMilestoneReconciliationLockPath, reviewMilestoneReconciliationTerminalStatePath, parseReviewMilestoneReconciliationLockDocument} from "./review_milestone_reconciliation_lock.js";

export interface AccountDeletionAuth {
  /** Return null ONLY for auth/user-not-found, never for an ambiguous response. */
  getIdentity(uid: string): Promise<AccountDeletionIdentity | null>;
  deleteIdentity(uid: string): Promise<void>;
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const segment = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 1500 && value !== "." && value !== ".." && !/[\/\x00-\x1f]/u.test(value);
type Family = Readonly<{collection: string; field: string; mode: "review" | "feedback" | "imageVote" | "delete" | "catalog" | "menuActor" | "bio" | "proposal" | "notification" | "invitation"}>;
// Fixed server-owned list, never supplied by the caller. Query one source row
// per step; reconciliation evidence is saved BEFORE source removal.
const families: readonly Family[] = [
  {collection: "review_feedback_votes", field: "userId", mode: "feedback"},
  {collection: "bitescore_dish_image_votes", field: "userId", mode: "imageVote"},
  {collection: "dish_reviews", field: "userId", mode: "review"},
  ...["review_reports", "restaurant_reports", "dish_reports", "duplicate_restaurant_reports"].map((collection) => ({collection, field: "reportingUserId", mode: "delete" as const})),
  {collection: "bitesaver_reports", field: "reporterUid", mode: "delete"},
  {collection: "restaurant_name_change_requests", field: "userId", mode: "delete"},
  {collection: "bitescore_restaurants", field: "bioAuthorUid", mode: "bio"},
  {collection: "bitescore_restaurants", field: "createdByUserId", mode: "catalog"},
  {collection: "bitescore_restaurants", field: "menuSourceUpdatedBy", mode: "menuActor"},
  {collection: "bitescore_dishes", field: "createdByUserId", mode: "catalog"},
  {collection: "bitescore_contribution_point_ledger", field: "userId", mode: "delete"},
  {collection: "public_usernames", field: "userId", mode: "delete"},
  {collection: "restaurant_claim_requests", field: "requesterUserId", mode: "delete"},
  {collection: "admin_user_claimed_restaurant_index", field: "ownerUid", mode: "delete"},
  ...["userId", "createdByUserId"].map((field) => ({collection: "dish_edit_proposals", field, mode: "proposal" as const})),
  ...["authUid", "customerAccountUid"].flatMap((field) => [
    {collection: "proximity_push_requests", field, mode: "notification" as const},
    {collection: "customer_device_installations", field, mode: "delete" as const},
  ]),
  ...["createdByUid", "usedByUid", "revokedByUid", "restaurantId"].map((field) => ({collection: "restaurant_invites", field, mode: "invitation" as const})),
];
function familyQuery(db: Firestore, family: Family, uid: string): Query {
  const query = db.collection(family.collection).where(family.field, "==", uid);
  return family.collection === "restaurant_invites" && family.field === "restaurantId" ? query.where("side", "==", "coupon") : query;
}
const children = ["favorite_restaurants", "favorite_dishes", "favorite_coupons", "local_expert_badges", "local_expert_badge_celebrations", "coupon_redemptions"] as const;
const pending = (reason: Exclude<AccountDeletionReason, null>): DeletionStepResult => ({pending: reason, retry: reason === "accepted_work"});

/** Exact known unresolved branches fail closed before deleting personal rows.
 * They are reported as release gaps; no claim of complete media/owner support. */
async function preflight(context: AccountDeletionStepContext, auth: AccountDeletionAuth): Promise<AccountDeletionReason> {
  const {db, job} = context;
  const identity = await auth.getIdentity(job.uid);
  if (identity && identity.creationTime !== job.authCreationTime) return "identity_changed";
  if (identity?.privileged) return "ownership";
  if (identity?.providerIds.some((provider) => !["password", "google.com", "phone"].includes(provider))) return "provider";
  const milestone = await db.doc(reviewMilestoneReconciliationLockPath(job.uid)).get();
  try {
    if (parseReviewMilestoneReconciliationLockDocument(milestone.exists ? {id: milestone.id, data: milestone.data()!} : null)?.state === "active") return "accepted_work";
  } catch { return "accepted_work"; }
  return null;
}

async function leasedDelete(context: AccountDeletionStepContext, path: string, ownerField?: string): Promise<boolean> {
  return context.db.runTransaction(async (tx) => {
    await context.assertLease(tx);
    const ref = context.db.doc(path);
    const source = await tx.get(ref);
    if (!source.exists) return true;
    if (ownerField && source.get(ownerField) !== context.job.uid) return false;
    tx.delete(ref);
    return true;
  });
}

async function capture(context: AccountDeletionStepContext, query: Query, familyIndex: number): Promise<boolean> {
  return context.db.runTransaction(async (tx) => {
    await context.assertLease(tx);
    const page = await tx.get(query.limit(1));
    if (page.empty) return false;
    const source = page.docs[0], raw = source.data();
    // Only identity/scope prerequisites, never review text or profile dumps.
    const item: DocumentData = {sourceId: source.id, familyIndex, phase: "source"};
    for (const key of ["dishId", "restaurantId", "reviewId", "imageId"]) {
      if (typeof raw[key] === "string") item[key] = raw[key];
    }
    tx.update(context.db.doc(accountDeletionPath(context.job.uid)), {item});
    return true;
  });
}

async function removeImageVote(context: AccountDeletionStepContext, path: string): Promise<void> {
  await context.db.runTransaction(async (tx) => {
    await context.assertLease(tx);
    const voteRef = context.db.doc(path), vote = await tx.get(voteRef);
    if (!vote.exists) return;
    const raw = vote.data()!;
    if (raw.userId !== context.job.uid || !segment(raw.imageId)) throw new Error("Vote scope changed");
    const imageRef = context.db.doc(`bitescore_dish_images/${raw.imageId}`), image = await tx.get(imageRef);
    const field = raw.voteType === "helpful" ? "helpfulCount" : raw.voteType === "notHelpful" ? "notHelpfulCount" : null;
    if (!field) throw new Error("Unrecognized vote");
    if (image.exists) {
      if (image.get("dishId") !== raw.dishId || image.get("restaurantId") !== raw.restaurantId) throw new Error("Vote target changed");
      const count = image.get(field);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error("Vote accounting needs recovery");
      tx.update(imageRef, {[field]: count - 1});
    }
    tx.delete(voteRef);
  });
}

async function familyStep(context: AccountDeletionStepContext): Promise<DeletionStepResult> {
  const {db, job} = context, family = families[job.stageIndex];
  if (!family) return {phase: "children", stageIndex: 0, item: null};
  if (!job.item) {
    return await capture(context, familyQuery(db, family, job.uid), job.stageIndex)
      ? {} : {stageIndex: job.stageIndex + 1};
  }
  const item = job.item;
  if (item.familyIndex !== job.stageIndex || !segment(item.sourceId)) return pending("temporary_failure");
  const path = `${family.collection}/${item.sourceId}`;
  if (family.mode === "menuActor" || family.mode === "bio") {
    return db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(db.doc(path));
      const lock = await tx.get(db.doc(ratingRestaurantOperationLockPath(item.sourceId)));
      if (lock.exists && lock.get("permanent") !== true) return pending("accepted_work");
      if (current.exists && current.get(family.field) === job.uid) {
        const revision = current.get("restaurantWriteRevision") ?? 0;
        if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) return pending("ownership");
        tx.update(current.ref, {...(family.mode === "bio" ? {bio: FieldValue.delete(), bioAuthorUid: FieldValue.delete()} : {menuSourceUpdatedBy: FieldValue.delete()}), restaurantWriteRevision: revision + 1, updatedAt: FieldValue.serverTimestamp()});
      }
      return {item: null};
    });
  }
  if (family.mode === "proposal") {
    const store = createFirestoreDishProposalPrivateDatabase(db);
    await store.runTransaction(async (tx) => {
      const lease = await tx.getDocument(accountDeletionPath(job.uid));
      if (lease?.data.leaseToken !== job.leaseToken || Number(lease.data.leaseUntilMs) <= context.now()) throw new Error("Deletion lease changed");
      const source = await tx.getDocument(path);
      const memberPath = dishProposalMemberPath(item.sourceId);
      const member = parseDishProposalMemberDocument(await tx.getDocument(memberPath));
      const canonicalOwner = source?.data.userId ?? source?.data.createdByUserId;
      if (source && canonicalOwner !== job.uid) throw new Error("Proposal canonical owner changed");
      if (member && member.supporterUid !== job.uid) throw new Error("Proposal member owner changed");
      await applyDishProposalMemberChange(tx, {memberDocumentId: memberPath.slice(memberPath.lastIndexOf("/") + 1), existingMember: member, nextMembership: null}, new Date(context.now()));
      tx.deleteDocument(path);
    });
    return {item: null};
  }
  if (family.mode === "notification") {
    return db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(db.doc(path));
      if (current.exists && current.get(family.field) === job.uid) {
        if (current.get("status") === "processing") {
          const deadline = current.get("processingDeadlineAtMs");
          if (!Number.isSafeInteger(deadline) || deadline > context.now()) return pending("accepted_work");
        }
        tx.delete(current.ref);
      }
      return {item: null};
    });
  }
  if (family.mode === "invitation") {
    return db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(db.doc(path));
      if (!current.exists || current.get(family.field) !== job.uid) return {item: null};
      // Keep unrelated catalog invitation identity; erase A's account binding
      // and invalidate only the account-bound pending authorization.
      const patch: DocumentData = {[family.field]: FieldValue.delete(), ...(["createdByUid", "usedByUid"].includes(family.field) ? {[family.field.replace("Uid", "Email")]: FieldValue.delete()} : {})};
      if (current.get("status") === "active" && current.get("restaurantId") === job.uid && current.get("side") === "coupon") Object.assign(patch, {status: "revoked", revokedAt: FieldValue.serverTimestamp(), tokenHash: FieldValue.delete()});
      tx.update(current.ref, patch);
      return {item: null};
    });
  }
  if (family.mode === "catalog") {
    return db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const source = await tx.get(db.doc(path));
      if (family.collection === "bitescore_restaurants") {
        const lock = await tx.get(db.doc(ratingRestaurantOperationLockPath(source.id)));
        if (lock.exists && lock.get("permanent") !== true) return pending("accepted_work");
      }
      if (source.exists && source.get(family.field) === job.uid) {
        if (source.get("bio") && !source.get("bioAuthorUid")) return pending("ownership");
        const linkedReview = source.get("createdFromReviewId");
        const createdDish = family.collection === "bitescore_dishes" ? source.id : source.get("createdFromDishId");
        if (linkedReview && (!segment(createdDish) || linkedReview !== customerBiteScoreReviewDocumentId(createdDish, job.uid))) return pending("ownership");
        const patch: DocumentData = {createdByUserId: FieldValue.delete(), createdFromCreateFlow: FieldValue.delete(), ...(linkedReview ? {createdFromReviewId: FieldValue.delete()} : {})};
        if (family.collection === "bitescore_restaurants") {
          const revision = source.get("restaurantWriteRevision") ?? 0;
          if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) return pending("ownership");
          patch.restaurantWriteRevision = revision + 1;
        }
        tx.update(source.ref, patch);
      }
      return {item: null};
    });
  }
  if (family.mode === "review") {
    if (!segment(item.dishId)) return pending("temporary_failure");
    // Drain dependent feedback one row per step, capturing its ID before delete.
    if (item.voteId) {
      if (!segment(item.voteId)) return pending("temporary_failure");
      await db.runTransaction(async (tx) => {
        await context.assertLease(tx);
        const vote = await tx.get(db.doc(`review_feedback_votes/${item.voteId}`));
        if (vote.exists && vote.get("reviewId") !== item.sourceId) throw new Error("Feedback moved");
        tx.delete(vote.ref);
      });
      await reconcileCustomerBiteScoreFeedback(db, item.voteId);
      return {item: {...item, voteId: null}};
    }
    const votes = await db.collection("review_feedback_votes").where("reviewId", "==", item.sourceId).limit(1).get();
    if (!votes.empty) return {item: {...item, voteId: votes.docs[0].id}};
    const reports = await db.collection("review_reports").where("reviewId", "==", item.sourceId).limit(1).get();
    if (!reports.empty) {
      await db.runTransaction(async (tx) => {
        await context.assertLease(tx);
        const current = await tx.get(reports.docs[0].ref);
        if (current.exists && current.get("reviewId") === item.sourceId) tx.delete(current.ref);
      });
      return {};
    }
    const runtime = (await db.doc("private_bitescore_runtime/aggregation").get()).data();
    if (runtime?.enabled !== true || runtime.version !== 1 || typeof runtime.epoch !== "string") return pending("accepted_work");
    const removed = await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(db.doc(path));
      if (!current.exists) return true;
      if (current.get(family.field) !== job.uid) throw new Error("Review ownership changed");
      if (current.get("dishId") !== item.dishId || current.get("restaurantId") !== item.restaurantId) {
        if (item.previousDishId || !segment(current.get("dishId"))) throw new Error("Review scope needs reconciliation");
        tx.update(db.doc(accountDeletionPath(job.uid)), {item: {...item, previousDishId: item.dishId, dishId: current.get("dishId"), restaurantId: current.get("restaurantId")}});
        return false;
      }
      if (!await deletionContributionIsUnlocked(context, tx, item.dishId, item.restaurantId)) return false;
      tx.delete(current.ref);
      return true;
    });
    if (!removed) return {};
    const store = createFirestoreRatingDestructivePrivateDatabase(db);
    await reconcileBiteScoreReviewAggregateEvent(store, {reviewId: item.sourceId, before: {dishId: item.dishId, userId: job.uid}, after: null, now: new Date(context.now())});
    if (segment(item.previousDishId)) await reconcileBiteScoreReviewAggregateEvent(store, {reviewId: item.sourceId, before: {dishId: item.previousDishId, userId: job.uid}, after: null, now: new Date(context.now())});
    await reconcileCustomerBiteScoreReview(db, item.sourceId);
    for (const dishId of new Set([item.dishId, item.previousDishId].filter(segment))) {
      const state = (await db.doc(biteScoreReviewAggregateStatePath(dishId)).get()).data();
      if (state && state.status !== "ready" && state.status !== "retired") return pending("accepted_work");
    }
    // Other A reviews on the same dish may still be the accounted winner;
    // continue removing them before the final account-scoped verification.
    await leasedDelete(context, `private_bitescore_review_stats/${digest(item.sourceId)}`);
  } else if (family.mode === "feedback") {
    if (!await leasedDelete(context, path, family.field)) return pending("identity_changed");
    await reconcileCustomerBiteScoreFeedback(db, item.sourceId);
  } else if (family.mode === "imageVote") {
    await removeImageVote(context, path);
    if (segment(item.imageId)) await reconcileCustomerBiteScoreImage(db, item.imageId);
  } else if (!await leasedDelete(context, path, family.field)) return pending("identity_changed");
  return {item: null};
}

async function childrenStep(context: AccountDeletionStepContext): Promise<DeletionStepResult> {
  const {db, job} = context, child = children[job.stageIndex];
  if (!child) return {phase: "verify", stageIndex: 0, item: null};
  const parent = child === "coupon_redemptions" ? "customer_redemptions" : "user_profiles";
  const collection = `${parent}/${job.uid}/${child}`;
  if (!job.item) return await capture(context, db.collection(collection), job.stageIndex) ? {} : {stageIndex: job.stageIndex + 1};
  if (!segment(job.item.sourceId) || job.item.familyIndex !== job.stageIndex) return pending("temporary_failure");
  await leasedDelete(context, `${collection}/${job.item.sourceId}`);
  if (child === "favorite_restaurants" || child === "favorite_dishes") await reconcileCustomerBiteScoreFavoriteGeneration(createFirestoreCustomerBiteSaverSearchDatabase(db), job.uid, child, job.item.sourceId);
  return {item: null};
}

async function hasRemainingPrivateState(context: AccountDeletionStepContext): Promise<boolean> {
  const {db, job} = context;
  // Material retained work is visible rather than declared erased. These
  // indexed queries do not scan all application data.
  for (const [collection, field] of [["private_bitescore_review_index", "userId"], ["private_rating_destructive_job_items", "userId"], ["private_dish_edit_proposal_group_members", "supporterUid"], ["private_dish_edit_proposal_group_supporters", "supporterUid"]]) {
    if (!(await db.collection(collection).where(field, "==", job.uid).limit(1).get()).empty) return true;
  }
  if (!(await db.collectionGroup("contributions").where("candidate.userId", "==", job.uid).limit(1).get()).empty) return true;
  if (!(await db.collectionGroup("aggregate_winners").where("reviewerFingerprint", "==", createDishReviewAggregateReviewerFingerprint(job.uid)).limit(1).get()).empty) return true;
  const fingerprint = digest(JSON.stringify(["bitestar.review-milestone-accumulator.v2", ["userId", job.uid]]));
  if (!(await db.collection("private_review_milestone_count_accumulators").where("userFingerprint", "==", fingerprint).limit(1).get()).empty) return true;
  return false;
}

async function hasUnresolvedMedia(context: AccountDeletionStepContext): Promise<boolean> {
  const {db, job} = context;
  for (const [path, field, value] of [
    [`private_account_deletions/${job.uid}/media_items`, "disposition", "unproven_original_uploader"],
    [`private_account_deletions/${job.uid}/object_items`, "complete", false],
    [`private_account_deletions/${job.uid}/menu_namespaces`, "complete", false],
    ["bitescore_dish_images", "uploadedByUserId", job.uid],
    ["restaurant_menus", "createdByUserId", job.uid],
  ] as const) if (!(await db.collection(path).where(field, "==", value).limit(1).get()).empty) return true;
  if (!(await db.collection("private_menu_image_upload_authorizations").where("ownerUserId", "==", job.uid).where("state", "in", ["active", "revoked"]).limit(1).get()).empty) return true;
  return job.objectScanComplete !== true || job.personalObjectScanComplete !== true;
}

function personalRootPaths(uid: string): string[] {
  return [`user_profiles/${uid}`, `public_reviewer_profiles/${uid}`, `customer_redemptions/${uid}`,
    `private_bitescore_reviewer_stats/${digest(uid)}`, customerBiteScoreProfileGenerationPath(uid),
    reviewMilestoneReconciliationTerminalStatePath(uid),
    adminUserDirectoryDocumentPath(uid), ...adminUserSourceKinds.map((sourceKind) => adminUserSourceSummaryDocumentPath({uid, sourceKind}))];
}

export function createAccountDeletionStep(auth: AccountDeletionAuth, billing?: AccountDeletionBillingAdapter, objects?: AccountDeletionObjects, finalizedObjects?: AccountDeletionFinalizedObjects): AccountDeletionStep {
  return async (context) => {
    const {db, job} = context;
    const currentIdentity = await auth.getIdentity(job.uid);
    if (currentIdentity && currentIdentity.creationTime !== job.authCreationTime) return pending("identity_changed");
    if (currentIdentity?.privileged) return pending("ownership");
    // Billing is prioritized on every pass, including late events during cleanup.
    try {
      const unavailable = async (): Promise<never> => { throw new Error("Billing adapter unavailable"); };
      if (!await reconcileAccountDeletionBilling(context, billing ?? {listCheckouts: unavailable, listSubscriptions: unavailable, retrieveSubscription: unavailable, cancelSubscription: unavailable, retrieveCheckout: unavailable, expireCheckout: unavailable, replayCheckout: unavailable})) return {};
    } catch { return {pending: "billing", retry: true}; }
    try { if (!await accountDeletionLateMediaStep(db, job.uid, auth.getIdentity, finalizedObjects)) return {}; }
    catch { return {pending: "media", retry: true}; }
    if (job.phase === "media") return await accountDeletionPhotoStep(context, objects) ? {phase: "business"} : {};
    if (job.phase === "business") {
      if (!await accountDeletionBusinessStep(context)) return {};
      const grants = await db.collection("private_menu_image_upload_authorizations").where("ownerUserId", "==", job.uid).where("state", "in", ["active", "revoked"]).limit(1).get();
      if (!grants.empty) {
        if (!objects) return pending("media");
        if (await deleteAccountOwnedMenuObject(context, grants.docs[0].id, objects)) await db.runTransaction(async (tx) => {
          await context.assertLease(tx);
          const grant = await tx.get(grants.docs[0].ref);
          if (grant.get("ownerUserId") !== job.uid || grant.get("state") !== "revoked") throw new Error("Upload authority changed");
          // Retain only the already trusted target proof, never upload access.
          // Late finalizations still resolve after profile/Auth removal.
          tx.set(grant.ref, {schemaVersion: 1, state: "retired", ownerUserId: job.uid,
            sourceType: grant.get("sourceType"), sourceId: grant.get("sourceId"), fileName: grant.get("fileName"), deletionOperationId: job.operationId});
        });
        return {};
      }
      if (!objects) return pending("media");
      if (!await accountDeletionOwnedObjectStep(context, objects)) return {};
      if (!await accountDeletionPersonalObjectStep(context, objects)) return {};
      return {phase: "contributions", stageIndex: 0};
    }
    if (job.phase === "preflight") {
      const reason = await preflight(context, auth);
      return reason ? pending(reason) : {phase: "media", stageIndex: 0};
    }
    if (job.phase === "contributions") return familyStep(context);
    if (job.phase === "children") return childrenStep(context);
    if (job.phase === "verify") {
      const reason = await preflight(context, auth);
      if (reason) return pending(reason);
      for (const family of families) if (!(await familyQuery(db, family, job.uid).limit(1).get()).empty) return {phase: "contributions", stageIndex: 0};
      for (const child of children) if (!(await db.collection(`${child === "coupon_redemptions" ? "customer_redemptions" : "user_profiles"}/${job.uid}/${child}`).limit(1).get()).empty) return {phase: "children", stageIndex: 0};
      try { if (!await accountDeletionSettledWorkStep(context)) return {}; } catch { return pending("accepted_work"); }
      const privateMembers = await db.collection("private_dish_edit_proposal_group_members").where("supporterUid", "==", job.uid).limit(1).get();
      if (!privateMembers.empty) {
        const member = privateMembers.docs[0];
        const proposalId = member.get("proposalDocumentId");
        if (!segment(proposalId)) return pending("accepted_work");
        await maintainDishEditProposalPrivateState(createFirestoreDishProposalPrivateDatabase(db), proposalId, new Date(context.now()));
        return {};
      }
      if (await hasRemainingPrivateState(context)) return pending("accepted_work");
      if (await hasUnresolvedMedia(context)) return pending("media");
      return {phase: "identity"};
    }
    if (job.phase === "identity") {
      await db.runTransaction(async (tx) => {
        await context.assertLease(tx);
        const paths = personalRootPaths(job.uid);
        for (const path of paths) tx.delete(db.doc(path));
      });
      return {phase: "auth"};
    }
    if (job.phase === "auth") {
      const reason = await preflight(context, auth);
      if (reason) return pending(reason);
      // A transaction lease check precedes each external side effect. The
// creationTime detects an already replaced UID. Auth has no delete etag;
      // privileged operators must not reuse an identical UID during deletion.
      await db.runTransaction(async (tx) => {
        const current = await context.assertLease(tx);
        if ((current.billingRevision ?? 0) !== (job.billingRevision ?? 0)) throw new Error("Billing changed before Auth removal");
        for (const path of [`private_account_deletions/${job.uid}/billing_intents`, `private_owner_billing_states/${job.uid}/checkout_intents`]) {
          if (!(await tx.get(db.collection(path).where("terminal", "==", false).limit(1))).empty) throw new Error("Billing remains unsettled");
        }
      });
      const identity = await auth.getIdentity(job.uid);
      if (identity && identity.creationTime !== job.authCreationTime) return pending("identity_changed");
      if (identity) await auth.deleteIdentity(job.uid);
      return {phase: "auth_verify"};
    }
    if (job.phase === "auth_verify") {
      const identity = await auth.getIdentity(job.uid);
      if (identity) return pending(identity.creationTime === job.authCreationTime ? "temporary_failure" : "identity_changed");
      const reason = await preflight(context, auth);
      if (reason) return pending(reason);
      for (const family of families) if (!(await familyQuery(db, family, job.uid).limit(1).get()).empty) return {phase: "contributions", stageIndex: 0};
      for (const child of children) if (!(await db.collection(`${child === "coupon_redemptions" ? "customer_redemptions" : "user_profiles"}/${job.uid}/${child}`).limit(1).get()).empty) return {phase: "children", stageIndex: 0};
      try { if (!await accountDeletionSettledWorkStep(context)) return {}; } catch { return pending("accepted_work"); }
      const privateMembers = await db.collection("private_dish_edit_proposal_group_members").where("supporterUid", "==", job.uid).limit(1).get();
      if (!privateMembers.empty) {
        const member = privateMembers.docs[0];
        const proposalId = member.get("proposalDocumentId");
        if (!segment(proposalId)) return pending("accepted_work");
        await maintainDishEditProposalPrivateState(createFirestoreDishProposalPrivateDatabase(db), proposalId, new Date(context.now()));
        return {};
      }
      if (await hasRemainingPrivateState(context)) return pending("accepted_work");
      const roots = await db.getAll(...personalRootPaths(job.uid).map((path) => db.doc(path)));
      if (roots.some((root) => root.exists)) return {phase: "identity"};
      if (await hasUnresolvedMedia(context)) return pending("media");
      return {complete: true};
    }
    return pending("temporary_failure");
  };
}
