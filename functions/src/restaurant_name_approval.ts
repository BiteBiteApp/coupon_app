import {FieldValue, type Firestore} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {requireRestaurantAccountAdminAccess} from "./admin_authorization.js";
import {requireAccountWritable} from "./account_deletion_guard.js";
import {requireBiteScoreTermsInFirestore, type ApprovedBiteScoreTerms} from "./bitescore_terms.js";

/** The pending request, not an Admin-supplied name or identity, is authoritative. */
export async function approveRestaurantNameChangeHandler(db: Firestore,
    request: {auth?: unknown; data: unknown}, terms?: ApprovedBiteScoreTerms | null) {
    const admin = requireRestaurantAccountAdminAccess(request);
    const data = request.data as Record<string, unknown> | null;
    const id = data?.requestId;
    if (typeof id !== "string" || !id || id.length > 128 || id.includes("/") ||
        Object.keys(data ?? {}).some(key => key !== "requestId"))
        throw new HttpsError("invalid-argument", "Choose a pending name request.");
    return db.runTransaction(async tx => {
        await requireAccountWritable(db, tx, admin.uid);
        const ref = db.doc(`restaurant_name_change_requests/${id}`);
        const pending = (await tx.get(ref)).data();
        const uid = pending?.userId, name = pending?.requestedRestaurantName;
        if (typeof uid !== "string" || !uid || uid.includes("/") || typeof name !== "string" || !name.trim())
            throw new HttpsError("failed-precondition", "The name request is invalid.");
        await requireAccountWritable(db, tx, uid);
        const accountRef = db.doc(`restaurant_accounts/${uid}`);
        const account = (await tx.get(accountRef)).data();
        if (!account || account.uid !== uid)
            throw new HttpsError("failed-precondition", "The restaurant account changed.");
        if (pending!.status === "approved" && account.restaurantName === name.trim())
            return {approved: true};
        if (pending!.status !== "pending")
            throw new HttpsError("failed-precondition", "This request is no longer pending.");
        await requireBiteScoreTermsInFirestore(db, tx, uid, terms);
        tx.update(accountRef, {restaurantName: name.trim(), updatedAt: FieldValue.serverTimestamp()});
        tx.update(ref, {status: "approved", updatedAt: FieldValue.serverTimestamp()});
        return {approved: true};
    });
}
