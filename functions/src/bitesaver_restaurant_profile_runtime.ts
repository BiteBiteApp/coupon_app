import type {Firestore} from "firebase-admin/firestore";
import {requireAccountWritable} from "./account_deletion_guard.js";
import {requireBiteScoreTermsInFirestore, type ApprovedBiteScoreTerms} from "./bitescore_terms.js";
import {requireOwnerPhotoReference, markOwnerPhotoAttached} from "./owner_photo_screening.js";
import type {BiteSaverAccountSnapshot, BiteSaverTransactionDecision} from "./bitesaver_restaurant_profile.js";

/** Shared production/test adapter: consent, profile version and exact image are
 * read in the same transaction as final publication, including Admin approval. */
export function runBiteSaverProfileTransaction<T>(db: Firestore, documentId: string,
    evaluate: (latest: BiteSaverAccountSnapshot) => BiteSaverTransactionDecision<T>,
    terms?: ApprovedBiteScoreTerms | null): Promise<T> {
    const accountRef = db.doc(`restaurant_accounts/${documentId}`);
    return db.runTransaction(async tx => {
        await requireAccountWritable(db, tx, documentId);
        const latest = await tx.get(accountRef);
        const decision = evaluate({exists: latest.exists, data: latest.data() ?? {}});
        if (decision.operation !== "none" && decision.termsUserId) {
            await requireAccountWritable(db, tx, decision.termsUserId);
            await requireBiteScoreTermsInFirestore(db, tx, decision.termsUserId, terms);
        }
        const photo = decision.operation !== "none" && Object.prototype.hasOwnProperty.call(decision.data, "mainImageUrl") ?
            await requireOwnerPhotoReference(db, tx, "biteSaver", documentId, "main", documentId,
                decision.data.mainImageUrl, latest.get("mainImageUrl"), terms) : null;
        if (decision.operation === "create") tx.create(accountRef, decision.data);
        else if (decision.operation === "update") tx.update(accountRef, decision.data);
        markOwnerPhotoAttached(db, tx, photo);
        return decision.response;
    });
}
