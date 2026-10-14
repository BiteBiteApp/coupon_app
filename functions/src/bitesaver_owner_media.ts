import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { requireAuthenticatedRestaurantAccountActor } from "./admin_authorization.js";
export const ownerMediaPhotoLimit = 12;
export const ownerMediaSpecialLimit = 50;
export const ownerMediaBoardId = "bitesaver_managed_board";
type Data = Record<string, any>;
type Image = {
    id: string;
    path: string;
    generation: string;
    url: string;
    registrationVersion: number;
    state: "ready" | "deleting";
};
export type OwnerMediaState = {
    version: number;
    images: Image[];
    gallery: string[];
    legacyMain: string | null;
    mode: "manual" | "photo";
    boardImage: string | null;
    specialImages: Record<string, string>;
    legacySpecialImages?: Record<string, string>;
    lastRequest?: string;
    lastFingerprint?: string;
};
export type OwnerMediaSnapshot = {
    account: Data;
    specials: Record<string, Data>;
    specialsOverflow?: boolean;
};
export type OwnerMediaDecision<T> = {
    result: T;
    account?: Data;
    specials?: Record<string, Data>;
    removeSpecials?: string[];
};
export type OwnerMediaDependencies = {
    transact<T>(uid: string, evaluate: (snapshot: OwnerMediaSnapshot) => OwnerMediaDecision<T>, rootOnly?: boolean): Promise<T>;
    inspect(path: string): Promise<{
        generation: string;
        size: number;
        contentType: string;
        mediaId: string;
        url: string;
    }>;
    deleteGeneration(path: string, generation: string): Promise<void>;
    timestamp(): unknown;
};
const imageId = /^[a-f0-9]{32}$/;
const recordId = /^[A-Za-z0-9_-]{1,128}$/;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(code: "invalid-argument" | "failed-precondition" | "permission-denied" | "aborted", message: string): never { throw new HttpsError(code, message); }
function object(value: unknown): Data { if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid-argument", "Invalid media request."); return value as Data; }
function exact(value: Data, keys: string[]) { if (Object.keys(value).some(k => !keys.includes(k)))
    fail("invalid-argument", "Unsupported media fields."); }
function owner(snapshot: OwnerMediaSnapshot, uid: string) {
    if (snapshot.account.uid !== uid || snapshot.account.couponApplicationSubmitted !== true || snapshot.account.approvalStatus !== "approved" || snapshot.account.couponPostingEnabled !== true)
        fail("permission-denied", "An eligible restaurant owner is required.");
}
export function readOwnerMedia(account: Data): OwnerMediaState {
    if (account.ownerMedia == null)
        return { version: 0, images: [], gallery: typeof account.mainImageUrl === "string" && account.mainImageUrl ? ["legacy-main"] : [], legacyMain: typeof account.mainImageUrl === "string" ? account.mainImageUrl : null, mode: "manual", boardImage: null, specialImages: {} };
    const value = object(account.ownerMedia);
    if (!Number.isSafeInteger(value.version) || !Array.isArray(value.images) || !Array.isArray(value.gallery) || !["manual", "photo"].includes(value.mode) || !value.specialImages)
        fail("failed-precondition", "Restaurant media needs review.");
    return structuredClone(value) as OwnerMediaState;
}
export function ownerMediaReferenced(state: OwnerMediaState, id: string) { return state.gallery.includes(id) || state.boardImage === id || Object.values(state.specialImages).includes(id); }
function safeImage(state: OwnerMediaState, id: string, uid?: string): Image {
    const image = state.images.find(i => i.id === id);
    if (!image || !imageId.test(id) || !/^\d+$/.test(image.generation) || (uid && !new RegExp(`^bitesaver_restaurants/${uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/restaurant_images/managed_${id}\\.(jpg|png)$`).test(image.path)))
        fail("failed-precondition", "This photo cannot be safely managed.");
    return image;
}
function ready(state: OwnerMediaState, id: unknown): string {
    if (typeof id !== "string" || safeImage(state, id).state !== "ready")
        fail("failed-precondition", "Choose an available uploaded photo.");
    return id;
}
function dateMillis(value: any): number | null { return value instanceof Date ? value.getTime() : typeof value?.toMillis === "function" ? value.toMillis() : null; }
function response(snapshot: OwnerMediaSnapshot, state: OwnerMediaState) {
    return { schemaVersion: 1, media: state, specialsOverflow: snapshot.specialsOverflow === true, contentFingerprint: hash(snapshot.specials), specials: Object.entries(snapshot.specials).map(([id, data]) => ({ ...data, id, expiresAt: dateMillis(data.expiresAt), createdAt: dateMillis(data.createdAt), updatedAt: dateMillis(data.updatedAt) })) };
}
function validateSpecial(raw: unknown, uid: string, state: OwnerMediaState, now: unknown): Data {
    const value = object(raw);
    exact(value, ["id", "title", "details", "isActive", "availabilityMode", "daysOfWeek", "allDay", "startTime", "endTime", "hideWhenUnavailable", "expiresAtMillis", "imageId", "removeLegacyImage"]);
    if (typeof value.id !== "string" || !recordId.test(value.id) || typeof value.title !== "string" || !value.title.trim() || value.title.length > 200 || (value.details != null && (typeof value.details !== "string" || value.details.length > 2000)))
        fail("invalid-argument", "Enter a title and shorter special details.");
    if (!["todayOnly", "specificDays"].includes(value.availabilityMode) || !Array.isArray(value.daysOfWeek) || value.daysOfWeek.length > 7 || value.daysOfWeek.some((d: unknown) => !Number.isInteger(d) || (d as number) < 1 || (d as number) > 7) || (value.availabilityMode === "specificDays" && !value.daysOfWeek.length))
        fail("invalid-argument", "Select the special's available days.");
    for (const key of ["isActive", "allDay", "hideWhenUnavailable"])
        if (typeof value[key] !== "boolean")
            fail("invalid-argument", "Invalid special settings.");
    const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!value.allDay && (!time.test(value.startTime) || !time.test(value.endTime) || value.endTime <= value.startTime))
        fail("invalid-argument", "Enter a valid start and later end time.");
    if (value.availabilityMode === "todayOnly" && (!Number.isSafeInteger(value.expiresAtMillis) || value.expiresAtMillis <= 0))
        fail("invalid-argument", "Choose a valid expiration date.");
    const mediaId = value.imageId == null ? null : ready(state, value.imageId);
    return { id: value.id, restaurantId: uid, ownerUid: uid, title: value.title.trim(), details: value.details?.trim() || null, isActive: value.isActive, availabilityMode: value.availabilityMode, daysOfWeek: value.daysOfWeek, allDay: value.allDay, startTime: value.allDay ? null : value.startTime, endTime: value.allDay ? null : value.endTime, hideWhenUnavailable: value.hideWhenUnavailable, expiresAt: value.availabilityMode === "todayOnly" ? new Date(value.expiresAtMillis) : null, imageUrl: mediaId ? safeImage(state, mediaId).url : null, updatedAt: now };
}
/** Routed by the existing owner profile callable; no new authority surface. */
export async function saveOwnerMedia(request: {
    auth?: unknown;
    data: unknown;
}, deps: OwnerMediaDependencies) {
    const uid = requireAuthenticatedRestaurantAccountActor(request).uid;
    const data = object(request.data);
    exact(data, ["intent", "action", "expectedVersion", "requestId", "imageId", "extension", "gallery", "mode", "boardImage", "specials", "board", "contentFingerprint", "section"]);
    if (data.action === "load")
        return deps.transact(uid, snapshot => { owner(snapshot, uid); return { result: response(snapshot, readOwnerMedia(snapshot.account)) }; });
    if (!Number.isSafeInteger(data.expectedVersion) || typeof data.requestId !== "string" || !recordId.test(data.requestId))
        fail("invalid-argument", "Invalid media save.");
    const fingerprint = hash(data);
    let upload: Image | undefined;
    if (data.action === "register") {
        if (!imageId.test(data.imageId) || !["jpg", "png"].includes(data.extension))
            fail("invalid-argument", "Invalid uploaded image.");
        await deps.transact(uid, snapshot => { owner(snapshot, uid); return { result: null }; });
        const path = `bitesaver_restaurants/${uid}/restaurant_images/managed_${data.imageId}.${data.extension}`;
        const metadata = await deps.inspect(path);
        if (metadata.mediaId !== data.imageId || !/^\d+$/.test(metadata.generation) || metadata.size <= 0 || metadata.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(metadata.contentType) || typeof metadata.url !== "string" || metadata.url.length > 2000)
            fail("failed-precondition", "The uploaded photo could not be verified.");
        upload = { id: data.imageId, path, generation: metadata.generation, url: metadata.url, registrationVersion: -1, state: "ready" };
    }
    else if (data.action !== "publish")
        fail("invalid-argument", "Unsupported media action.");
    return deps.transact(uid, snapshot => {
        owner(snapshot, uid);
        const state = readOwnerMedia(snapshot.account);
        if (snapshot.specialsOverflow && (snapshot.account.ownerMedia == null || data.section === "specials"))
            fail("failed-precondition", "Use the existing Daily Specials list to reduce your saved entries to 50 before editing media.");
        if (snapshot.account.ownerMedia == null)
            state.legacySpecialImages = Object.fromEntries(Object.entries(snapshot.specials).filter(([, special]) => typeof special.imageUrl === 'string').map(([id, special]) => [id, special.imageUrl]));
        if (state.lastRequest === data.requestId) {
            if (state.lastFingerprint !== fingerprint)
                fail("invalid-argument", "Retry the original save.");
            return { result: response(snapshot, state) };
        }
        if (state.version !== data.expectedVersion)
            fail("aborted", "Restaurant media changed. Reload before saving.");
        let writes: Record<string, Data> | undefined;
        let removed: string[] | undefined;
        if (upload) {
            if (state.images.some(i => i.id === upload!.id || i.path === upload!.path) || state.images.length >= 100)
                fail("failed-precondition", "Remove unused photos before adding more.");
            upload.registrationVersion = state.version + 1;
            state.images.push(upload);
        }
        else {
            if (!["photos", "specials"].includes(data.section))
                fail("invalid-argument", "Choose a media section.");
            if (data.section === "specials" && data.contentFingerprint !== hash(snapshot.specials))
                fail("aborted", "Daily Specials changed. Reload before saving.");
            if (!Array.isArray(data.gallery) || data.gallery.length > ownerMediaPhotoLimit || new Set(data.gallery).size !== data.gallery.length || (data.section === "specials" && (!["manual", "photo"].includes(data.mode) || !Array.isArray(data.specials) || data.specials.length > ownerMediaSpecialLimit)))
                fail("invalid-argument", "Too many photos or specials.");
            state.gallery = data.gallery.map((id: unknown) => id === "legacy-main" && state.legacyMain ? id : ready(state, id));
            if (data.section === "specials") {
                state.boardImage = data.boardImage == null ? null : ready(state, data.boardImage);
                if (data.mode === "photo" && !state.boardImage)
                    fail("invalid-argument", "Choose a board photo before publishing.");
                state.mode = data.mode;
                state.specialImages = {};
                writes = {};
                for (const raw of data.specials) {
                    const special = validateSpecial(raw, uid, state, deps.timestamp());
                    if (special.id === ownerMediaBoardId || writes[special.id])
                        fail("invalid-argument", "Duplicate special.");
                    if (raw.imageId != null)
                        state.specialImages[special.id] = ready(state, raw.imageId);
                    if (raw.removeLegacyImage === true)
                        delete state.legacySpecialImages?.[special.id];
                    if (raw.imageId == null)
                        special.imageUrl = state.legacySpecialImages?.[special.id] ?? null;
                    writes[special.id] = { ...snapshot.specials[special.id], ...special, createdAt: snapshot.specials[special.id]?.createdAt ?? deps.timestamp() };
                }
                if (state.boardImage) {
                    const previous = snapshot.specials[ownerMediaBoardId];
                    if (previous && previous.managedBoard !== true)
                        fail("failed-precondition", "An existing special uses the board identifier.");
                    const board = validateSpecial({ ...object(data.board), id: ownerMediaBoardId, imageId: state.boardImage }, uid, state, deps.timestamp());
                    writes[ownerMediaBoardId] = { ...board, managedBoard: true, createdAt: previous?.createdAt ?? deps.timestamp() };
                }
                removed = Object.keys(snapshot.specials).filter(id => !writes![id]);
                for (const id of removed)
                    delete state.legacySpecialImages?.[id];
            }
        }
        state.version++;
        state.lastRequest = data.requestId;
        state.lastFingerprint = fingerprint;
        const nextSpecials = writes ?? snapshot.specials;
        return { result: response({ ...snapshot, specials: nextSpecials }, state), account: { ownerMedia: state, updatedAt: deps.timestamp() }, specials: writes, removeSpecials: removed };
    });
}
/** Only registered, unreferenced owner media. Requests never supply paths/generations. */
export async function removeOwnerImage(request: {
    auth?: unknown;
    data: unknown;
}, deps: OwnerMediaDependencies) {
    const uid = requireAuthenticatedRestaurantAccountActor(request).uid;
    const data = object(request.data);
    exact(data, ["imageId", "registrationVersion"]);
    if (!Number.isSafeInteger(data.registrationVersion))
        fail("invalid-argument", "Invalid photo version.");
    if (!imageId.test(data.imageId))
        fail("invalid-argument", "Invalid photo.");
    const intent = await deps.transact(uid, snapshot => {
        owner(snapshot, uid);
        const state = readOwnerMedia(snapshot.account);
        const existing = state.images.find(i => i.id === data.imageId);
        if (!existing)
            return { result: null }; // acknowledged retry; never derives a path
        const image = safeImage(state, data.imageId, uid);
        if (image.registrationVersion !== data.registrationVersion)
            fail("aborted", "This photo has been replaced.");
        if (ownerMediaReferenced(state, image.id))
            fail("failed-precondition", "Save the photo removal before deleting its file.");
        if (image.state !== "deleting") {
            image.state = "deleting";
            state.version++;
        }
        return { result: { ...image }, account: { ownerMedia: state } };
    }, true);
    if (intent === null)
        return { removed: true };
    // Adapter deletes this generation only, treating only exact-object 404 as success.
    await deps.deleteGeneration(intent.path, intent.generation);
    await deps.transact(uid, snapshot => {
        owner(snapshot, uid);
        const state = readOwnerMedia(snapshot.account);
        const current = state.images.find(i => i.id === intent.id);
        if (current && (current.path !== intent.path || current.generation !== intent.generation || current.state !== "deleting" || ownerMediaReferenced(state, current.id)))
            fail("aborted", "The photo changed; reload to continue.");
        state.images = state.images.filter(i => i.id !== intent.id);
        state.version++;
        return { result: null, account: { ownerMedia: state } };
    }, true);
    return { removed: true };
}
/** Publication authority is protected root state, never directly writable special metadata. */
export function managedSpecialForPublication(account: Data, specialId: string, special: Data): Data | null {
    if (account.ownerMedia == null)
        return special;
    const state = readOwnerMedia(account);
    if ((state.mode === "photo") !== (specialId === ownerMediaBoardId))
        return null;
    const id = specialId === ownerMediaBoardId ? state.boardImage : state.specialImages[specialId];
    const image = id ? state.images.find(i => i.id === id && i.state === "ready") : null;
    if (specialId === ownerMediaBoardId && !image)
        return null;
    return { ...special, imageUrl: image?.url ?? state.legacySpecialImages?.[specialId] ?? null };
}
export function publicOwnerGallery(account: Data): string[] {
    if (account.ownerMedia == null)
        return [];
    const state = readOwnerMedia(account);
    return state.gallery.slice(0, ownerMediaPhotoLimit).map(id => id === "legacy-main" ? state.legacyMain : state.images.find(i => i.id === id && i.state === "ready")?.url).filter((url): url is string => typeof url === "string" && url.length > 0 && url.length <= 2000);
}
