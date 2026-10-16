import {type Firestore, type Transaction} from "firebase-admin/firestore";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {requireAuthenticatedRestaurantAccountActor, requireRestaurantAccountAdminAccess} from "./admin_authorization.js";
import {accountDeletionPath, requireAccountWritable} from "./account_deletion_guard.js";
import {postingRestrictionPath, postingRestrictionStatus} from "./posting_restriction_guard.js";
import {photoReportTargetFingerprint} from "./photo_reports.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";

type Data = Record<string, unknown>;
function invalid(): never { throw new HttpsError("invalid-argument", "Invalid posting restriction request."); }
function uid(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim()) invalid();
  accountDeletionPath(value);
  return value;
}
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
function actor(request: CallableRequest<unknown>, data: Data, admin: boolean): string {
  const identity = admin ? requireRestaurantAccountAdminAccess(request) : requireAuthenticatedRestaurantAccountActor(request);
  const actual = uid(identity.uid);
  if (actual !== request.auth?.uid || actual !== data.expectedUserId) throw new HttpsError("permission-denied", "The signed-in account changed.");
  return actual;
}
/** Report text/display names are never identity. Legacy reports must still
 * have the exact review; photo reports must still match the exact image. */
async function reportTarget(db: Firestore, tx: Transaction, reportId: string): Promise<string> {
  const report = (await tx.get(db.doc(`review_reports/${reportId}`))).data();
  if (!report) throw new HttpsError("not-found", "This report is no longer available.");
  if (report.reportScope === "reviewer" && report.schemaVersion === 1 && report.evidence) return uid(report.reportedUserId);
  if (report.reportScope === "photo" && report.schemaVersion === 1) {
    const image = (await tx.get(db.doc(`bitescore_dish_images/${id(report.imageId)}`))).data();
    if (image && image.uploadedByUserId === report.reportedUserId && image.dishId === report.dishId && image.restaurantId === report.restaurantId &&
        photoReportTargetFingerprint(image) === report.targetFingerprint) return uid(image.uploadedByUserId);
  } else if (report.reportScope === undefined || report.reportScope === "review") {
    const review = (await tx.get(db.doc(`dish_reviews/${id(report.reviewId)}`))).data();
    if (review && review.dishId === report.dishId && review.restaurantId === report.restaurantId) return uid(review.userId);
  }
  throw new HttpsError("failed-precondition", "This report no longer establishes the contributor's identity.");
}
export async function getCustomerPostingStatusHandler(db: Firestore, request: CallableRequest<unknown>, clock = Date.now): Promise<Data> {
  const data = parse(request.data, ["schemaVersion", "expectedUserId"]), userId = actor(request, data, false);
  return db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, userId);
    const state = (await tx.get(db.doc(postingRestrictionPath(userId)))).data();
    return {schemaVersion: 1, ...postingRestrictionStatus(state, clock())};
  });
}
export async function getAdminPostingRestrictionHandler(db: Firestore, request: CallableRequest<unknown>, clock = Date.now): Promise<Data> {
  const data = parse(request.data, ["schemaVersion", "expectedUserId", "reportId", "targetUserId"]), admin = actor(request, data, true);
  if ((data.reportId === null) === (data.targetUserId === null)) invalid();
  return db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, admin);
    const target = data.reportId === null ? uid(data.targetUserId) : await reportTarget(db, tx, id(data.reportId));
    await requireAccountWritable(db, tx, target);
    const state = (await tx.get(db.doc(postingRestrictionPath(target)))).data();
    if (data.reportId === null && !state) throw new HttpsError("not-found", "No posting restriction exists for this exact UID.");
    return {schemaVersion: 1, targetUserId: target, ...postingRestrictionStatus(state, clock())};
  });
}
export async function setAdminPostingRestrictionHandler(db: Firestore, request: CallableRequest<unknown>, clock = Date.now): Promise<Data> {
  const data = parse(request.data, ["schemaVersion", "expectedUserId", "reportId", "targetUserId", "expectedRevision", "action", "requestId"]);
  const admin = actor(request, data, true), target = uid(data.targetUserId);
  if (!["7d", "14d", "indefinite", "release"].includes(String(data.action)) ||
      !Number.isSafeInteger(data.expectedRevision) || (data.expectedRevision as number) < 0 ||
      typeof data.requestId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(data.requestId)) invalid();
  const reportId = data.reportId === null ? null : id(data.reportId);
  if (data.action !== "release" && reportId === null) invalid();
  return db.runTransaction(async tx => {
    await requireAccountWritable(db, tx, admin);
    await requireAccountWritable(db, tx, target);
    const ref = db.doc(postingRestrictionPath(target)), previous = (await tx.get(ref)).data();
    const now = clock(), status = postingRestrictionStatus(previous, now);
    const fingerprint = JSON.stringify([admin, target, reportId, data.action, data.expectedRevision]);
    if (previous?.lastRequestId === data.requestId) {
      if (previous!.lastRequestFingerprint !== fingerprint) throw new HttpsError("already-exists", "This request ID was already used.");
      return {schemaVersion: 1, targetUserId: target, ...status};
    }
    if (status.revision !== data.expectedRevision) throw new HttpsError("failed-precondition", "Posting restriction changed. Refresh before continuing.");
    // Release uses the existing server-owned exact UID record, even when the
    // source report/content has since been deleted. New restrictions need proof.
    if (data.action !== "release" && await reportTarget(db, tx, reportId!) !== target) {
      throw new HttpsError("failed-precondition", "The report contributor changed. Refresh before continuing.");
    }
    if (data.action === "release" && status.status !== "active") throw new HttpsError("failed-precondition", "There is no active restriction to release. Refresh the status.");
    const next = data.action === "release" ? {...previous!, releasedAt: new Date(now), releasedByUid: admin} : {
      schemaVersion: 1, targetUserId: target, kind: data.action, startsAt: new Date(now),
      endsAt: data.action === "indefinite" ? null : new Date(now + (data.action === "7d" ? 7 : 14) * 86400000),
      issuedByUid: admin, sourceReportId: reportId, releasedAt: null, releasedByUid: null,
    };
    // One bounded record retains current/last restriction and release audit;
    // no copied report text, media, contact information, or growing history.
    const saved = {...next, revision: (status.revision as number) + 1, updatedAt: new Date(now),
      lastRequestId: data.requestId, lastRequestFingerprint: fingerprint};
    tx.set(ref, saved);
    return {schemaVersion: 1, targetUserId: target, ...postingRestrictionStatus(saved, now)};
  });
}
