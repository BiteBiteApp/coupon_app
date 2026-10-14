import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { requireAccountWritable } from "./account_deletion_guard.js";
import type { OwnerMediaDependencies } from "./bitesaver_owner_media.js";
import type { Bucket, File } from "@google-cloud/storage";
export function createOwnerMediaDependencies(db: Firestore, bucket: Bucket, downloadUrl: (file: File) => Promise<string>): OwnerMediaDependencies {
    return {
        async transact(uid, evaluate, rootOnly = false) {
            return db.runTransaction(async (tx) => {
                await requireAccountWritable(db, tx, uid);
                const ref = db.doc(`restaurant_accounts/${uid}`);
                const account = await tx.get(ref);
                if (!account.exists)
                    throw new HttpsError("not-found", "Restaurant account not found.");
                const docs = rootOnly ? null : await tx.get(ref.collection("daily_specials").limit(52));
                const specials = Object.fromEntries((docs?.docs ?? []).map(doc => [doc.id, doc.data()]));
                const manualCount = (docs?.docs ?? []).filter(doc => doc.id !== "bitesaver_managed_board" || doc.data().managedBoard !== true).length;
                const decision = evaluate({ account: account.data()!, specials, specialsOverflow: manualCount > 50 });
                if (decision.account)
                    tx.update(ref, decision.account);
                for (const [id, data] of Object.entries(decision.specials ?? {}))
                    tx.set(ref.collection("daily_specials").doc(id), data);
                for (const id of decision.removeSpecials ?? [])
                    tx.delete(ref.collection("daily_specials").doc(id));
                return decision.result;
            });
        },
        async inspect(path) {
            const file = bucket.file(path);
            const [metadata] = await file.getMetadata().catch(error => {
                if (error.code === 404)
                    throw new HttpsError("not-found", "The photo upload did not finish. Choose the photo again.");
                throw error;
            });
            return { generation: String(metadata.generation), size: Number(metadata.size), contentType: metadata.contentType ?? "", mediaId: String(metadata.metadata?.mediaId ?? ""), url: await downloadUrl(file) };
        },
        async deleteGeneration(path, generation) {
            try {
                const options = { generation, ifGenerationMatch: generation };
                await bucket.file(path).delete(options);
            }
            catch (error) {
                if ((error as {
                    code?: number;
                }).code !== 404)
                    throw error;
            }
        },
        timestamp: () => FieldValue.serverTimestamp(),
    };
}
