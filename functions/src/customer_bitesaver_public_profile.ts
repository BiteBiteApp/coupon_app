/** Exact permanent public profile reads. No session, use capability or writes. */
import {createQueryFingerprint} from "./query_fingerprint.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {adminRestaurantBiteSaverParticipationState} from "./admin_restaurant_qr_preparation.js";
import {buildBiteSaverRestaurantIndex} from "./search_index_builders.js";
import {
  CustomerBiteSaverContractError, requireIanaTimeZone, timeZoneSupportsUtcOffset,
  customerBiteSaverRestaurantProjectionVersion,
} from "./customer_bitesaver_search_contract.js";
import {customerBiteSaverOpaqueOfferId} from "./customer_bitesaver_public_identity.js";
import {
  SavedOpaqueCodec, restaurantDto, offerDto, readCustomerBiteSaverMenuEntries,
} from "./customer_bitesaver_saved.js";
import {
  customerBiteSaverPerParentOfferQuery, offerCandidateFromProjection,
  offerSortTupleFromStored, freshCustomerBiteSaverOfferProjection,
  resolveCustomerBiteSaverSavedMenuSource, availabilityOfferFromFreshProjection,
  readCustomerBiteSaverResolvedFavoriteStates, type CustomerBiteSaverFavoriteStatesResponse,
  type CustomerBiteSaverSessionContext, type CustomerBiteSaverPublicOfferDto,
  type CustomerBiteSaverPublicRestaurantDto, type CustomerBiteSaverMenuPageResult,
} from "./customer_bitesaver_search_session.js";

import {evaluateCustomerBiteSaverOfferAvailability} from "./customer_bitesaver_offer_availability.js";

type ProfileRequest = Readonly<{
  timeZone: string; utcOffsetMinutes: number;
  catalogRestaurantId: string; section: "profile" | "menu"; cursor: string | null;
}>;
export type CustomerBiteSaverPublicProfileResult = Readonly<{
  schemaVersion: 1; kind: "publicProfile"; catalogRestaurantId: string;
  state: "available" | "notParticipating" | "unavailable";
  restaurant: CustomerBiteSaverPublicRestaurantDto | null;
  nextCursor: string | null; hasMore: boolean; partial: boolean;
  favoriteStates: CustomerBiteSaverFavoriteStatesResponse["states"];
}>;

function invalid(message = "The restaurant profile request is invalid."): never {
  throw new CustomerBiteSaverContractError("invalid-argument", message);
}
function changed(): never {
  throw new CustomerBiteSaverContractError("failed-precondition", "The restaurant changed. Open its profile again.");
}
function parse(raw: unknown): ProfileRequest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !==
      "catalogRestaurantId,cursor,kind,schemaVersion,section,timeZone,utcOffsetMinutes" ||
    value.schemaVersion !== 1 || value.kind !== "publicProfile" ||
    typeof value.timeZone !== "string" || value.timeZone.length > 100 ||
    !Number.isInteger(value.utcOffsetMinutes) ||
    (value.section !== "profile" && value.section !== "menu") ||
    (value.cursor !== null && (typeof value.cursor !== "string" || value.cursor.length > 32768))) return invalid();
  const catalogRestaurantId = readBiteScoreCatalogRestaurantId(value.catalogRestaurantId);
  if (catalogRestaurantId === null) return invalid();
  const timeZone = requireIanaTimeZone(value.timeZone);
  if (!timeZoneSupportsUtcOffset(timeZone, value.utcOffsetMinutes as number)) return invalid();
  return {catalogRestaurantId, section: value.section, cursor: value.cursor as string | null,
    timeZone, utcOffsetMinutes: value.utcOffsetMinutes as number};
}

export async function resolveCustomerBiteSaverPublicProfile(
  request: Pick<ProfileRequest, "catalogRestaurantId">,
  context: CustomerBiteSaverSessionContext,
  reader: Pick<CustomerBiteSaverSessionContext["database"], "getDocument" | "queryDocuments"> = context.database,
) {
  const catalog = await reader.getDocument(`bitescore_restaurants/${request.catalogRestaurantId}`);
  if (catalog === null || catalog.id !== request.catalogRestaurantId) return {state: "unavailable" as const};
  const accounts = await reader.queryDocuments({
    collectionPath: "restaurant_accounts",
    filters: [{field: "biteScoreCatalogRestaurantId", operation: "==", value: request.catalogRestaurantId}],
    orders: [], limit: 2,
  });
  const participation = adminRestaurantBiteSaverParticipationState(
    request.catalogRestaurantId, catalog.data, request.catalogRestaurantId, accounts,
  );
  if (participation === "unbound") return {state: "notParticipating" as const};
  if (participation !== "bound" || accounts.length !== 1) return {state: "unavailable" as const};
  const account = accounts[0];
  if (account.path !== `restaurant_accounts/${account.id}`) return {state: "unavailable" as const};
  const key = context.identityKeyV1;
  if (key === undefined) throw new CustomerBiteSaverContractError("failed-precondition");
  const projection = buildBiteSaverRestaurantIndex({
    sourceDocumentId: account.id, source: account.data,
    now: new Date(context.now?.() ?? Date.now()), identityKeyV1: key,
  });
  if (projection === null || projection.publicVisible !== true ||
      projection.publicProjectionVersion !== customerBiteSaverRestaurantProjectionVersion ||
      typeof projection.publicRestaurantId !== "string") return {state: "unavailable" as const};
  const restaurant = restaurantDto(projection, projection.publicRestaurantId);
  if (restaurant === null) return {state: "unavailable" as const};
  const fingerprint = createQueryFingerprint({
    purpose: "publicProfile", catalogRestaurantId: request.catalogRestaurantId,
    catalogBinding: catalog.data.biteSaverCatalogBindingId,
    accountId: account.id, parent: projection.sourceFingerprint,
  });
  return {state: "available" as const, account, restaurant, fingerprint, key};
}

export async function getCustomerBiteSaverPublicProfileHandler(
  raw: unknown, context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverPublicProfileResult | CustomerBiteSaverMenuPageResult> {
  const request = parse(raw);
  const parent = await resolveCustomerBiteSaverPublicProfile(request, context);
  const absent = (state: "notParticipating" | "unavailable"): CustomerBiteSaverPublicProfileResult => ({
    schemaVersion: 1, kind: "publicProfile", catalogRestaurantId: request.catalogRestaurantId,
    state, restaurant: null, nextCursor: null, hasMore: false, partial: false, favoriteStates: [],
  });
  if (parent.state !== "available") {
    if (request.section !== "profile" || request.cursor !== null) return changed();
    return absent(parent.state);
  }
  const now = context.now?.() ?? Date.now();
  const codec = new SavedOpaqueCodec(context.discoveryKey, () => context.now?.() ?? Date.now());
  const cursor = request.cursor === null ? null : codec.open(request.cursor);
  if (cursor !== null && (cursor.purpose !== "publicProfilePage" || cursor.version !== 1 ||
      cursor.catalogRestaurantId !== request.catalogRestaurantId || cursor.section !== request.section ||
      cursor.fingerprint !== parent.fingerprint || cursor.timeZone !== request.timeZone ||
      cursor.utcOffsetMinutes !== request.utcOffsetMinutes)) return changed();
  const seal = (boundary: Readonly<Record<string, unknown>>) => codec.encode({
    version: 1, purpose: "publicProfilePage", catalogRestaurantId: request.catalogRestaurantId,
    section: request.section, fingerprint: parent.fingerprint,
    expiresAtMillis: now + 15 * 60 * 1000, timeZone: request.timeZone,
    utcOffsetMinutes: request.utcOffsetMinutes, ...boundary,
  });
  const verifyParent = async () => {
    const current = await resolveCustomerBiteSaverPublicProfile(request, context);
    if (current.state !== "available" || current.fingerprint !== parent.fingerprint) return changed();
  };
  if (request.section === "menu") {
    const sourceInput = {context, authoritativeAccountId: parent.account.id,
      publicRestaurantId: parent.restaurant.restaurantId, now: new Date(now)};
    const source = await resolveCustomerBiteSaverSavedMenuSource(sourceInput);
    if (cursor !== null && cursor.relationshipFingerprint !== source.relationshipFingerprint) return changed();
    const phase = cursor?.phase ?? 0;
    const afterId = cursor?.afterId ?? null;
    if (!Number.isInteger(phase) || (phase as number) < 0 || (phase as number) > 2 ||
      (afterId !== null && readBiteScoreCatalogRestaurantId(afterId) === null)) return invalid();
    const page = source.state === "absent" ? {entries: [], hasMore: false, phase: 0, afterId: null} :
      await readCustomerBiteSaverMenuEntries(context, source, {phase: phase as number, afterId: afterId as string | null});
    const current = await resolveCustomerBiteSaverSavedMenuSource({...sourceInput, now: new Date(context.now?.() ?? Date.now())});
    if (current.state !== source.state || current.collectionRoot !== source.collectionRoot ||
      current.relationshipFingerprint !== source.relationshipFingerprint) return changed();
    await verifyParent();
    return {
      schemaVersion: 1, state: source.state, attemptGeneration: 0,
      queryFingerprint: parent.fingerprint, restaurantId: parent.restaurant.restaurantId,
      menuStyle: source.style, entries: page.entries, hasMore: page.hasMore,
      nextCursor: page.hasMore ? seal({phase: page.phase, afterId: page.afterId,
        relationshipFingerprint: source.relationshipFingerprint}) : null,
    };
  }
  // The existing per-parent query, candidate validator and fresh-source builder
  // are shared with Browse. This read never evaluates or writes customer usage.
  let boundary = cursor?.after as readonly [number, string, string] | undefined;
  const offers: CustomerBiteSaverPublicOfferDto[] = [];
  let consumed = 0;
  let bytes = 0;
  let hasMore = false;
  while (consumed < 75 && bytes < 1048576) {
    const limit = Math.min(26, 75 - consumed);
    const documents = await context.database.queryDocuments(customerBiteSaverPerParentOfferQuery({
      authoritativeAccountId: parent.account.id, startAfter: boundary, limit,
    }));
    if (documents.length === 0) break;
    for (const document of documents) {
      if (offers.length === 25 || consumed >= 75 || bytes >= 1048576) {hasMore = true; break;}
      consumed += 1;
      bytes += Buffer.byteLength(JSON.stringify(document.data), "utf8");
      boundary = offerSortTupleFromStored(document);
      const candidate = offerCandidateFromProjection(document, parent.account.id);
      if (candidate === null) continue;
      const collection = candidate.offerType === "coupon" ? "coupons" : "daily_specials";
      const source = await context.database.getDocument(`restaurant_accounts/${parent.account.id}/${collection}/${candidate.sourceDocumentId}`);
      if (source === null) continue;
      bytes += Buffer.byteLength(JSON.stringify(source.data), "utf8");
      const projection = freshCustomerBiteSaverOfferProjection({
        authoritativeAccountId: parent.account.id, restaurant: parent.account.data,
        candidate, raw: source.data, now: new Date(now), identityKeyV1: parent.key,
      });
      if (projection === null) continue;
      const displaySource = availabilityOfferFromFreshProjection({candidate, raw: source.data, projection});
      const visibility = evaluateCustomerBiteSaverOfferAvailability({
        offerType: candidate.offerType,
        // Public presentation checks schedules, not proximity/use permission.
        // The original proximity flag remains in the DTO and final use must
        // independently enforce it. No geographic search/location is invented.
        offer: {...displaySource, isProximityOnly: false}, parentEligible: true,
        now: new Date(now), timeZone: request.timeZone,
        locationMode: "typed", restaurantCoordinates: null,
      });
      if (!visibility.visible) continue;
      const publicId = customerBiteSaverOpaqueOfferId(parent.key, parent.account.id, candidate.offerType, candidate.sourceDocumentId);
      const offer = offerDto(projection, publicId, candidate.offerType);
      if (offer !== null) offers.push(candidate.offerType === "dailySpecial"
        ? {...offer, available: visibility.redeemable, availabilityReason: visibility.reason}
        : offer);
    }
    if (hasMore) break;
    if (documents.length < limit) break;
    if (consumed >= 75 || bytes >= 1048576) {hasMore = true; break;}
  }
  const favoriteStates = context.identity.authUid === null || context.identity.authIsAnonymous ? [] :
    (await readCustomerBiteSaverResolvedFavoriteStates(context, [parent.restaurant.restaurantId],
      new Map(offers.map(offer => [offer.offerId, {offerType: offer.offerType,
        publicRestaurantId: parent.restaurant.restaurantId}])))).states;
  await verifyParent();
  return {
    schemaVersion: 1, kind: "publicProfile", catalogRestaurantId: request.catalogRestaurantId,
    state: "available", restaurant: {...parent.restaurant, offers, hasMoreOffers: hasMore}, favoriteStates,
    nextCursor: hasMore ? seal({after: boundary}) : null, hasMore,
    partial: hasMore && (consumed >= 75 || bytes >= 1048576),
  };
}
