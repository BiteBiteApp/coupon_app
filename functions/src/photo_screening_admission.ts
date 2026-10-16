import type {Firestore, Transaction} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

/** One pool for BOTH apps. Reservations count admitted attempts, never refunds. */
export async function reservePhotoScreening(db: Firestore, tx: Transaction, uid: string, at: number, attemptId: string, allowance: number): Promise<void> {
  const usageRef = db.doc(`private_bitescore_screening_usage/${new Date(at).toISOString().slice(0, 7)}`);
  const slotsRef = db.doc("private_bitescore_screening_usage/concurrency");
  const [usage, slots, admission] = await tx.getAll(usageRef, slotsRef, db.doc(`user_profiles/${uid}/photo_screening_state/admission`));
  const used = usage.get("reservedUnits") ?? 0;
  const active: Record<string, number> = {};
  for (const [key, until] of Object.entries(slots.get("active") ?? {})) if (typeof until === "number" && until > at) active[key] = until;
  const sameWindow = typeof admission.get("windowAt") === "number" && at - admission.get("windowAt") < 60_000;
  const requests = sameWindow ? admission.get("count") ?? 0 : 0;
  if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(allowance) || allowance <= 0 || used >= allowance ||
      !Number.isSafeInteger(requests) || requests < 0 || Object.keys(active).length >= 4 || requests >= 4) {
    throw new HttpsError("resource-exhausted", "Photo checking is busy or paused. Please try later.");
  }
  tx.set(usageRef, {reservedUnits: used + 1, updatedAt: new Date(at)});
  tx.set(slotsRef, {active: {...active, [attemptId]: at + 120_000}});
  tx.set(admission.ref, {windowAt: sameWindow ? admission.get("windowAt") : at, count: requests + 1});
}
