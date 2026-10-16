import {requireOwnerPhotoAuthority, markOwnerPhotoAttached, requireOwnerPhotoPublication, requireOwnerPhotoReference} from "./owner_photo_screening.js";
import {screeningCollection, screeningRuntimePath, photoExpired, terminalFields, pendingRetentionMs, millis} from "./photo_screening_retention.js";
import {ownerMediaReferenced} from "./bitesaver_owner_media.js";
import {randomUUID} from "node:crypto";
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
                for (const [id, value] of Object.entries(decision.specials ?? {})) {
                    if (specials[id]?.screeningTargetToken) value.screeningTargetToken = specials[id].screeningTargetToken;
                }
                const screened: {row: Record<string, any>; referenced: boolean; deleting: boolean; detached: boolean}[] = [];
                const media = decision.account?.ownerMedia;
                const runtime = media ? await tx.get(db.doc(screeningRuntimePath)) : null;
                const legacy = media?.gallery.includes("legacy-main") && typeof media.legacyMain === "string" && media.legacyMain.includes("screened_bso_") ?
                    await requireOwnerPhotoReference(db, tx, "biteSaver", uid, "main", uid, media.legacyMain,
                        account.get("ownerMedia.gallery")?.includes("legacy-main") ? media.legacyMain : null) : null;
                if (media && account.get("ownerMedia.gallery")?.includes("legacy-main") && !media.gallery.includes("legacy-main") &&
                    account.get("mainImageUrl") === media.legacyMain) decision.account!.mainImageUrl = null;
                if (media) for (const image of media.images) {
                    if (!image.id.startsWith("bso_")) continue;
                    // A legacy client may already have removed a special's
                    // image/record. Saving another section must not preserve
                    // that stale mapping or prevent its safe removal.
                    if (!rootOnly) for (const [specialId, imageId] of Object.entries(media.specialImages)) {
                        if (imageId === image.id && (specials[specialId] !== undefined || manualCount <= 50) &&
                            (decision.specials?.[specialId] ?? specials[specialId])?.imageUrl !== image.url)
                            delete media.specialImages[specialId];
                    }
                    if (!rootOnly && media.boardImage === image.id && (specials.bitesaver_managed_board !== undefined || manualCount <= 50) &&
                        (decision.specials?.bitesaver_managed_board ?? specials.bitesaver_managed_board)?.imageUrl !== image.url)
                        media.boardImage = null;
                    const added = !(account.get("ownerMedia.images") ?? []).some((old: any) => old.id === image.id);
                    const referenced = ownerMediaReferenced(media, image.id);
                    const detached = !referenced && !!account.get("ownerMedia") && ownerMediaReferenced(account.get("ownerMedia"), image.id);
                    if (!added && !referenced && !detached && image.state !== "deleting") continue;
                    const row = (await tx.get(db.doc(`${screeningCollection}/${image.id}`))).data();
                    if (!row || row.lane !== "owner" || row.sourceType !== "biteSaver" || row.sourceId !== uid || row.family !== "managed" ||
                        row.storagePath !== image.path || row.generation !== image.generation || row.publicUrl !== image.url ||
                        ((added || referenced) && image.state !== "deleting" && (row.state !== "approved" || photoExpired(row, Date.now()))))
                        throw new HttpsError("failed-precondition", "This photo is unavailable. Remove it from the draft or choose another.");
                    if (referenced && (
                        (media.gallery.includes(row.imageId) && row.targetId !== "gallery") ||
                        (media.boardImage === row.imageId && row.targetId !== "board") ||
                        Object.entries(media.specialImages).some(([specialId, imageId]) => imageId === row.imageId && specialId !== row.targetId)))
                        throw new HttpsError("failed-precondition", "Choose a photo checked for this gallery or special.");
                    if (referenced && (!account.get("ownerMedia") || !ownerMediaReferenced(account.get("ownerMedia"), image.id))) requireOwnerPhotoPublication(runtime?.data());
                    if (added || referenced) await requireOwnerPhotoAuthority(db, tx, row);
                    if (referenced && !["gallery", "board"].includes(row.targetId)) {
                        const targetToken = row.targetToken ?? specials[row.targetId]?.screeningTargetToken ?? randomUUID();
                        if (decision.specials?.[row.targetId]) decision.specials[row.targetId].screeningTargetToken = targetToken;
                        else if (!row.targetToken) throw new HttpsError("failed-precondition", "Save the special with its approved photograph.");
                        row.targetToken = targetToken;
                    }
                    screened.push({row, referenced, detached, deleting: image.state === "deleting"});
                }
                if (decision.account) tx.update(ref, decision.account);
                markOwnerPhotoAttached(db, tx, legacy);
                for (const image of screened) {
                    if (image.deleting) tx.update(db.doc(`${screeningCollection}/${image.row.imageId}`), terminalFields("withdrawn", Date.now(), "owner_removed"));
                    else if (image.detached && image.row.state === "approved") {
                        const deadline = new Date(millis(image.row.createdAt)! + pendingRetentionMs);
                        tx.update(db.doc(`${screeningCollection}/${image.row.imageId}`), {attached: false, expiresAt: deadline, maintenanceAt: deadline});
                    } else if (image.referenced) {
                        markOwnerPhotoAttached(db, tx, image.row);
                        if (image.row.targetToken) tx.update(db.doc(`${screeningCollection}/${image.row.imageId}`), {targetToken: image.row.targetToken});
                        tx.update(db.doc(`${screeningCollection}/${image.row.imageId}`), {publishedMediaVersion: media.version});
                    }
                }
                for (const [id, data] of Object.entries(decision.specials ?? {}))
                    tx.set(ref.collection("daily_specials").doc(id), data);
                for (const id of decision.removeSpecials ?? [])
                    tx.delete(ref.collection("daily_specials").doc(id));
                return decision.result;
            });
        },
        async inspect(path) {
            const screened = /screened_(bso_[a-f0-9]{64})[.]jpg$/.exec(path);
            if (screened) {
                const row = (await db.doc(`${screeningCollection}/${screened[1]}`).get()).data();
                if (!row || row.state !== "approved" || row.family !== "managed" || row.storagePath !== path || photoExpired(row, Date.now()))
                    throw new HttpsError("failed-precondition", "This photo is not available for use.");
                const [metadata] = await bucket.file(path).getMetadata();
                if (String(metadata.generation) !== row.generation || metadata.metadata?.firebaseStorageDownloadTokens)
                    throw new HttpsError("failed-precondition", "The photo changed.");
                return {generation: row.generation, size: Number(metadata.size), contentType: metadata.contentType ?? "", mediaId: row.imageId, url: row.publicUrl};
            }
            if ((await db.doc(screeningRuntimePath).get()).get("ownerRequired") === true)
                throw new HttpsError("failed-precondition", "Use the current app to check new photographs before saving.");
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
