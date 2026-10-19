import { createHash } from "node:crypto";
import * as matcher from "./customer_bitescore_search_matcher.js";
import * as saver from "./customer_bitesaver_search_matcher.js";
import * as contract from "./customer_bitesaver_search_contract.js";
import * as geo from "./restaurant_geo_helpers.js";
import * as score from "./customer_bitescore_search.js";
import { customerBiteScoreUtf16Key, readCustomerBiteScorePublicProjection } from "./customer_bitescore_search_contract.js";
import { evaluateCustomerBiteSaverOfferAvailability } from "./customer_bitesaver_offer_availability.js";
import type { CustomerBiteSaverStoredDocument } from "./customer_bitesaver_search_store.js";
import { decodePostgisProjection } from "./postgis_source.js";
export { matcher, saver, contract, geo, score };
// Stable hashing is only for the derived public index, never customer authority.
export function canonical(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([key, entry]) => [key, canonical(entry)]));
    }
    return value;
}
export const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const finderNorm = (value: string): string => value.toLowerCase().replace(/&/gu, " and ")
    .replace(/[’'`]+/gu, "").replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");
// These conservative recall functions were qualified with the corrected
// prototype. The existing matcher remains the final authority, including aliases.
export function recallValues(dto: Record<string, any>): string {
    const category = matcher.biteScoreCategoryTerms(dto);
    const joined = [dto.subcategory || "", dto.categoryManualKeywords || "", ...(dto.categoryTags || [])].filter(Boolean).join(" ");
    return [...new Set([dto.displayName || "", ...category, joined].flatMap(value => [matcher.normalizeBiteScoreFood(value), ...matcher.biteScoreFoodTerms(value)]))].join("\u0001");
}
export function recallPatterns(query: string): string[] | null {
    const normalized = matcher.normalizeBiteScoreFood(query);
    if (!normalized)
        return null;
    const parts = new Set([normalized, ...(matcher.aliases.get(normalized) || [])]);
    for (const term of matcher.queryTerms(normalized)) {
        parts.add(term);
        parts.add(matcher.singular(term));
        for (const alias of matcher.aliases.get(term) || [])
            parts.add(alias);
        if (term.length >= 4) {
            parts.add(term[0]);
            for (const known of matcher.aliases.keys())
                if (matcher.fuzzy(term, known)) {
                    parts.add(known);
                    for (const alias of matcher.aliases.get(known) || [])
                        parts.add(alias);
                }
        }
    }
    return [...parts].filter(Boolean).flatMap(term => ["%" + term + "%", "%" + term.replace(/ /gu, "") + "%"]);
}
export function shortRecall(query: string): {
    n: string;
    exact: string[];
    long: string[];
} | null {
    const n = matcher.normalizeBiteScoreFood(query);
    if (!n || n.length >= 4 || n.includes(" "))
        return null;
    const terms = new Set([n, ...(matcher.aliases.get(n) || [])]);
    for (const term of matcher.queryTerms(n)) {
        terms.add(term);
        terms.add(matcher.singular(term));
        for (const alias of matcher.aliases.get(term) || [])
            terms.add(alias);
    }
    return { n, exact: [...terms].flatMap(v => [v, v.replace(/ /gu, "")]),
        long: [...terms].filter(v => v.length >= 4).map(v => "%" + v + "%") };
}
export function saverRank(criteria: any, row: any): any {
    const distance = geo.exactCustomerBiteSaverDistanceMiles(criteria.center, row.dto);
    if (!Number.isFinite(distance) || distance > criteria.radiusMiles)
        return null;
    const preferred = contract.customerBiteSaverExactLocationPreference({ typedLocation: criteria.typedLocation || null,
        restaurantCity: row.dto.city, restaurantState: row.dto.state, restaurantZipCode: row.dto.zipCode });
    return { rank0: preferred ? 0 : 1, rank1: preferred ? 0 : distance, rank2: 0, distanceMiles: distance };
}
export function available(criteria: any, parent: any, offer: any) {
    // JSONB DTOs cannot retain Timestamp methods. Decode the canonical source
    // projection, exactly as the native result builder does, so scheduled and
    // inclusive/submillisecond expiry rules keep their original semantics.
    const projection = decodePostgisProjection(offer.projection);
    if (projection.customerParentEligibilityFingerprint !== parent.dto.customerParentEligibilityFingerprint)
        return { visible: false };
    return evaluateCustomerBiteSaverOfferAvailability({ offerType: offer.kind, offer: projection,
        parentEligible: parent.visible, now: new Date(criteria.membershipMs), timeZone: criteria.timeZone,
        locationMode: criteria.locationMode, restaurantCoordinates: parent.dto,
        currentCoordinates: criteria.locationMode === "current" ? criteria.center : null, usage: null });
}
export function saverMatches(criteria: any, parent: any, offer: any): boolean {
    return saver.customerBiteSaverRestaurantMatches(criteria.text || "", parent.dto) ||
        (offer.dto.searchMatchComplete === true && saver.customerBiteSaverMatchValuesContain(criteria.text || "", offer.dto.searchMatchValues));
}
/** Receives only the source adapter's sanitized projection, not raw account roots. */
export function entityFromProjection(document: CustomerBiteSaverStoredDocument, encodedProjection: unknown): Record<string, any> {
    const data = document.data as Record<string, any>;
    const space = data.source === "biteSaver" ? "saver" : data.source === "biteScore" ? "score" : null;
    const kind = data.entityType === "offer" ? data.offerType : data.entityType;
    if (space === null || !["restaurant", "dish", "coupon", "dailySpecial"].includes(kind))
        throw new Error("postgis_projection_identity");
    const dto = space === "score" ? readCustomerBiteScorePublicProjection(document, kind) : data;
    const parentId = space === "saver" && kind !== "restaurant"
        ? saver.decodeDartUtf16FirestoreBytesOrderKey(data.restaurantAccountId, 1500)
        : space === "score" && kind === "dish" ? data.restaurantSourceDocumentId : null;
    if (space === "saver" && kind !== "restaurant" && parentId === null)
        throw new Error("postgis_projection_parent");
    // Coupon IDs are scoped to an account. The qualified prototype's synthetic
    // globally unique child IDs must never collapse two real restaurant offers.
    const id = space === "saver" && kind !== "restaurant" ? document.id : data.sourceDocumentId;
    if (typeof id !== "string" || !id)
        throw new Error("postgis_projection_identity");
    const view = (dto ?? {}) as Record<string, any>;
    const coordinates = geo.validRestaurantCoordinates(view.latitude, view.longitude);
    const visible = space === "score" ? dto !== null : kind === "restaurant" ? data.publicVisible === true : data.customerDiscoverable === true;
    const fields = space === "saver" ? kind === "restaurant"
        ? [view.displayName, view.city, view.zipCode, view.bio].map(v => saver.normalizeCustomerBiteSaverSearchText(typeof v === "string" ? v : ""))
        : Array.isArray(view.searchMatchValues) ? view.searchMatchValues : []
        : [matcher.normalizeBiteScoreFood(view.displayName || "")];
    return { space, kind, id, parent_id: parentId, visible, dto: view, projection: encodedProjection, index_path: document.path,
        fingerprint: space === "score" ? hash(view) : data.sourceFingerprint,
        latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null,
        name_key: customerBiteScoreUtf16Key((view.displayName || view.displayTitle || "").toLowerCase()).toString("hex"),
        id_key: customerBiteScoreUtf16Key(id).toString("hex"), fields: fields.join("\u0001"),
        state: (view.state || "").trim().toUpperCase(), city: matcher.normalizeBiteScoreFinderText(view.city || ""),
        zip: (view.zipCode || "").trim(), finder_name: finderNorm(view.displayName || ""),
        finder_close: matcher.normalizeBiteScoreFinderText(view.displayName || ""), finder_tokens: (view.displayName || "").toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean),
        score: view.overallBiteScore || 0, reviews: view.ratingCount || 0,
        value_score: view.valueScoreAverage ?? null, flavor_score: view.tastinessScoreAverage ?? null,
        quality_score: view.qualityScoreAverage ?? null, enjoyed_score: view.overallImpressionAverage ?? null,
        pref_city: contract.normalizeCustomerBiteSaverCity(view.city || ""), pref_state: contract.canonicalCustomerBiteSaverState(view.state) || "",
        raw_city_lower: (view.city || "").toLowerCase(), raw_zip_lower: (view.zipCode || "").toLowerCase(), recall: recallValues(view) };
}
