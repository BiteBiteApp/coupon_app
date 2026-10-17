import {createHash} from "node:crypto";
import {Timestamp} from "firebase-admin/firestore";

/** The projection authority boundary, shared with the recovered 16-shard proof. */
export const postgisSourceVersion = "bitestar.postgis-source.v1" as const;
export const postgisSourceShardCount = 16;
export const postgisSourceCollections = Object.freeze([
  "restaurant_search_index", "dish_search_index", "bitesaver_offer_index",
] as const);
export type PostgisSourceCollection = typeof postgisSourceCollections[number];
export type PostgisJson = null | boolean | number | string |
  readonly PostgisJson[] | {readonly [key: string]: PostgisJson};
export type PostgisProjection = Readonly<Record<string, PostgisJson>>;
export type PostgisSourcePayload = Readonly<{
  collection: PostgisSourceCollection;
  indexDocumentId: string;
  projection: PostgisProjection | null;
}>;
export type PostgisSourceEvent = Readonly<{
  shard: number;
  seq: number;
  payload: PostgisSourcePayload;
  digest: string;
}>;
export type PostgisSourcePartition = Readonly<{count: number; xor: string}>;
export type PostgisSourceShard = Readonly<{
  seq: number;
  partitions: Readonly<Record<PostgisSourceCollection, PostgisSourcePartition>>;
}>;
export type PostgisSourceFence = Readonly<{
  protocolVersion: typeof postgisSourceVersion;
  epoch: string;
  enrolled: boolean;
  shards: readonly PostgisSourceShard[];
}>;
export const postgisZeroDigest = "0".repeat(64);

export function postgisCanonicalJson(value: PostgisJson): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new Error("Invalid PostGIS JSON value.");
  if (Array.isArray(value)) return `[${value.map(postgisCanonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, PostgisJson>>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${postgisCanonicalJson(record[key])}`).join(",")}}`;
}

export function postgisSourceDigest(value: PostgisJson): string {
  return createHash("sha256").update(postgisCanonicalJson(value)).digest("hex");
}

export function postgisSourceIdentity(collection: string, id: string): string {
  if (!postgisSourceCollections.includes(collection as PostgisSourceCollection) ||
      typeof id !== "string" || !id || id.includes("/") ||
      Buffer.byteLength(id) > 1500) throw new Error("Invalid PostGIS source identity.");
  return JSON.stringify([collection, id]);
}

export function postgisSourceShardFor(collection: string, id: string): number {
  return createHash("sha256").update(postgisSourceIdentity(collection, id))
    .digest()[0] % postgisSourceShardCount;
}

export function postgisXorDigest(left: string, right: string): string {
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) {
    throw new Error("Invalid PostGIS source digest.");
  }
  const result = Buffer.from(left, "hex");
  const other = Buffer.from(right, "hex");
  for (let i = 0; i < result.length; i++) result[i] ^= other[i];
  return result.toString("hex");
}

export function emptyPostgisSourceShard(): PostgisSourceShard {
  return {seq: 0, partitions: Object.fromEntries(postgisSourceCollections.map(
    (collection) => [collection, {count: 0, xor: postgisZeroDigest}],
  )) as Record<PostgisSourceCollection, PostgisSourcePartition>};
}

// These are public projection fields plus backend-only identity and eligibility
// witnesses. Raw accounts, customer history, device proofs, billing and secrets
// never cross this boundary. BiteScore uses its existing customer projection.
const saverFields = new Set([
  "searchIndexVersion", "publicProjectionVersion", "customerOfferProjectionVersion",
  "source", "entityType", "sourceKind", "sourceDocumentId", "indexDocumentId",
  "sourceFingerprint", "publicRestaurantId", "publicOfferId", "restaurantAccountId",
  "displayName", "normalizedName", "namePrefixTokens", "displayTitle",
  "normalizedTitle", "titlePrefixTokens", "restaurantDisplayName",
  "restaurantNormalizedName", "restaurantNamePrefixTokens", "zip5", "normalizedCity",
  "normalizedState", "cityStateKey", "latitude", "longitude", "geohash",
  "publicVisible", "customerDiscoverable", "customerParentEligibilityFingerprint",
  "streetAddress", "city", "state", "zipCode", "phone", "website", "bio",
  "cuisineTags", "primaryImageUrl", "restaurantPrimaryImageUrl", "businessHours",
  "formattedAddress", "menuSourceSide", "linkedBiteScoreRestaurantId",
  "biteScoreCatalogRestaurantId", "biteSaverCatalogBindingId", "offerType",
  "offerCatalogUpdatedAt", "offerCatalogUpdatedAtOrderKey", "catalogGenerationContribution",
  "descriptionSummary", "restaurantBio", "sourceCreatedAt", "sourceCreatedAtOrderKey",
  "createdAt", "presentationTypeRank", "customerSearchNormalizerVersion",
  "customerSearchMatcherVersion", "searchMatchValues", "searchMatchComplete",
  "details", "couponRestaurantName", "usageRule", "couponCode", "couponNumber",
  "explicitActive", "offerActive", "startAt", "endAt", "startTime", "endTime",
  "expiresText", "isProximityOnly", "proximityRadiusMiles", "availabilityMode",
  "daysOfWeek", "allDay", "hideWhenUnavailable", "expiresAt",
]);
const scoreFields = new Set([
  "customerPublicProjectionVersion", "source", "entityType", "sourceDocumentId",
  "restaurantSourceDocumentId", "publicVisible", "displayName", "normalizedName",
  "namePrefixTokens", "restaurantDisplayName", "restaurantNormalizedName",
  "restaurantNamePrefixTokens", "restaurantCity", "restaurantState", "restaurantZipCode",
  "zip5", "normalizedCity", "normalizedState", "cityStateKey", "latitude", "longitude",
  "geohash", "categoryTokens", "categoryPrefixTokens", "normalizedCategory", "category",
  "subcategory", "categoryManualKeywords", "categoryTags", "priceLabel", "overallBiteScore",
  "ratingCount", "overallImpressionAverage", "tastinessScoreAverage", "qualityScoreAverage",
  "valueScoreAverage", "primaryImageUrl", "streetAddress", "city", "state", "zipCode",
  "isClaimed", "cuisineTags", "phone", "website", "bio", "businessHours",
]);

function normalize(value: unknown, depth = 0): PostgisJson {
  if (depth > 20) throw new Error("PostGIS projection nesting exceeds its bound.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return normalize(Timestamp.fromDate(value), depth);
  if (value instanceof Timestamp) {
    return {__postgisType: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds};
  }
  if (value instanceof Uint8Array) {
    return {__postgisType: "bytes", base64: Buffer.from(value).toString("base64")};
  }
  if (Array.isArray(value)) return value.map((entry) => normalize(entry, depth + 1));
  if (typeof value === "object" && value !== null &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    if (Object.prototype.hasOwnProperty.call(value, "__postgisType")) throw new Error("Reserved PostGIS projection field.");
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key, normalize(entry, depth + 1)]));
  }
  throw new Error("Unsupported PostGIS projection value.");
}

export function encodePostgisProjection(
  collection: PostgisSourceCollection,
  id: string,
  source: Readonly<Record<string, unknown>> | null,
): PostgisProjection | null {
  postgisSourceIdentity(collection, id);
  if (source === null) return null;
  if (source.source !== "biteSaver" && source.source !== "biteScore") return null;
  if ((collection === "restaurant_search_index" && source.entityType !== "restaurant") ||
      (collection === "dish_search_index" && (source.source !== "biteScore" || source.entityType !== "dish")) ||
      (collection === "bitesaver_offer_index" && (source.source !== "biteSaver" || source.entityType !== "offer"))) return null;
  if (source.indexDocumentId !== id || typeof source.sourceDocumentId !== "string" ||
      typeof source.sourceFingerprint !== "string") return null;
  let fields: Record<string, unknown>;
  if (source.source === "biteScore") {
    const projection = source.customerPublicProjection;
    if (projection === null || typeof projection !== "object" || Array.isArray(projection)) return null;
    const customer = projection as Record<string, unknown>;
    if (customer.sourceDocumentId !== source.sourceDocumentId || customer.source !== "biteScore" ||
        customer.entityType !== source.entityType) return null;
    fields = {
      searchIndexVersion: source.searchIndexVersion,
      source: source.source,
      entityType: source.entityType,
      sourceDocumentId: source.sourceDocumentId,
      indexDocumentId: id,
      publicVisible: source.publicVisible,
      customerPublicProjectionVersion: source.customerPublicProjectionVersion,
      ...(source.entityType === "dish" ? {restaurantSourceDocumentId: source.restaurantSourceDocumentId} : {}),
      customerPublicProjection: Object.fromEntries(Object.entries(customer).filter(([key]) => scoreFields.has(key))),
      sourceFingerprint: source.sourceFingerprint,
    };
  } else {
    fields = Object.fromEntries(Object.entries(source).filter(([key]) => saverFields.has(key)));
  }
  const result = normalize(fields) as PostgisProjection;
  if (Buffer.byteLength(postgisCanonicalJson(result)) > 96 * 1024) {
    throw new Error("PostGIS projection exceeds its normalized size bound.");
  }
  return result;
}

export function decodePostgisProjection(projection: PostgisProjection): Readonly<Record<string, unknown>> {
  const decode = (value: PostgisJson): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(decode);
    const record = value as Readonly<Record<string, PostgisJson>>;
    if (record.__postgisType === "timestamp") {
      if (typeof record.seconds !== "number" || typeof record.nanoseconds !== "number") {
        throw new Error("Invalid encoded PostGIS timestamp.");
      }
      return new Timestamp(record.seconds, record.nanoseconds);
    }
    if (record.__postgisType === "bytes") {
      if (typeof record.base64 !== "string") throw new Error("Invalid encoded PostGIS bytes.");
      const bytes = Buffer.from(record.base64, "base64");
      if (bytes.toString("base64") !== record.base64) throw new Error("Invalid encoded PostGIS bytes.");
      return bytes;
    }
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, decode(entry)]));
  };
  return decode(projection) as Readonly<Record<string, unknown>>;
}

/** Bounded backend checkpoint codec, never a public-search field allowlist. */
export function encodePostgisPrivateState(value: Readonly<Record<string, unknown>>): PostgisProjection {
  const result = normalize(value) as PostgisProjection;
  // A bounded native candidate/result packet can hold several 64 KiB public
  // projections plus its eligibility witnesses. This is not an unbounded log.
  if (Buffer.byteLength(postgisCanonicalJson(result)) > 8 * 1024 * 1024) throw new Error("PostGIS private checkpoint exceeds its bound.");
  return result;
}
export const decodePostgisPrivateState = decodePostgisProjection;

export function validatePostgisSourceEvent(event: PostgisSourceEvent): void {
  const expectedShard = postgisSourceShardFor(event.payload.collection, event.payload.indexDocumentId);
  if (event.shard !== expectedShard || !Number.isSafeInteger(event.seq) || event.seq < 1 ||
      event.digest !== postgisSourceDigest(event.payload)) throw new Error("Invalid or poisoned PostGIS source event.");
}

export function postgisSourceManifest(events: readonly PostgisSourceEvent[]): Readonly<Record<string, PostgisSourcePartition>> {
  const rows = new Map<string, PostgisSourcePayload>();
  for (const event of events) {
    validatePostgisSourceEvent(event);
    const key = postgisSourceIdentity(event.payload.collection, event.payload.indexDocumentId);
    if (event.payload.projection === null) rows.delete(key);
    else rows.set(key, event.payload);
  }
  const result: Record<string, PostgisSourcePartition> = {};
  for (const collection of postgisSourceCollections) result[collection] = {count: 0, xor: postgisZeroDigest};
  for (const payload of rows.values()) {
    const old = result[payload.collection];
    result[payload.collection] = {count: old.count + 1, xor: postgisXorDigest(old.xor, postgisSourceDigest(payload))};
  }
  return result;
}
