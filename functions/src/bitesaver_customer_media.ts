import { buildBiteSaverRestaurantIndex, buildBiteSaverDailySpecialOfferIndex, biteSaverOfferParentFingerprint, customerBiteSaverPublicImageUrl } from "./search_index_builders.js";
import { restaurantSearchIndexCollection } from "./search_index_contract.js";
import { customerBiteSaverOpaqueRestaurantId, customerBiteSaverOpaqueOfferId } from "./customer_bitesaver_public_identity.js";
import { CustomerBiteSaverContractError } from "./customer_bitesaver_search_contract.js";
import { publicOwnerGallery, readOwnerMedia, ownerMediaBoardId, managedSpecialForPublication } from "./bitesaver_owner_media.js";
import type { CustomerBiteSaverSessionContext } from "./customer_bitesaver_search_session.js";
export type CustomerRestaurantMedia = {
    schemaVersion: 1;
    kind: "restaurantMedia";
    restaurantId: string;
    boardOfferId: string;
    gallery: string[];
    mode: "manual" | "photo";
    board: Record<string, unknown> | null;
    specialImages: Record<string, string>;
};
export async function getCustomerRestaurantMedia(raw: Record<string, unknown>, context: CustomerBiteSaverSessionContext): Promise<CustomerRestaurantMedia> {
    if (Object.keys(raw).sort().join(',') !== 'kind,restaurantId,schemaVersion' || raw.kind !== 'restaurantMedia' || raw.schemaVersion !== 1 || typeof raw.restaurantId !== 'string' || !/^bsr_[A-Za-z0-9_-]{43}$/.test(raw.restaurantId))
        throw new CustomerBiteSaverContractError('invalid-argument');
    const docs = await context.database.queryDocuments({ collectionPath: restaurantSearchIndexCollection, filters: [{ field: 'publicRestaurantId', operation: '==', value: raw.restaurantId }], orders: [], limit: 2 });
    const key = context.identityKeyV1;
    const id = docs.length === 1 ? docs[0].data.sourceDocumentId : null;
    if (!key || typeof id !== 'string' || !id || id.includes('/') || docs[0].data.source !== 'biteSaver' || customerBiteSaverOpaqueRestaurantId(key, id) !== raw.restaurantId)
        throw new CustomerBiteSaverContractError('not-found');
    const account = await context.database.getDocument(`restaurant_accounts/${id}`);
    const projection = account ? buildBiteSaverRestaurantIndex({ sourceDocumentId: id, source: account.data, now: new Date(context.now?.() ?? Date.now()), identityKeyV1: key }) : null;
    if (!account || projection?.publicVisible !== true || projection.publicRestaurantId !== raw.restaurantId)
        throw new CustomerBiteSaverContractError('not-found');
    const state = readOwnerMedia(account.data);
    let board: Record<string, unknown> | null = null;
    if (state.mode === 'photo') {
        const doc = await context.database.getDocument(`restaurant_accounts/${id}/daily_specials/${ownerMediaBoardId}`);
        const source = doc ? managedSpecialForPublication(account.data, ownerMediaBoardId, doc.data) : null;
        const indexed = source ? buildBiteSaverDailySpecialOfferIndex({ restaurantAccountId: id, sourceDocumentId: ownerMediaBoardId, offer: source, restaurant: account.data, now: new Date(context.now?.() ?? Date.now()) }) : null;
        if (source && indexed?.publicVisible === true) {
            const expiration = source.expiresAt as {
                toMillis?: () => number;
            } | Date | null;
            board = { title: source.title, imageUrl: source.imageUrl, isActive: source.isActive, availabilityMode: source.availabilityMode, daysOfWeek: source.daysOfWeek, allDay: source.allDay, startTime: source.startTime, endTime: source.endTime, hideWhenUnavailable: source.hideWhenUnavailable, expiresAt: expiration instanceof Date ? expiration.getTime() : expiration?.toMillis?.() ?? null };
        }
    }
    const finalAccount = await context.database.getDocument(`restaurant_accounts/${id}`);
    const finalProjection = finalAccount ? buildBiteSaverRestaurantIndex({ sourceDocumentId: id, source: finalAccount.data, now: new Date(context.now?.() ?? Date.now()), identityKeyV1: key }) : null;
    if (!finalAccount || finalProjection?.publicVisible !== true || finalProjection.publicRestaurantId !== raw.restaurantId || biteSaverOfferParentFingerprint(finalAccount.data) !== biteSaverOfferParentFingerprint(account.data))
        throw new CustomerBiteSaverContractError('failed-precondition');
    return { schemaVersion: 1, kind: 'restaurantMedia', restaurantId: raw.restaurantId, boardOfferId: customerBiteSaverOpaqueOfferId(key, id, 'dailySpecial', ownerMediaBoardId), gallery: account.data.ownerMedia == null ? (typeof projection.primaryImageUrl === "string" ? [projection.primaryImageUrl] : []) : publicOwnerGallery(account.data).map(customerBiteSaverPublicImageUrl).filter((url): url is string => url !== null), mode: state.mode, board, specialImages: {} };
}
