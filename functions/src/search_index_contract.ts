import { createHash } from "node:crypto";

export const searchIndexVersion = "bitestar.search-index.v1" as const;
export const searchIndexJobVersion =
  "bitestar.search-index-job.v1" as const;

export const restaurantSearchIndexCollection =
  "restaurant_search_index" as const;
export const dishSearchIndexCollection = "dish_search_index" as const;
export const biteSaverOfferIndexCollection =
  "bitesaver_offer_index" as const;
export const privateSearchIndexJobCollection =
  "private_search_index_jobs" as const;

export const maximumSearchIndexDocumentBytes = 64 * 1024;
export const maximumSearchIndexWorkerBatchSize = 100;
export const searchIndexJobLifetimeMilliseconds = 24 * 60 * 60 * 1000;

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
  continuationCursor?: SearchIndexJobCursor;
  status: "pending";
  createdAt: Date;
  expiresAt: Date;
}>;

function requireDocumentId(value: string, label: string): string {
  if (!value || value.includes("/")) {
    throw new Error(`${label} must be one Firestore document-ID segment.`);
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
  continuationCursor?: SearchIndexJobCursor | null;
}): string {
  const parentSourceDocumentId = requireDocumentId(
    value.parentSourceDocumentId,
    "Parent source document ID",
  );
  const cursor = value.continuationCursor ?? null;
  return `sij_${digestTuple([
    searchIndexJobVersion,
    value.jobKind,
    value.parentSource,
    parentSourceDocumentId,
    value.requestedSourceFingerprint,
    cursor?.phase ?? null,
    cursor?.afterDocumentId ?? null,
  ])}`;
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
  if (!/^[0-9a-f]{64}$/u.test(value.requestedSourceFingerprint)) {
    throw new Error("Search index job source fingerprint is invalid.");
  }
  if (
    (value.jobKind === "biteSaverOffers" && value.parentSource !== "biteSaver") ||
    (value.jobKind === "biteScoreDishes" && value.parentSource !== "biteScore")
  ) {
    throw new Error("Search index job kind and parent source do not match.");
  }
  const suppliedCursor = value.continuationCursor ?? null;
  if (
    suppliedCursor !== null &&
    ((![
      "coupons",
      "dailySpecials",
      "dishes",
      "derivedCleanup",
    ].includes(suppliedCursor.phase)) ||
      (suppliedCursor.afterDocumentId !== null &&
      (!suppliedCursor.afterDocumentId || suppliedCursor.afterDocumentId.includes("/"))) ||
      (value.jobKind === "biteSaverOffers" && suppliedCursor.phase === "dishes") ||
      (value.jobKind === "biteScoreDishes" &&
        suppliedCursor.phase !== "dishes" &&
        suppliedCursor.phase !== "derivedCleanup"))
  ) {
    throw new Error("Search index job continuation cursor is invalid.");
  }
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
    requestedSourceFingerprint: value.requestedSourceFingerprint,
    ...(continuationCursor === null ? {} : { continuationCursor }),
    status: "pending" as const,
    createdAt,
    expiresAt,
  });
}
