import { createHash } from "node:crypto";
import {
  customerBiteSaverCatalogGenerationShardCount,
  customerBiteSaverGenerationShardForIdentity,
  customerBiteSaverGenerationShardId,
  customerBiteSaverSearchProtocolVersion,
} from "./customer_bitesaver_search_contract.js";
import { readBiteScoreCatalogRestaurantId } from "./restaurant_invite_helpers.js";

export const searchIndexVersion = "bitestar.search-index.v1" as const;
export const searchIndexJobVersion =
  "bitestar.search-index-job.v1" as const;
export const biteScoreRestaurantCustomerPublicProjectionVersion =
  "bitestar.bitescore-customer-public-restaurant.v1" as const;
export const biteScoreDishCustomerPublicProjectionVersion =
  "bitestar.bitescore-customer-public-dish.v1" as const;

export const restaurantSearchIndexCollection =
  "restaurant_search_index" as const;
export const dishSearchIndexCollection = "dish_search_index" as const;
export const biteSaverOfferIndexCollection =
  "bitesaver_offer_index" as const;
export const privateSearchIndexJobCollection =
  "private_search_index_jobs" as const;
export const customerBiteSaverCatalogGenerationContributionField =
  "catalogGenerationContribution" as const;
export const customerBiteSaverCatalogGenerationProtocolVersion =
  customerBiteSaverSearchProtocolVersion;

export const maximumSearchIndexDocumentBytes = 64 * 1024;
export const maximumSearchIndexWorkerBatchSize = 100;
export const maximumPrivateSearchIndexCursorDocumentIdBytes = 1_500;
export const searchIndexJobLifetimeMilliseconds = 24 * 60 * 60 * 1000;

export const customerBiteSaverCatalogGenerationShardIds = Object.freeze(
  Array.from(
    {length: customerBiteSaverCatalogGenerationShardCount},
    (_, index) => customerBiteSaverGenerationShardId(index),
  ),
);

export type SearchIndexEntityKind = "restaurant" | "dish" | "offer";
export type SearchIndexSourceKind =
  | "biteSaverRestaurant"
  | "biteScoreRestaurant"
  | "biteScoreDish"
  | "biteSaverCoupon"
  | "biteSaverDailySpecial";

export type SearchIndexJobKind = "biteSaverOffers" | "biteScoreDishes";
export type SearchIndexJobParentSource = "biteSaver" | "biteScore";
export type SearchIndexJobCursorPhase =
  | "coupons"
  | "dailySpecials"
  | "dishes"
  | "derivedCleanup";

export type SearchIndexJobCursor = Readonly<{
  phase: SearchIndexJobCursorPhase;
  afterDocumentId: string | null;
}>;

export type SearchIndexJobDocument = Readonly<{
  searchIndexJobVersion: typeof searchIndexJobVersion;
  jobKind: SearchIndexJobKind;
  parentSource: SearchIndexJobParentSource;
  parentSourceDocumentId: string;
  requestedSourceFingerprint: string;
  sourceOccurrenceId: string;
  continuationCursor?: SearchIndexJobCursor;
  status: "pending";
  createdAt: Date;
  expiresAt: Date;
}>;

export type CustomerBiteSaverCatalogIdentity =
  | Readonly<{
      entityType: "restaurant";
      restaurantAccountId: string;
    }>
  | Readonly<{
      entityType: "offer";
      offerType: "coupon" | "dailySpecial";
      restaurantAccountId: string;
      sourceDocumentId: string;
    }>;

export type CustomerBiteSaverCatalogGenerationShardDocument = Readonly<{
  protocolVersion: typeof customerBiteSaverCatalogGenerationProtocolVersion;
  shardIndex: number;
  generation: number;
  updatedAt: Date;
}>;

function requireDocumentId(value: string, label: string): string {
  if (readBiteScoreCatalogRestaurantId(value) !== value) {
    throw new Error(`${label} must be one Firestore document-ID segment.`);
  }
  return value;
}

export function createCustomerBiteSaverCatalogIdentity(
  value: CustomerBiteSaverCatalogIdentity,
): string {
  const restaurantAccountId = requireDocumentId(
    value.restaurantAccountId,
    "BiteSaver catalog restaurant account ID",
  );
  if (value.entityType === "restaurant") {
    return JSON.stringify([
      customerBiteSaverCatalogGenerationProtocolVersion,
      "restaurant",
      restaurantAccountId,
    ]);
  }
  const sourceDocumentId = requireDocumentId(
    value.sourceDocumentId,
    "BiteSaver catalog offer source document ID",
  );
  return JSON.stringify([
    customerBiteSaverCatalogGenerationProtocolVersion,
    "offer",
    value.offerType,
    restaurantAccountId,
    sourceDocumentId,
  ]);
}

export function customerBiteSaverCatalogGenerationShard(value: {
  identity: CustomerBiteSaverCatalogIdentity;
}): Readonly<{index: number; documentId: string}> {
  const canonicalIdentity = createCustomerBiteSaverCatalogIdentity(value.identity);
  const index = customerBiteSaverGenerationShardForIdentity(canonicalIdentity);
  return Object.freeze({
    index,
    documentId: customerBiteSaverGenerationShardId(index),
  });
}

export function createCustomerBiteSaverCatalogGenerationContribution(
  customerProjection: Readonly<Record<string, unknown>> | null,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        customerBiteSaverCatalogGenerationProtocolVersion,
        "projectionContribution",
        customerProjection,
      ]),
      "utf8",
    )
    .digest("hex");
}

function generationTimestampIsValid(value: unknown): boolean {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime());
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as {toDate?: () => unknown};
  if (typeof candidate.toDate !== "function") {
    return false;
  }
  try {
    const converted = candidate.toDate();
    return converted instanceof Date && Number.isFinite(converted.getTime());
  } catch {
    return false;
  }
}

export function readCustomerBiteSaverCatalogGeneration(
  value: unknown,
  expectedShardIndex: number,
): number {
  if (
    !Number.isInteger(expectedShardIndex) ||
    Object.is(expectedShardIndex, -0) ||
    expectedShardIndex < 0 ||
    expectedShardIndex >= customerBiteSaverCatalogGenerationShardCount
  ) {
    throw new Error("BiteSaver catalog generation shard is invalid.");
  }
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BiteSaver catalog generation document is invalid.");
  }
  const document = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(document);
  if (
    keys.length !== 4 ||
    !keys.includes("generation") ||
    !keys.includes("protocolVersion") ||
    !keys.includes("shardIndex") ||
    !keys.includes("updatedAt") ||
    document.protocolVersion !==
      customerBiteSaverCatalogGenerationProtocolVersion ||
    document.shardIndex !== expectedShardIndex ||
    !Number.isSafeInteger(document.generation) ||
    Object.is(document.generation, -0) ||
    (document.generation as number) < 0 ||
    !generationTimestampIsValid(document.updatedAt)
  ) {
    throw new Error("BiteSaver catalog generation document is invalid.");
  }
  return document.generation as number;
}

export function buildCustomerBiteSaverCatalogGenerationShardDocument(value: {
  shardIndex: number;
  generation: number;
  updatedAt: Date;
}): CustomerBiteSaverCatalogGenerationShardDocument {
  if (
    !Number.isInteger(value.shardIndex) ||
    Object.is(value.shardIndex, -0) ||
    value.shardIndex < 0 ||
    value.shardIndex >= customerBiteSaverCatalogGenerationShardCount ||
    !Number.isSafeInteger(value.generation) ||
    Object.is(value.generation, -0) ||
    value.generation < 0 ||
    !(value.updatedAt instanceof Date) ||
    !Number.isFinite(value.updatedAt.getTime())
  ) {
    throw new Error("BiteSaver catalog generation document is invalid.");
  }
  return Object.freeze({
    protocolVersion: customerBiteSaverCatalogGenerationProtocolVersion,
    shardIndex: value.shardIndex,
    generation: value.generation,
    updatedAt: new Date(value.updatedAt.getTime()),
  });
}

function hasWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false;
      }
      const trailingCodeUnit = value.charCodeAt(index + 1);
      if (trailingCodeUnit < 0xdc00 || trailingCodeUnit > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const minimumFirestoreImportedNumericDocumentId = BigInt(
  "-9223372036854775808",
);
const maximumFirestoreImportedNumericDocumentId = BigInt(
  "9223372036854775807",
);

/**
 * Reads Firestore's imported numeric resource-path spelling. The SDK compares
 * these segments numerically, so private cursors accept only the unique
 * canonical spelling for each signed-int64 value.
 */
export function readCanonicalFirestoreImportedNumericDocumentId(
  value: unknown,
): bigint | null {
  if (typeof value !== "string" || value.length > 26) {
    return null;
  }
  const match = /^__id(0|[1-9][0-9]*|-[1-9][0-9]*)__$/u.exec(value);
  if (match === null) {
    return null;
  }
  const numericId = BigInt(match[1]);
  if (
    numericId < minimumFirestoreImportedNumericDocumentId ||
    numericId > maximumFirestoreImportedNumericDocumentId ||
    numericId.toString() !== match[1]
  ) {
    return null;
  }
  return numericId;
}

/**
 * Reads private query-continuation identity, not customer/product identity.
 * Firestore can return document IDs that the public product contract rejects,
 * so this deliberately preserves every valid raw code unit, including
 * whitespace and controls.
 */
export function readPrivateSearchIndexCursorDocumentId(
  value: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !hasWellFormedUtf16(value) ||
    Buffer.byteLength(value, "utf8") >
      maximumPrivateSearchIndexCursorDocumentIdBytes ||
    value.includes("/") ||
    value === "." ||
    value === ".." ||
    (/^__[\s\S]*__$/u.test(value) &&
      readCanonicalFirestoreImportedNumericDocumentId(value) === null)
  ) {
    return null;
  }
  return value;
}

export function parsePrivateSearchIndexJobCursor(
  value: unknown,
): SearchIndexJobCursor | null {
  if (value === undefined) {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Search index job continuation cursor is invalid.");
  }
  const cursor = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(cursor);
  const phase = cursor.phase;
  const afterDocumentId = cursor.afterDocumentId;
  const parsedAfterDocumentId = afterDocumentId === null
    ? null
    : readPrivateSearchIndexCursorDocumentId(afterDocumentId);
  if (
    keys.length !== 2 ||
    !keys.includes("afterDocumentId") ||
    !keys.includes("phase") ||
    (phase !== "coupons" &&
      phase !== "dailySpecials" &&
      phase !== "dishes" &&
      phase !== "derivedCleanup") ||
    (afterDocumentId !== null && parsedAfterDocumentId !== afterDocumentId)
  ) {
    throw new Error("Search index job continuation cursor is invalid.");
  }
  return Object.freeze({ phase, afterDocumentId: parsedAfterDocumentId });
}

function requireCursorMatchesSearchIndexJobKind(
  jobKind: SearchIndexJobKind,
  cursor: SearchIndexJobCursor | null,
): void {
  if (
    cursor !== null &&
    ((jobKind === "biteSaverOffers" && cursor.phase === "dishes") ||
      (jobKind === "biteScoreDishes" &&
        cursor.phase !== "dishes" &&
        cursor.phase !== "derivedCleanup"))
  ) {
    throw new Error("Search index job continuation cursor is invalid.");
  }
}

function requireDigest(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function digestTuple(tuple: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex");
}

export function createSearchIndexDocumentId(value: {
  entityKind: SearchIndexEntityKind;
  sourceKind: SearchIndexSourceKind;
  sourceDocumentId: string;
  parentSourceDocumentId?: string | null;
}): string {
  const sourceDocumentId = requireDocumentId(
    value.sourceDocumentId,
    "Source document ID",
  );
  const parentSourceDocumentId = value.parentSourceDocumentId == null
    ? null
    : requireDocumentId(
        value.parentSourceDocumentId,
        "Parent source document ID",
      );
  return `si_${digestTuple([
    searchIndexVersion,
    value.entityKind,
    value.sourceKind,
    parentSourceDocumentId,
    sourceDocumentId,
  ])}`;
}

export function createSearchIndexJobId(value: {
  jobKind: SearchIndexJobKind;
  parentSource: SearchIndexJobParentSource;
  parentSourceDocumentId: string;
  requestedSourceFingerprint: string;
  sourceOccurrenceId: string;
  continuationCursor?: SearchIndexJobCursor | null;
}): string {
  const parentSourceDocumentId = requireDocumentId(
    value.parentSourceDocumentId,
    "Parent source document ID",
  );
  const requestedSourceFingerprint = requireDigest(
    value.requestedSourceFingerprint,
    "Search index job source fingerprint",
  );
  const sourceOccurrenceId = requireDigest(
    value.sourceOccurrenceId,
    "Search index job source occurrence",
  );
  const cursor = value.continuationCursor == null
    ? null
    : parsePrivateSearchIndexJobCursor(value.continuationCursor);
  requireCursorMatchesSearchIndexJobKind(value.jobKind, cursor);
  return `sij_${digestTuple([
    searchIndexJobVersion,
    value.jobKind,
    value.parentSource,
    parentSourceDocumentId,
    requestedSourceFingerprint,
    sourceOccurrenceId,
    cursor?.phase ?? null,
    cursor?.afterDocumentId ?? null,
  ])}`;
}

export function createSearchIndexSourceOccurrenceId(eventId: unknown): string {
  if (
    typeof eventId !== "string" ||
    eventId.length === 0 ||
    eventId.length > 4_096 ||
    Buffer.byteLength(eventId, "utf8") > 4_096
  ) {
    throw new Error("Search index source occurrence is invalid.");
  }
  return createHash("sha256")
    .update(`${searchIndexJobVersion}\0sourceOccurrence\0`, "utf8")
    .update(eventId, "utf16le")
    .digest("hex");
}

export function createSourceFingerprint(tuple: readonly unknown[]): string {
  return digestTuple([searchIndexVersion, ...tuple]);
}

export function serializedSearchIndexDocumentBytes(
  document: Readonly<Record<string, unknown>>,
): number {
  return Buffer.byteLength(JSON.stringify(document), "utf8");
}

export function requireSearchIndexDocumentSize<T extends Record<string, unknown>>(
  document: T,
): T {
  if (serializedSearchIndexDocumentBytes(document) > maximumSearchIndexDocumentBytes) {
    throw new Error("Search index document exceeds the private size limit.");
  }
  return document;
}

export function buildSearchIndexJobDocument(value: {
  jobKind: SearchIndexJobKind;
  parentSource: SearchIndexJobParentSource;
  parentSourceDocumentId: string;
  requestedSourceFingerprint: string;
  sourceOccurrenceId: string;
  now: Date;
  continuationCursor?: SearchIndexJobCursor | null;
  expiresAt?: Date;
}): SearchIndexJobDocument {
  const parentSourceDocumentId = requireDocumentId(
    value.parentSourceDocumentId,
    "Parent source document ID",
  );
  const createdAt = new Date(value.now.getTime());
  const expiresAt = value.expiresAt == null
    ? new Date(createdAt.getTime() + searchIndexJobLifetimeMilliseconds)
    : new Date(value.expiresAt.getTime());
  if (!Number.isFinite(createdAt.getTime()) || expiresAt <= createdAt) {
    throw new Error("Search index job timestamps are invalid.");
  }
  const requestedSourceFingerprint = requireDigest(
    value.requestedSourceFingerprint,
    "Search index job source fingerprint",
  );
  const sourceOccurrenceId = requireDigest(
    value.sourceOccurrenceId,
    "Search index job source occurrence",
  );
  if (
    (value.jobKind === "biteSaverOffers" && value.parentSource !== "biteSaver") ||
    (value.jobKind === "biteScoreDishes" && value.parentSource !== "biteScore")
  ) {
    throw new Error("Search index job kind and parent source do not match.");
  }
  const suppliedCursor = value.continuationCursor == null
    ? null
    : parsePrivateSearchIndexJobCursor(value.continuationCursor);
  requireCursorMatchesSearchIndexJobKind(value.jobKind, suppliedCursor);
  const continuationCursor = suppliedCursor === null
    ? null
    : Object.freeze({
        phase: suppliedCursor.phase,
        afterDocumentId: suppliedCursor.afterDocumentId,
      });
  return Object.freeze({
    searchIndexJobVersion,
    jobKind: value.jobKind,
    parentSource: value.parentSource,
    parentSourceDocumentId,
    requestedSourceFingerprint,
    sourceOccurrenceId,
    ...(continuationCursor === null ? {} : { continuationCursor }),
    status: "pending" as const,
    createdAt,
    expiresAt,
  });
}
