import {createHash} from "node:crypto";
import {FieldValue, type Firestore, type Transaction} from "firebase-admin/firestore";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {requireAuthenticatedRestaurantAccountActor, requireRestaurantAccountAdminAccess} from "./admin_authorization.js";
import {accountDeletionPath, requireAccountWritable} from "./account_deletion_guard.js";
import {customerBiteScoreImage, customerBiteScorePhotoVersion, reconcileCustomerBiteScoreImage} from "./customer_bitescore_reads.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {ratingDishOperationLockPath, ratingRestaurantOperationLockPath} from "./rating_destructive_job_contract.js";
import {dishMergeReviewLockPath} from "./dish_proposal_private_contract.js";
import {reviewerReportReasons} from "./reviewer_safety.js";
import {createFirestoreSearchIndexDatabase, reconcileBiteScoreDishIndex} from "./search_index_maintenance.js";
import {biteScoreRestaurantIsActive} from "./search_index_builders.js";

type Data = Record<string, unknown>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const photoReportAdmissionLimit = 12;
export const photoReportStatePath = (uid: string) => `user_profiles/${uid}/photo_report_state`;
function invalid(): never { throw new HttpsError("invalid-argument", "Invalid photo report request."); }
function id(value: unknown): string {
  const parsed = readBiteScoreCatalogRestaurantId(value);
  if (!parsed || parsed !== value) invalid();
  return parsed;
}
function parse(raw: unknown, keys: string[]): Data {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
  const data = raw as Data;
  if (data.schemaVersion !== 1 || Object.keys(data).sort().join("|") !== keys.sort().join("|")) invalid();
  return data;
}
function actor(request: CallableRequest<unknown>, data: Data): string {
  const {uid} = requireAuthenticatedRestaurantAccountActor(request);
  accountDeletionPath(uid);
  if (uid !== request.auth?.uid || data.expectedUserId !== uid) throw new HttpsError("permission-denied", "The signed-in account changed.");
  return uid;
}
// Immutable target proof, without retaining a URL/token or copying media into
// a case. A replacement at the same document ID must never inherit a removal.
export function photoReportTargetFingerprint(source: Data): string {
  return customerBiteScorePhotoVersion(source);
}
async function parent(db: Firestore, tx: Transaction, dishId: string, restaurantId: string): Promise<void> {
  const [runtime, dish, restaurant, dishLock, restaurantLock, merge] = await tx.getAll(
    db.doc("private_bitescore_runtime/aggregation"), db.doc(`bitescore_dishes/${dishId}`), db.doc(`bitescore_restaurants/${restaurantId}`),
    db.doc(ratingDishOperationLockPath(dishId)), db.doc(ratingRestaurantOperationLockPath(restaurantId)), db.doc(dishMergeReviewLockPath(dishId)));
  if (runtime.get("enabled") !== true || runtime.get("version") !== 1 || typeof runtime.get("epoch") !== "string" || !runtime.get("epoch")) {
    throw new HttpsError("failed-precondition", "Photo reporting is not available yet.");
  }
  if (!dish.exists || dish.get("restaurantId") !== restaurantId || dish.get("isActive") === false || dish.get("active") === false ||
      dish.get("mergedIntoDishId") || !restaurant.exists || !biteScoreRestaurantIsActive(restaurant.data()!)) {
    throw new HttpsError("not-found", "This photo's dish is unavailable.");
  }
  if (dishLock.exists || restaurantLock.exists || merge.get("blocksClientReviews") === true || merge.get("blocksClientAggregates") === true || merge.get("state") === "merged_source") {
    throw new HttpsError("unavailable", "Dish photos are temporarily locked. Please try again.");
  }
}

export async function submitPhotoReportHandler(db: Firestore, request: CallableRequest<unknown>, nowMs = Date.now()): Promise<Data> {
  const data = parse(request.data, ["schemaVersion", "expectedUserId", "imageId", "dishId", "restaurantId", "reason", "requestId", "reportTargetVersion"]);
  const uid = actor(request, data), imageId = id(data.imageId), dishId = id(data.dishId), restaurantId = id(data.restaurantId);
  if (typeof data.reason !== "string" || !reviewerReportReasons.includes(data.reason) || typeof data.requestId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(data.requestId)) invalid();
  if (typeof data.reportTargetVersion !== "string" || !/^[a-f0-9]{64}$/.test(data.reportTargetVersion)) invalid();
  const fingerprint = hash([imageId, dishId, restaurantId, data.reason, data.reportTargetVersion]);
  const state = photoReportStatePath(uid);
  const receiptRef = db.doc(`${state}/request_${hash(data.requestId)}`), guardRef = db.doc(`${state}/pending_${hash(imageId)}`), admissionRef = db.doc(`${state}/admission`);
  return db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, uid);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.get("fingerprint") !== fingerprint) throw new HttpsError("already-exists", "This request ID was already used.");
      return {schemaVersion: 1, reportId: receipt.get("reportId"), imageId, submitted: false};
    }
    const source = (await tx.get(db.doc(`bitescore_dish_images/${imageId}`))).data();
    if (!source || !customerBiteScoreImage(imageId, source, dishId, restaurantId) || typeof source.uploadedByUserId !== "string") {
      throw new HttpsError("not-found", "This photo is no longer available.");
    }
    if (photoReportTargetFingerprint(source) !== data.reportTargetVersion) throw new HttpsError("failed-precondition", "This photo changed. Refresh the photos before reporting.");
    await requireAccountWritable(db, tx, source.uploadedByUserId);
    await parent(db, tx, dishId, restaurantId);
    const [guard, admission] = await tx.getAll(guardRef, admissionRef);
    const previous = typeof guard.get("reportId") === "string" ? await tx.get(db.doc(`review_reports/${id(guard.get("reportId"))}`)) : null;
    if (previous?.exists && (previous.get("reportScope") !== "photo" || previous.get("reportingUserId") !== uid || previous.get("imageId") !== imageId)) {
      throw new HttpsError("failed-precondition", "Photo report state needs recovery.");
    }
    const windowAt = admission.get("windowAtMs");
    const sameWindow = typeof windowAt === "number" && nowMs - windowAt < 60_000;
    const used = sameWindow ? admission.get("count") : 0;
    if (!Number.isSafeInteger(used) || used < 0) throw new HttpsError("failed-precondition", "Photo report admission needs recovery.");
    if (used >= photoReportAdmissionLimit) throw new HttpsError("resource-exhausted", "Please wait before submitting another report.");
    const submitted = previous?.get("status") !== "pending" || previous?.get("targetFingerprint") !== data.reportTargetVersion;
    const reportId = submitted ? `photo_${hash([uid, data.requestId])}` : previous!.id;
    if (submitted) tx.create(db.doc(`review_reports/${reportId}`), {
      schemaVersion: 1, reportScope: "photo", id: reportId, imageId, dishId, restaurantId,
      reportingUserId: uid, reportedUserId: source.uploadedByUserId, reason: data.reason, status: "pending",
      // Deliberately not reviewId: ordinary review deletion must not delete this case.
      supportingReviewId: readBiteScoreCatalogRestaurantId(source.reviewId), targetFingerprint: photoReportTargetFingerprint(source),
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(guardRef, {reportId});
    tx.create(receiptRef, {reportId, fingerprint});
    tx.set(admissionRef, {windowAtMs: sameWindow ? windowAt : nowMs, count: used + 1});
    return {schemaVersion: 1, reportId, imageId, submitted};
  });
}

/** Admin-only exact-photo soft removal. Never deletes Storage, votes or reviews.
 * Source triggers retry projection reconciliation if the response is interrupted. */
export async function moderatePhotoReportHandler(db: Firestore, request: CallableRequest<unknown>): Promise<Data> {
  requireRestaurantAccountAdminAccess(request);
  const data = parse(request.data, ["schemaVersion", "expectedUserId", "reportId", "imageId", "action"]);
  const uid = actor(request, data), reportId = id(data.reportId), imageId = id(data.imageId);
  if (data.action !== "dismiss" && data.action !== "remove") invalid();
  const targetCase = (await db.doc(`review_reports/${reportId}`).get()).data();
  if (targetCase?.reportScope !== "photo" || targetCase.imageId !== imageId) throw new HttpsError("not-found", "This photo report is unavailable.");
  // Establish existing accounting before an early moderation outruns creation.
  if (data.action === "remove") await reconcileCustomerBiteScoreImage(db, imageId);
  const result = await db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, uid);
    const ref = db.doc(`review_reports/${reportId}`), report = await tx.get(ref);
    if (!report.exists || report.get("reportScope") !== "photo" || report.get("schemaVersion") !== 1 || report.get("imageId") !== imageId) {
      throw new HttpsError("not-found", "This photo report is unavailable.");
    }
    await requireAccountWritable(db, tx, report.get("reportingUserId"));
    await requireAccountWritable(db, tx, report.get("reportedUserId"));
    const status = data.action === "dismiss" ? "dismissed" : "resolved";
    if (data.action === "dismiss" && report.get("removalRequested") === true) throw new HttpsError("failed-precondition", "Photo removal is in progress. Finish removing the photo.");
    if (report.get("status") === status) return {schemaVersion: 1, reportId, imageId, status};
    if (report.get("status") !== "pending") throw new HttpsError("failed-precondition", "This report has already been handled. Refresh the queue.");
    const imageRef = db.doc(`bitescore_dish_images/${imageId}`), image = await tx.get(imageRef);
    if (data.action === "remove" && image.exists) {
      const source = image.data()!;
      if (photoReportTargetFingerprint(source) !== report.get("targetFingerprint")) throw new HttpsError("failed-precondition", "This photo changed. Refresh the case before continuing.");
      // A retry finishes the already-authorized exact removal even if its
      // parents have since retired. First removal still requires live parents.
      if (source.moderationStatus !== "removed") {
        await parent(db, tx, id(report.get("dishId")), id(report.get("restaurantId")));
        tx.update(imageRef, {moderationStatus: "removed", moderatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
      }
    }
    tx.update(ref, {status: data.action === "remove" ? "pending" : status,
      ...(data.action === "remove" ? {removalRequested: true} : {}), updatedAt: FieldValue.serverTimestamp()});
    return {schemaVersion: 1, reportId, imageId, status};
  });
  if (data.action === "remove") {
    await reconcileCustomerBiteScoreImage(db, imageId);
    await reconcileBiteScoreDishIndex(createFirestoreSearchIndexDatabase(db), id(targetCase.dishId), new Date());
    // Keep the case pending until public projections complete. An interrupted
    // attempt is visibly retryable; never recreate a case erased by deletion.
    await db.runTransaction(async tx => {
      await requireAccountWritable(db, tx, uid);
      const ref = db.doc(`review_reports/${reportId}`), current = await tx.get(ref);
      if (!current.exists) throw new HttpsError("not-found", "This report is no longer available.");
      await requireAccountWritable(db, tx, current.get("reportingUserId"));
      await requireAccountWritable(db, tx, current.get("reportedUserId"));
      if (current.get("imageId") !== imageId || current.get("reportScope") !== "photo" ||
          !["pending", "resolved"].includes(current.get("status"))) throw new HttpsError("failed-precondition", "This report changed. Refresh the queue.");
      tx.update(ref, {status: "resolved", updatedAt: FieldValue.serverTimestamp()});
    });
  }
  return result;
}

/** Live, authorized queue preview only; no snapshot URL in the retained case. */
export function photoReportAdminProjection(reportId: string, report: Data, image: Data | undefined, dish: Data | undefined, restaurant: Data | undefined): Data | null {
  if (report.reportScope !== "photo" || report.schemaVersion !== 1 || !readBiteScoreCatalogRestaurantId(report.imageId) ||
      !readBiteScoreCatalogRestaurantId(report.dishId) || !readBiteScoreCatalogRestaurantId(report.restaurantId) || typeof report.reason !== "string") return null;
  const matches = image && photoReportTargetFingerprint(image) === report.targetFingerprint;
  const safe = matches ? customerBiteScoreImage(String(report.imageId), image, String(report.dishId), String(report.restaurantId)) : null;
  const available = safe !== null;
  const state = !image ? "unavailable" : !matches ? "changed" : image.moderationStatus === "removed" ? "removed" : available ? "available" : "unavailable";
  const name = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : null;
  return {kind: "reportedReviews", id: reportId, reportId, reportScope: "photo", schemaVersion: 1,
    imageId: report.imageId, dishId: report.dishId, restaurantId: report.restaurantId, supportingReviewId: report.supportingReviewId ?? null,
    reason: report.reason, status: report.status, imageState: state, imageUrl: available ? safe!.imageUrl : null,
    dishName: name(dish?.name) ?? "Unknown dish", restaurantName: name(restaurant?.name) ?? "Unknown restaurant"};
}
