import {createHash} from "node:crypto";
import {createQueryFingerprint} from "./query_fingerprint.js";
import {customerDiscoveryDefaultPageSize} from "./pagination_protocol.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {
  biteScoreDishCustomerPublicProjectionVersion,
  biteScoreRestaurantCustomerPublicProjectionVersion,
  createSearchIndexDocumentId,
  maximumSearchIndexDocumentBytes,
  searchIndexVersion,
} from "./search_index_contract.js";
import {validRestaurantCoordinates} from "./restaurant_geo_helpers.js";
import type {CustomerBiteSaverStoredDocument} from "./customer_bitesaver_search_store.js";

export const customerBiteScoreSearchVersion = "bitestar.customer-bitescore-search.v1";
export const customerBiteScorePageSize = customerDiscoveryDefaultPageSize;
export const customerBiteScoreFinderSize = 8;
export const customerBiteScorePreparationBatchSize = 25;
export const customerBiteScoreSessionLifetimeMs = 60 * 60_000;
export const customerBiteScoreIdleLifetimeMs = 15 * 60_000;
export const customerBiteScoreLeaseLifetimeMs = 30_000;
export const customerBiteScoreSessionCollection = "private_bitescore_search_sessions";
export const customerBiteScoreResultCollection = "private_bitescore_search_results";
export const customerBiteScoreAdmissionCollection = "private_bitescore_search_admission";
export const customerBiteScoreGenerationCollection = "private_bitescore_catalog_generations";
export const customerBiteScoreSorts = ["Highest BiteScore", "Closest", "Most Reviewed",
  "Best Value", "Best Flavor", "Highest Quality", "Most Enjoyed"] as const;
// Alphabetical ordering is confined to the existing restaurant-bound merge
// chooser; the Home discovery contract retains its seven established choices.
export type CustomerBiteScoreSort = typeof customerBiteScoreSorts[number] | "Dish Name";
export type CustomerBiteScoreKind = "restaurant" | "dish";
export type CustomerBiteScorePublicDto = Readonly<Record<string, unknown>>;
export type CustomerBiteScoreCriteria = Readonly<{
  kind: CustomerBiteScoreKind;
  text: string;
  locationText: string;
  center: Readonly<{latitude: number; longitude: number}> | null;
  radiusMiles: number;
  sort: CustomerBiteScoreSort;
  categoryQueries: readonly string[];
  restaurantId: string | null;
  finder: Readonly<{state: string; location: string; mode: "suggestions" | "close"}> | null;
}>;

export class CustomerBiteScoreSearchError extends Error {
  constructor(readonly code: "invalid-argument" | "failed-precondition" |
    "permission-denied" | "resource-exhausted" | "unavailable", message: string) {
    super(message);
    this.name = "CustomerBiteScoreSearchError";
  }
}

export function biteScoreRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(): never {
  throw new CustomerBiteScoreSearchError("invalid-argument", "Invalid BiteScore search request.");
}

export function biteScoreRequestString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maximum ||
      /[\u0000-\u001f\u007f]/u.test(value)) invalid();
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const trailing = value.charCodeAt(++i);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) invalid();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid();
  }
  return value;
}

export function parseCustomerBiteScoreCriteria(value: unknown): CustomerBiteScoreCriteria {
  if (!biteScoreRecord(value)) invalid();
  const keys = ["kind", "text", "locationText", "center", "radiusMiles", "sort",
    "categoryQueries", "restaurantId", "finder"];
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
  if (value.kind !== "restaurant" && value.kind !== "dish") invalid();
  const text = biteScoreRequestString(value.text ?? "", 800).trim();
  const locationText = biteScoreRequestString(value.locationText ?? "", 400).trim().toLowerCase();
  const center = value.center == null ? null : biteScoreRecord(value.center)
    ? validRestaurantCoordinates(value.center.latitude, value.center.longitude) : null;
  if (value.center != null && (center === null ||
      Object.keys(value.center as object).some((key) => !["latitude", "longitude"].includes(key)))) invalid();
  const radiusMiles = value.radiusMiles ?? 15;
  if (typeof radiusMiles !== "number" || ![1, 3, 5, 10, 15, 20, 30].includes(radiusMiles)) invalid();
  const sort = value.sort ?? "Highest BiteScore";
  const rawQueries = value.categoryQueries ?? [];
  if (!Array.isArray(rawQueries) || rawQueries.length > 64) invalid();
  const categoryQueries = [...new Set(rawQueries.map((v) =>
    biteScoreRequestString(v, 400).trim()))].filter(Boolean).sort();
  const restaurantId = value.restaurantId == null ? null : readBiteScoreCatalogRestaurantId(value.restaurantId);
  if (value.restaurantId != null && restaurantId === null) invalid();
  if (!customerBiteScoreSorts.includes(sort as typeof customerBiteScoreSorts[number]) &&
      !(sort === "Dish Name" && value.kind === "dish" && restaurantId !== null)) invalid();
  let finder: CustomerBiteScoreCriteria["finder"] = null;
  if (value.finder != null) {
    if (value.kind !== "restaurant" || !biteScoreRecord(value.finder) ||
        Object.keys(value.finder).some((key) => !["state", "location", "mode"].includes(key))) invalid();
    const state = biteScoreRequestString(value.finder.state, 100).trim().toUpperCase();
    const location = biteScoreRequestString(value.finder.location ?? "", 400).trim();
    const mode = value.finder.mode ?? "suggestions";
    if ((mode !== "suggestions" && mode !== "close") || !state ||
        text.length < (mode === "close" ? 1 : 2) || center !== null || restaurantId !== null || categoryQueries.length !== 0) invalid();
    finder = Object.freeze({state, location, mode});
  }
  return Object.freeze({kind: value.kind, text, locationText, center, radiusMiles,
    sort: sort as CustomerBiteScoreSort, categoryQueries: Object.freeze(categoryQueries),
    restaurantId, finder});
}

export function customerBiteScoreCriteriaFingerprint(criteria: CustomerBiteScoreCriteria): string {
  return createQueryFingerprint({version: customerBiteScoreSearchVersion, ...criteria,
    center: criteria.center === null ? null : {
      latitude: criteria.center.latitude.toString(), longitude: criteria.center.longitude.toString(),
    }});
}

export function customerBiteScoreDigest(...values: unknown[]): string {
  return createHash("sha256").update(JSON.stringify([customerBiteScoreSearchVersion, ...values]), "utf8").digest("hex");
}

export function customerBiteScoreGenerationShardPath(kind: CustomerBiteScoreKind, sourceId: string): string {
  if (readBiteScoreCatalogRestaurantId(sourceId) !== sourceId) invalid();
  const shard = parseInt(customerBiteScoreDigest(kind, sourceId).slice(0, 2), 16) % 16;
  return `${customerBiteScoreGenerationCollection}/${shard.toString().padStart(2, "0")}`;
}
export const customerBiteScoreGenerationShardPaths = Object.freeze(Array.from({length: 16},
  (_, shard) => `${customerBiteScoreGenerationCollection}/${shard.toString().padStart(2, "0")}`));

export function readCustomerBiteScoreGenerationShard(value: unknown): number {
  if (value == null) return 0;
  if (!biteScoreRecord(value) || value.version !== customerBiteScoreSearchVersion ||
      !Number.isSafeInteger(value.generation) || (value.generation as number) < 0) {
    throw new CustomerBiteScoreSearchError("unavailable", "BiteScore catalog generation is unavailable.");
  }
  return value.generation as number;
}
export function nextCustomerBiteScoreGenerationDocument(value: unknown, now: Date): Readonly<Record<string, unknown>> {
  const generation = readCustomerBiteScoreGenerationShard(value) + 1;
  if (!Number.isSafeInteger(generation)) throw new CustomerBiteScoreSearchError("unavailable", "BiteScore catalog generation is exhausted.");
  return Object.freeze({version: customerBiteScoreSearchVersion, generation, updatedAt: now});
}

export function customerBiteScoreIndexPath(kind: CustomerBiteScoreKind, id: string): string {
  const indexId = createSearchIndexDocumentId({entityKind: kind,
    sourceKind: kind === "dish" ? "biteScoreDish" : "biteScoreRestaurant", sourceDocumentId: id});
  return `${kind === "dish" ? "dish_search_index" : "restaurant_search_index"}/${indexId}`;
}

const stringFields = ["displayName", "normalizedName", "streetAddress", "city", "state", "zipCode",
  "zip5", "normalizedCity", "normalizedState", "cityStateKey", "geohash", "phone", "website", "bio",
  "primaryImageUrl", "restaurantDisplayName", "restaurantNormalizedName", "restaurantCity", "restaurantState",
  "restaurantZipCode", "category", "subcategory", "categoryManualKeywords", "normalizedCategory", "priceLabel"];
const listFields = ["namePrefixTokens", "restaurantNamePrefixTokens", "categoryPrefixTokens", "categoryTokens",
  "categoryTags", "cuisineTags"];
const scoreFields = ["overallImpressionAverage", "tastinessScoreAverage", "qualityScoreAverage", "valueScoreAverage"];

/** Copy the nested projection allowlist; never return an index/source object. */
export function readCustomerBiteScorePublicProjection(document: CustomerBiteSaverStoredDocument | null,
  kind: CustomerBiteScoreKind): CustomerBiteScorePublicDto | null {
  if (document === null) return null;
  const data = document.data;
  const id = readBiteScoreCatalogRestaurantId(data.sourceDocumentId);
  const expectedVersion = kind === "dish" ? biteScoreDishCustomerPublicProjectionVersion : biteScoreRestaurantCustomerPublicProjectionVersion;
  if (id === null || document.path !== customerBiteScoreIndexPath(kind, id) ||
      document.id !== document.path.slice(document.path.lastIndexOf("/") + 1) ||
      data.searchIndexVersion !== searchIndexVersion || data.source !== "biteScore" ||
      data.entityType !== kind || data.publicVisible !== true ||
      data.customerPublicProjectionVersion !== expectedVersion || !biteScoreRecord(data.customerPublicProjection)) return null;
  const p = data.customerPublicProjection;
  if (p.customerPublicProjectionVersion !== expectedVersion || p.source !== "biteScore" || p.entityType !== kind ||
      p.sourceDocumentId !== id || p.publicVisible !== true || typeof p.displayName !== "string" ||
      !p.displayName.trim() || p.displayName.length > 400 || validRestaurantCoordinates(p.latitude, p.longitude) === null ||
      Buffer.byteLength(JSON.stringify(p), "utf8") > maximumSearchIndexDocumentBytes) return null;
  const result: Record<string, unknown> = {customerPublicProjectionVersion: expectedVersion, source: "biteScore",
    entityType: kind, sourceDocumentId: id, publicVisible: true, latitude: p.latitude, longitude: p.longitude};
  for (const field of stringFields) {
    if (typeof p[field] === "string") result[field] = p[field];
  }
  for (const field of listFields) {
    if (Array.isArray(p[field]) && p[field].every((v) => typeof v === "string")) result[field] = [...p[field]];
  }
  if (kind === "restaurant") {
    if (!["streetAddress", "city", "state", "zipCode"].every((f) => typeof p[f] === "string") ||
        typeof p.isClaimed !== "boolean") return null;
    result.isClaimed = p.isClaimed;
    if (Array.isArray(p.businessHours) && p.businessHours.length <= 7) {
      const hours = p.businessHours.filter(biteScoreRecord).filter((v) =>
        typeof v.day === "string" && typeof v.opensAt === "string" && typeof v.closesAt === "string" && typeof v.closed === "boolean")
        .map((v) => ({day: v.day, opensAt: v.opensAt, closesAt: v.closesAt, closed: v.closed}));
      if (hours.length === p.businessHours.length) result.businessHours = hours;
    }
  } else {
    const parent = readBiteScoreCatalogRestaurantId(p.restaurantSourceDocumentId);
    if (parent === null || parent !== data.restaurantSourceDocumentId ||
        typeof p.overallBiteScore !== "number" || !Number.isFinite(p.overallBiteScore) ||
        p.overallBiteScore < 0 || p.overallBiteScore > 100 || !Number.isSafeInteger(p.ratingCount) ||
        (p.ratingCount as number) < 0) return null;
    result.restaurantSourceDocumentId = parent;
    result.overallBiteScore = p.overallBiteScore;
    result.ratingCount = p.ratingCount;
    for (const field of scoreFields) {
      const number = p[field];
      if (typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 10) result[field] = number;
    }
  }
  return Object.freeze(result);
}

// Firestore strings order by UTF-8; Dart's existing comparator uses UTF-16.
// Two <=1,500-byte fields preserve the complete valid ID (up to 1,500 UTF-8
// bytes), including astral/BMP ordering, without truncating indexed values.
export function customerBiteScoreUtf16Key(value: string): Buffer {
  const buffer = Buffer.alloc(value.length * 2);
  for (let i = 0; i < value.length; i += 1) buffer.writeUInt16BE(value.charCodeAt(i), i * 2);
  return buffer;
}
