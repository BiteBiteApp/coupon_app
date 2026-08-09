import { createHash } from "node:crypto";
import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { OpaqueCursorCodec, type CursorSortValue } from "./opaque_cursor.js";
import {
  adminDirectoryDefaultPageSize,
  operationalQueueDefaultPageSize,
  pageProtocolVersion,
  parsePagedRequest,
  type PagedRequest,
} from "./pagination_protocol.js";
import { createQueryFingerprint } from "./query_fingerprint.js";
import {
  buildCityStateKey,
  maximumWordPrefixLength,
  normalizeSearchName,
  normalizeStateCode,
  normalizeZip5,
} from "./search_normalization.js";

export const ratingAdminRestaurantPageSize = adminDirectoryDefaultPageSize;
export const ratingAdminDirectoryPageSize = adminDirectoryDefaultPageSize;
export const ratingAdminQueuePageSize = operationalQueueDefaultPageSize;
export const ratingAdminInvitePageSize = adminDirectoryDefaultPageSize;
export const ratingAdminPostFilterReadBudget = 500;
export const ratingAdminCursorSecretName = "SEARCH_PAGINATION_CURSOR_KEY";

export type RatingAdminQueueKind =
  | "reportedReviews"
  | "restaurantReports"
  | "dishReports"
  | "duplicateRestaurantReports"
  | "claims";
export type RatingAdminRestaurantSearchMode =
  | "exactZip"
  | "exactCity"
  | "nearbyRadius";

export type RatingAdminDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type RatingAdminFilter = Readonly<{
  field: string;
  operation: "==" | "array-contains" | ">=" | "<=";
  value: unknown;
}>;

export type RatingAdminOrder = Readonly<{
  field: string;
  direction: "asc" | "desc";
}>;

export type RatingAdminQuery = Readonly<{
  collectionPath: string;
  filters: readonly RatingAdminFilter[];
  orders: readonly RatingAdminOrder[];
  cursor?: Readonly<{
    kind: "startAfter" | "endBefore";
    values: readonly unknown[];
  }>;
  limit: number;
  limitToLast?: boolean;
}>;

export interface RatingAdminPagingDatabase {
  queryDocuments(query: RatingAdminQuery): Promise<readonly RatingAdminDocument[]>;
  countDocuments(value: {
    collectionPath: string;
    filters: readonly RatingAdminFilter[];
  }): Promise<number>;
  getDocuments(paths: readonly string[]): Promise<readonly RatingAdminDocument[]>;
}

type RatingAdminStatus = "all" | "active" | "inactive";
type RatingAdminDirectoryKind =
  | "dishesByRestaurant"
  | "reviews"
  | "claimedRestaurants";

function requireStatus(value: unknown): RatingAdminStatus {
  if (value !== "all" && value !== "active" && value !== "inactive") {
    callableError("invalid-argument", "The Rating status is invalid.");
  }
  return value;
}

function statusMatches(value: unknown, status: RatingAdminStatus): boolean {
  const active = value !== false;
  return status === "all" || (status === "active" ? active : !active);
}

function idFrom(
  data: Readonly<Record<string, unknown>>,
  field: string,
): string | null {
  const value = readString(data[field], 1_500);
  return value !== null && !value.includes("/") ? value : null;
}

function numberOrZero(value: unknown): number {
  return readNumber(value) ?? 0;
}

function stringArray(value: unknown, maximumItems = 64): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Object.freeze(
    value
      .slice(0, maximumItems)
      .map((entry) => readString(entry, 200))
      .filter((entry): entry is string => entry !== null),
  );
}

function generatedReviewerName(userId: string): string {
  let seed = 0;
  for (const codeUnit of Array.from(userId)) {
    seed = ((seed * 31) + codeUnit.charCodeAt(0)) & 0x7fffffff;
  }
  return "anon" + (1 + (seed % 900000));
}

function reviewerDisplayName(
  userId: string,
  profile: RatingAdminDocument | undefined,
): string {
  return readString(profile?.data.chosenUsername, 100) ??
    readString(profile?.data.publicDisplayName, 100) ??
    readString(profile?.data.fallbackUsername, 100) ??
    generatedReviewerName(userId);
}

function mapById(
  documents: readonly RatingAdminDocument[],
): ReadonlyMap<string, RatingAdminDocument> {
  return new Map(documents.map((document) => [document.id, document]));
}

async function documentsByPath(
  database: RatingAdminPagingDatabase,
  collectionPath: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, RatingAdminDocument>> {
  const unique = [...new Set(ids.filter((id) => id && !id.includes("/")))];
  return mapById(
    await database.getDocuments(
      unique.map((id) => collectionPath + "/" + id),
    ),
  );
}

function restaurantSourceProjection(
  document: RatingAdminDocument,
): Readonly<Record<string, unknown>> | null {
  const data = document.data;
  const name = readString(data.name, 100) ??
    readString(data.restaurantName, 100);
  const latitude = readNumber(data.latitude);
  const longitude = readNumber(data.longitude);
  if (name === null || latitude === null || longitude === null) {
    return null;
  }
  return Object.freeze({
    id: document.id,
    name,
    normalizedName: readString(data.normalizedName, 200) ?? name.toLowerCase(),
    address: readString(data.address, 500) ??
      readString(data.streetAddress, 500) ?? "",
    city: readString(data.city, 100) ?? "",
    state: readString(data.state, 10) ?? "",
    zipCode: readString(data.zipCode, 20) ??
      readString(data.zip, 20) ?? "",
    latitude,
    longitude,
    phone: readString(data.phone, 100),
    website: readString(data.website, 2_048),
    ownerUserId: readString(data.ownerUserId, 1_500),
    isClaimed: data.isClaimed === true,
    isActive: data.isActive !== false && data.active !== false,
    createdAtMillis: timestampMillis(data.createdAt),
    updatedAtMillis: timestampMillis(data.updatedAt),
  });
}

export function ratingAdminRestaurantProjection(
  document: RatingAdminDocument,
  distanceMiles: number | null = null,
  expectedStatus: RatingAdminStatus = "all",
): Readonly<Record<string, unknown>> | null {
  const data = document.data;
  const name = readString(data.name, 100) ??
    readString(data.restaurantName, 100);
  const isActive = data.isActive !== false && data.active !== false;
  if (name === null || !statusMatches(isActive, expectedStatus)) {
    return null;
  }
  return Object.freeze({
    source: "biteScore",
    documentId: document.id,
    actionId: document.id,
    restaurantName: name,
    streetAddress: readString(data.address, 500) ??
      readString(data.streetAddress, 500) ?? "",
    city: readString(data.city, 100) ?? "",
    state: readString(data.state, 10) ?? "",
    zipCode: readString(data.zipCode, 20) ??
      readString(data.zip, 20) ?? "",
    phone: readString(data.phone, 100) ?? "",
    website: readString(data.website, 2_048) ?? "",
    latitude: readNumber(data.latitude),
    longitude: readNumber(data.longitude),
    distanceMiles,
    isActive,
    isClaimed: data.isClaimed === true,
    ownerUserId: readString(data.ownerUserId, 1_500),
    linkedBiteSaverUid: readString(data.linkedBiteSaverUid, 1_500),
  });
}

function dishProjection(
  document: RatingAdminDocument,
  expectedRestaurantId: string,
  expectedStatus: RatingAdminStatus,
): Readonly<Record<string, unknown>> | null {
  const data = document.data;
  const restaurantId = idFrom(data, "restaurantId");
  const name = readString(data.name, 100);
  if (
    restaurantId !== expectedRestaurantId ||
    name === null ||
    !statusMatches(data.isActive, expectedStatus) ||
    readString(data.mergedIntoDishId, 1_500) !== null
  ) {
    return null;
  }
  return Object.freeze({
    id: document.id,
    restaurantId,
    restaurantName: readString(data.restaurantName, 100) ?? "",
    name,
    normalizedName: readString(data.normalizedName, 200) ?? name.toLowerCase(),
    category: readString(data.category, 100),
    subcategory: readString(data.subcategory, 100),
    categoryManualKeywords: readString(data.categoryManualKeywords, 500),
    categoryTags: stringArray(data.categoryTags),
    priceLabel: readString(data.priceLabel, 100),
    primaryImageUrl: readString(data.primaryImageUrl, 2_048),
    primaryImageId: readString(data.primaryImageId, 1_500),
    imageCount: Number.isSafeInteger(data.imageCount) &&
        (data.imageCount as number) >= 0
      ? data.imageCount
      : 0,
    isActive: data.isActive !== false,
    mergedIntoDishId: readString(data.mergedIntoDishId, 1_500),
    createdAtMillis: timestampMillis(data.createdAt),
    updatedAtMillis: timestampMillis(data.updatedAt),
  });
}

function reviewBaseProjection(
  document: RatingAdminDocument,
): Readonly<Record<string, unknown>> | null {
  const data = document.data;
  const dishId = idFrom(data, "dishId");
  const restaurantId = idFrom(data, "restaurantId");
  const userId = idFrom(data, "userId");
  if (dishId === null || restaurantId === null || userId === null) {
    return null;
  }
  return Object.freeze({
    id: document.id,
    dishId,
    restaurantId,
    userId,
    headline: readString(data.headline, 500),
    notes: readString(data.notes, 2_000),
    overallImpression: numberOrZero(data.overallImpression),
    tastinessScore: readNumber(data.tastinessScore) ??
      readNumber(data.tasteScore),
    qualityScore: readNumber(data.qualityScore),
    valueScore: readNumber(data.valueScore),
    overallBiteScore: numberOrZero(data.overallBiteScore),
    createdAtMillis: timestampMillis(data.createdAt),
    updatedAtMillis: timestampMillis(data.updatedAt),
  });
}

async function enrichReviews(
  documents: readonly RatingAdminDocument[],
  database: RatingAdminPagingDatabase,
): Promise<readonly (Readonly<Record<string, unknown>> | null)[]> {
  const reviews = documents.map(reviewBaseProjection);
  const valid = reviews.filter(
    (review): review is Readonly<Record<string, unknown>> => review !== null,
  );
  const dishes = await documentsByPath(
    database,
    "bitescore_dishes",
    valid.map((review) => review.dishId as string),
  );
  const restaurants = await documentsByPath(
    database,
    "bitescore_restaurants",
    valid.map((review) => review.restaurantId as string),
  );
  const profiles = await documentsByPath(
    database,
    "public_reviewer_profiles",
    valid.map((review) => review.userId as string),
  );
  const byReviewId = new Map(
    valid.map((review) => [review.id as string, review]),
  );
  return documents.map((document) => {
    const review = byReviewId.get(document.id);
    if (review === undefined) {
      return null;
    }
    const dish = dishes.get(review.dishId as string);
    const restaurant = restaurants.get(review.restaurantId as string);
    return Object.freeze({
      kind: "reviews",
      ...review,
      dishName: readString(dish?.data.name, 100) ?? "Unknown dish",
      restaurantName: readString(restaurant?.data.name, 100) ??
        readString(restaurant?.data.restaurantName, 100) ??
        "Unknown restaurant",
      reviewerDisplayName: reviewerDisplayName(
        review.userId as string,
        profiles.get(review.userId as string),
      ),
    });
  });
}

function firestoreField(field: string): string | FieldPath {
  return field === "__name__" ? FieldPath.documentId() : field;
}

function applyFilters(
  query: Query<DocumentData, DocumentData>,
  filters: readonly RatingAdminFilter[],
): Query<DocumentData, DocumentData> {
  let result = query;
  for (const filter of filters) {
    result = result.where(
      firestoreField(filter.field),
      filter.operation,
      filter.value,
    );
  }
  return result;
}

export function createFirestoreRatingAdminPagingDatabase(
  firestore: Firestore,
): RatingAdminPagingDatabase {
  return {
    async queryDocuments(options) {
      let query = applyFilters(
        firestore.collection(options.collectionPath),
        options.filters,
      );
      for (const order of options.orders) {
        query = query.orderBy(firestoreField(order.field), order.direction);
      }
      if (options.cursor?.kind === "startAfter") {
        query = query.startAfter(...options.cursor.values);
      } else if (options.cursor?.kind === "endBefore") {
        query = query.endBefore(...options.cursor.values);
      }
      query = options.limitToLast === true
        ? query.limitToLast(options.limit)
        : query.limit(options.limit);
      const snapshot = await query.get();
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data() as Readonly<Record<string, unknown>>,
      }));
    },
    async countDocuments(options) {
      const query = applyFilters(
        firestore.collection(options.collectionPath),
        options.filters,
      );
      const snapshot = await query.count().get();
      return snapshot.data().count;
    },
    async getDocuments(paths) {
      if (paths.length === 0) {
        return [];
      }
      const snapshots = await firestore.getAll(...paths.map((path) => firestore.doc(path)));
      return snapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({
          id: snapshot.id,
          data: snapshot.data() as Readonly<Record<string, unknown>>,
        }));
    },
  };
}

function callableError(
  code: "invalid-argument" | "failed-precondition" | "permission-denied",
  message: string,
): never {
  throw new HttpsError(code, message);
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((field) => !Object.prototype.hasOwnProperty.call(value, field)) ||
    Object.keys(value).some((field) => !allowed.has(field))
  ) {
    callableError("invalid-argument", "The page criteria are invalid.");
  }
}

function requireString(
  value: unknown,
  maximumLength: number,
  message = "The page criteria are invalid.",
): string {
  if (typeof value !== "string") {
    callableError("invalid-argument", message);
  }
  const result = value.trim();
  if (!result || Array.from(result).length > maximumLength) {
    callableError("invalid-argument", message);
  }
  return result;
}

function requireDocumentId(value: unknown): string {
  const result = requireString(value, 1_500);
  if (result.includes("/")) {
    callableError("invalid-argument", "The document identity is invalid.");
  }
  return result;
}

function readString(value: unknown, maximumLength = 2_048): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const result = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return result && Array.from(result).length <= maximumLength ? result : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as { toMillis?: () => unknown };
    if (typeof candidate.toMillis === "function") {
      const result = candidate.toMillis();
      return typeof result === "number" && Number.isSafeInteger(result)
        ? result
        : null;
    }
  }
  return null;
}

function documentTimestamp(document: RatingAdminDocument, field: string): number {
  return timestampMillis(document.data[field]) ?? 0;
}

function callerBinding(uid: string): string {
  return createHash("sha256")
    .update(JSON.stringify(["ratingAdmin", uid]), "utf8")
    .digest("hex");
}

export function decodeRatingAdminCursorKey(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    callableError(
      "failed-precondition",
      "Rating Admin pagination is not configured.",
    );
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    callableError(
      "failed-precondition",
      "Rating Admin pagination is not configured.",
    );
  }
  return bytes;
}

export type RatingAdminHandlerContext = Readonly<{
  adminUid: string;
  cursorSecret: unknown;
  database: RatingAdminPagingDatabase;
  now?: () => number;
  nonceSource?: (size: number) => Uint8Array;
}>;

export type RatingAdminParsedPageContext = Readonly<{
  request: PagedRequest;
  codec: OpaqueCursorCodec;
  callerBinding: string;
  nowMs: number;
}>;

function parseContext(
  rawRequest: unknown,
  expectedPageSize: number,
  context: RatingAdminHandlerContext,
): RatingAdminParsedPageContext {
  let request: PagedRequest;
  try {
    request = parsePagedRequest(rawRequest, expectedPageSize);
  } catch {
    callableError("invalid-argument", "The page request is invalid.");
  }
  if (request.pageSize !== expectedPageSize) {
    callableError("invalid-argument", "The page size is invalid.");
  }
  const adminUid = requireDocumentId(context.adminUid);
  return {
    request,
    codec: new OpaqueCursorCodec({
      key: decodeRatingAdminCursorKey(context.cursorSecret),
      clock: context.now,
      nonceSource: context.nonceSource,
    }),
    callerBinding: callerBinding(adminUid),
    nowMs: context.now?.() ?? Date.now(),
  };
}

export type RatingAdminNormalizedNameCriteria = Readonly<{
  normalizedName: string | null;
  words: readonly string[];
  anchor: string | null;
  requiresPostFilter: boolean;
}>;

export function normalizeRatingAdminNameCriteria(
  value: unknown,
): RatingAdminNormalizedNameCriteria {
  if (value === undefined) {
    return {
      normalizedName: null,
      words: [],
      anchor: null,
      requiresPostFilter: false,
    };
  }
  const source = requireString(value, 100);
  let normalizedName: string;
  try {
    normalizedName = normalizeSearchName(source);
  } catch {
    callableError("invalid-argument", "The restaurant name is invalid.");
  }
  const words = normalizedName.split(" ");
  if (words.some((word) => Array.from(word).length < 2)) {
    callableError(
      "invalid-argument",
      "Restaurant name words must contain at least two characters.",
    );
  }
  const anchorWord = [...words].sort((first, second) =>
    second.length - first.length || first.localeCompare(second))[0];
  const anchor = Array.from(anchorWord)
    .slice(0, maximumWordPrefixLength)
    .join("");
  return {
    normalizedName,
    words: Object.freeze(words),
    anchor,
    requiresPostFilter:
      words.length > 1 || Array.from(anchorWord).length > maximumWordPrefixLength,
  };
}

export function matchesRatingAdminNameWords(
  data: Readonly<Record<string, unknown>>,
  criteria: RatingAdminNormalizedNameCriteria,
): boolean {
  if (criteria.words.length === 0) {
    return true;
  }
  const normalizedName = readString(data.normalizedName, 200);
  if (normalizedName === null) {
    return false;
  }
  const sourceWords = normalizedName.split(" ");
  return criteria.words.every((word) =>
    sourceWords.some((sourceWord) => sourceWord.startsWith(word)));
}

type SimplePageDefinition = Readonly<{
  source: string;
  searchMode: string;
  collectionPath: string;
  filters: readonly RatingAdminFilter[];
  orders: readonly RatingAdminOrder[];
  pageSize: number;
  fingerprintCriteria: Readonly<Record<string, unknown>>;
  cursorValues: (document: RatingAdminDocument) => readonly CursorSortValue[];
  queryCursorValues: (tuple: readonly CursorSortValue[]) => readonly unknown[];
  project: (document: RatingAdminDocument) => Readonly<Record<string, unknown>> | null;
  postFilter?: (document: RatingAdminDocument) => boolean;
  exactCount: boolean;
  enrich?: (
    documents: readonly RatingAdminDocument[],
  ) => Promise<readonly (Readonly<Record<string, unknown>> | null)[]>;
}>;

function pageNumberFromCursorTuple(tuple: readonly CursorSortValue[]): number {
  const value = tuple[tuple.length - 1];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }
  return value;
}

async function executeSimplePage(
  parsed: RatingAdminParsedPageContext,
  definition: SimplePageDefinition,
  database: RatingAdminPagingDatabase,
): Promise<Readonly<Record<string, unknown>>> {
  const queryFingerprint = createQueryFingerprint(definition.fingerprintCriteria);
  const direction = parsed.request.direction;
  let cursorTuple: readonly CursorSortValue[] | null = null;
  let currentPageNumber = 1;
  if (parsed.request.cursor !== undefined) {
    try {
      const decoded = parsed.codec.decode(parsed.request.cursor, {
        queryFingerprint,
        source: definition.source,
        searchMode: definition.searchMode,
        pageSize: definition.pageSize,
        callerBinding: parsed.callerBinding,
        purposes: [direction === "backward" ? "backward" : "forward"],
      });
      cursorTuple = decoded.sortTuple;
      currentPageNumber = pageNumberFromCursorTuple(cursorTuple);
    } catch {
      callableError("invalid-argument", "The page cursor is invalid or expired.");
    }
  }

  const totalValue = definition.exactCount
    ? await database.countDocuments({
        collectionPath: definition.collectionPath,
        filters: definition.filters,
      })
    : null;
  if (direction === "last") {
    if (totalValue === null) {
      callableError("invalid-argument", "Last-page navigation is unavailable.");
    }
    currentPageNumber = Math.max(1, Math.ceil(totalValue / definition.pageSize));
  }

  const exactLastPageSize = direction === "last" && totalValue !== null
    ? Math.max(1, totalValue % definition.pageSize || definition.pageSize)
    : null;
  const readLimit = exactLastPageSize ?? (definition.postFilter === undefined
    ? definition.pageSize + 1
    : ratingAdminPostFilterReadBudget);
  const queryCursor = cursorTuple === null
    ? undefined
    : {
        kind: direction === "backward" ? "endBefore" as const : "startAfter" as const,
        values: definition.queryCursorValues(cursorTuple),
      };
  const rawDocuments = await database.queryDocuments({
    collectionPath: definition.collectionPath,
    filters: definition.filters,
    orders: definition.orders,
    ...(queryCursor === undefined ? {} : { cursor: queryCursor }),
    limit: readLimit,
    ...(direction === "backward" || direction === "last"
      ? { limitToLast: true }
      : {}),
  });
  const matching = definition.postFilter === undefined
    ? rawDocuments
    : rawDocuments.filter(definition.postFilter);
  const selected = direction === "backward" || direction === "last"
    ? matching.slice(Math.max(0, matching.length - definition.pageSize))
    : matching.slice(0, definition.pageSize);

  let projected: readonly (Readonly<Record<string, unknown>> | null)[];
  if (definition.enrich !== undefined) {
    projected = await definition.enrich(selected);
  } else {
    projected = selected.map(definition.project);
  }
  const items = projected.filter(
    (item): item is Readonly<Record<string, unknown>> => item !== null,
  );

  const forwardBudgetExhausted = definition.postFilter !== undefined &&
    rawDocuments.length === readLimit;
  const hasNext = direction === "backward"
    ? true
    : direction === "last"
      ? false
      : matching.length > definition.pageSize ||
        forwardBudgetExhausted;
  const hasPrevious = currentPageNumber > 1;
  const firstSelected = selected[0];
  const firstRaw = rawDocuments[0];
  const lastSelected = selected[selected.length - 1];
  const lastRaw = rawDocuments[rawDocuments.length - 1];
  const nextAnchor = forwardBudgetExhausted && matching.length <= definition.pageSize
    ? lastRaw
    : lastSelected ?? lastRaw;
  const nextCursor = hasNext && nextAnchor !== undefined
    ? parsed.codec.encode({
        queryFingerprint,
        source: definition.source,
        searchMode: definition.searchMode,
        pageSize: definition.pageSize,
        purpose: "forward",
        sortTuple: [
          ...definition.cursorValues(nextAnchor),
          currentPageNumber + 1,
        ],
        callerBinding: parsed.callerBinding,
      })
    : undefined;
  const previousAnchor = definition.postFilter === undefined
    ? firstSelected
    : firstRaw;
  const previousCursor = hasPrevious && previousAnchor !== undefined
    ? parsed.codec.encode({
        queryFingerprint,
        source: definition.source,
        searchMode: definition.searchMode,
        pageSize: definition.pageSize,
        purpose: "backward",
        sortTuple: [
          ...definition.cursorValues(previousAnchor),
          currentPageNumber - 1,
        ],
        callerBinding: parsed.callerBinding,
      })
    : undefined;

  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    items,
    pageSize: definition.pageSize,
    hasNext,
    hasPrevious,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(previousCursor === undefined ? {} : { previousCursor }),
    currentPageNumber,
    total: totalValue === null
      ? { state: "unknown" as const }
      : { state: "exact" as const, value: totalValue },
    queryFingerprint,
    snapshotTimestampMs: parsed.nowMs,
    capabilities: {
      first: currentPageNumber > 1,
      previous: hasPrevious,
      numberedVisitedPages: true,
      next: hasNext,
      last: totalValue !== null && currentPageNumber < Math.max(
        1,
        Math.ceil(totalValue / definition.pageSize),
      ),
    },
  });
}

type QueueDefinition = Readonly<{
  collectionPath: string;
  statusField: string;
  statusValue: string;
}>;

function queueDefinition(kind: RatingAdminQueueKind): QueueDefinition {
  switch (kind) {
    case "reportedReviews":
      return {
        collectionPath: "review_reports",
        statusField: "status",
        statusValue: "pending",
      };
    case "restaurantReports":
      return {
        collectionPath: "restaurant_reports",
        statusField: "status",
        statusValue: "pending",
      };
    case "dishReports":
      return {
        collectionPath: "dish_reports",
        statusField: "status",
        statusValue: "pending",
      };
    case "duplicateRestaurantReports":
      return {
        collectionPath: "duplicate_restaurant_reports",
        statusField: "status",
        statusValue: "pending",
      };
    case "claims":
      return {
        collectionPath: "restaurant_claim_requests",
        statusField: "status",
        statusValue: "pending",
      };
  }
}

function parseQueueKind(value: unknown): RatingAdminQueueKind {
  if (
    value !== "reportedReviews" &&
    value !== "restaurantReports" &&
    value !== "dishReports" &&
    value !== "duplicateRestaurantReports" &&
    value !== "claims"
  ) {
    callableError("invalid-argument", "The Rating Admin queue kind is invalid.");
  }
  return value;
}

async function enrichQueue(
  kind: RatingAdminQueueKind,
  documents: readonly RatingAdminDocument[],
  database: RatingAdminPagingDatabase,
): Promise<readonly (Readonly<Record<string, unknown>> | null)[]> {
  if (kind === "reportedReviews") {
    const reviewIds = documents.map(
      (document) => idFrom(document.data, "reviewId") ?? "",
    );
    const reviews = await documentsByPath(database, "dish_reviews", reviewIds);
    const reviewDocuments = documents
      .map((document) =>
        reviews.get(idFrom(document.data, "reviewId") ?? ""))
      .filter(
        (document): document is RatingAdminDocument => document !== undefined,
      );
    const reviewBases = reviewDocuments.map(reviewBaseProjection).filter(
      (review): review is Readonly<Record<string, unknown>> => review !== null,
    );
    const dishes = await documentsByPath(
      database,
      "bitescore_dishes",
      reviewBases.map((review) => review.dishId as string),
    );
    const restaurants = await documentsByPath(
      database,
      "bitescore_restaurants",
      reviewBases.map((review) => review.restaurantId as string),
    );
    const profiles = await documentsByPath(
      database,
      "public_reviewer_profiles",
      reviewBases.map((review) => review.userId as string),
    );
    const basesById = new Map(
      reviewBases.map((review) => [review.id as string, review]),
    );
    return documents.map((report) => {
      const data = report.data;
      const reviewId = idFrom(data, "reviewId");
      const review = reviewId === null ? undefined : basesById.get(reviewId);
      if (review === undefined) {
        return null;
      }
      const userId = review.userId as string;
      return Object.freeze({
        kind,
        id: report.id,
        reportId: report.id,
        reviewId,
        reportDishId: idFrom(data, "dishId") ?? "",
        reportRestaurantId: idFrom(data, "restaurantId") ?? "",
        reportingUserId: idFrom(data, "reportingUserId") ?? "",
        reason: readString(data.reason, 2_000),
        status: readString(data.status, 64) ?? "pending",
        reportCreatedAtMillis: timestampMillis(data.createdAt),
        reportUpdatedAtMillis: timestampMillis(data.updatedAt),
        review,
        dishName: readString(
          dishes.get(review.dishId as string)?.data.name,
          100,
        ) ?? "Unknown dish",
        restaurantName: readString(
          restaurants.get(review.restaurantId as string)?.data.name,
          100,
        ) ?? "Unknown restaurant",
        reviewerDisplayName: reviewerDisplayName(userId, profiles.get(userId)),
      });
    });
  }

  if (kind === "restaurantReports" ||
      kind === "duplicateRestaurantReports") {
    const restaurantIds = documents.map(
      (document) => idFrom(document.data, "restaurantId") ?? "",
    );
    const restaurants = await documentsByPath(
      database,
      "bitescore_restaurants",
      restaurantIds,
    );
    return documents.map((report) => {
      const data = report.data;
      const restaurantId = idFrom(data, "restaurantId");
      const restaurant = restaurantId === null
        ? undefined
        : restaurants.get(restaurantId);
      const projectedRestaurant = restaurant === undefined
        ? null
        : restaurantSourceProjection(restaurant);
      if (restaurantId === null || projectedRestaurant === null) {
        return null;
      }
      return Object.freeze({
        kind,
        id: report.id,
        reportId: report.id,
        restaurantId,
        restaurantName: readString(data.restaurantName, 100) ??
          projectedRestaurant.name,
        reportingUserId: idFrom(data, "reportingUserId") ?? "",
        reason: readString(data.reason, 2_000),
        status: readString(data.status, 64) ?? "pending",
        createdAtMillis: timestampMillis(data.createdAt),
        updatedAtMillis: timestampMillis(data.updatedAt),
        restaurant: projectedRestaurant,
      });
    });
  }

  if (kind === "dishReports") {
    const dishIds = documents.map(
      (document) => idFrom(document.data, "dishId") ?? "",
    );
    const dishes = await documentsByPath(database, "bitescore_dishes", dishIds);
    const restaurantIds = [...dishes.values()]
      .map((dish) => idFrom(dish.data, "restaurantId") ?? "");
    const restaurants = await documentsByPath(
      database,
      "bitescore_restaurants",
      restaurantIds,
    );
    return documents.map((report) => {
      const data = report.data;
      const dishId = idFrom(data, "dishId");
      const dish = dishId === null ? undefined : dishes.get(dishId);
      if (dish === undefined) {
        return null;
      }
      const restaurantId = idFrom(dish.data, "restaurantId") ??
        idFrom(data, "restaurantId");
      if (restaurantId === null) {
        return null;
      }
      const projectedDish = dishProjection(dish, restaurantId, "all");
      const restaurant = restaurants.get(restaurantId);
      const projectedRestaurant = restaurant === undefined
        ? null
        : restaurantSourceProjection(restaurant);
      if (projectedDish === null) {
        return null;
      }
      return Object.freeze({
        kind,
        id: report.id,
        reportId: report.id,
        dishId,
        dishName: readString(data.dishName, 100) ?? projectedDish.name,
        restaurantId,
        reportingUserId: idFrom(data, "reportingUserId") ?? "",
        reason: readString(data.reason, 2_000),
        status: readString(data.status, 64) ?? "pending",
        createdAtMillis: timestampMillis(data.createdAt),
        updatedAtMillis: timestampMillis(data.updatedAt),
        dish: projectedDish,
        restaurant: projectedRestaurant,
      });
    });
  }

  const restaurantIds = documents.map(
    (document) => idFrom(document.data, "restaurantId") ?? "",
  );
  const restaurants = await documentsByPath(
    database,
    "bitescore_restaurants",
    restaurantIds,
  );
  return documents.map((claim) => {
    const data = claim.data;
    const restaurantId = idFrom(data, "restaurantId");
    if (restaurantId === null) {
      return null;
    }
    const restaurant = restaurants.get(restaurantId);
    return Object.freeze({
      kind,
      id: claim.id,
      claimId: claim.id,
      restaurantId,
      restaurantName: readString(data.restaurantName, 100) ?? "",
      requesterUserId: idFrom(data, "requesterUserId"),
      claimantName: readString(data.claimantName, 200) ?? "",
      email: readString(data.email, 320) ?? "",
      phone: readString(data.phone, 100) ?? "",
      message: readString(data.message, 2_000),
      status: readString(data.status, 64) ?? "pending",
      createdAtMillis: timestampMillis(data.createdAt),
      updatedAtMillis: timestampMillis(data.updatedAt),
      restaurant: restaurant === undefined
        ? null
        : restaurantSourceProjection(restaurant),
    });
  });
}

export async function listRatingAdminQueuePageHandler(
  rawRequest: unknown,
  context: RatingAdminHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseContext(rawRequest, ratingAdminQueuePageSize, context);
  requireExactKeys(parsed.request.criteria, ["queueKind"]);
  const queueKind = parseQueueKind(parsed.request.criteria.queueKind);
  const definition = queueDefinition(queueKind);
  return executeSimplePage(parsed, {
    source: "ratingAdminQueue",
    searchMode: queueKind,
    collectionPath: definition.collectionPath,
    filters: [{
      field: definition.statusField,
      operation: "==",
      value: definition.statusValue,
    }],
    orders: [
      { field: "createdAt", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    pageSize: ratingAdminQueuePageSize,
    fingerprintCriteria: { queueKind },
    cursorValues: (document) => [
      documentTimestamp(document, "createdAt"),
      document.id,
    ],
    queryCursorValues: (tuple) => [new Date(tuple[0] as number), tuple[1]],
    project: () => null,
    exactCount: true,
    enrich: (page) => enrichQueue(queueKind, page, context.database),
  }, context.database);
}

function parseDirectoryKind(value: unknown): RatingAdminDirectoryKind {
  if (
    value !== "dishesByRestaurant" &&
    value !== "reviews" &&
    value !== "claimedRestaurants"
  ) {
    callableError(
      "invalid-argument",
      "The Rating Admin directory kind is invalid.",
    );
  }
  return value;
}

export async function listRatingAdminDirectoryPageHandler(
  rawRequest: unknown,
  context: RatingAdminHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseContext(
    rawRequest,
    ratingAdminDirectoryPageSize,
    context,
  );
  const kind = parseDirectoryKind(parsed.request.criteria.directoryKind);
  if (kind === "reviews") {
    requireExactKeys(parsed.request.criteria, ["directoryKind"]);
    return executeSimplePage(parsed, {
      source: "ratingAdminDirectory",
      searchMode: kind,
      collectionPath: "dish_reviews",
      filters: [],
      orders: [
        { field: "createdAt", direction: "desc" },
        { field: "__name__", direction: "desc" },
      ],
      pageSize: ratingAdminDirectoryPageSize,
      fingerprintCriteria: { directoryKind: kind },
      cursorValues: (document) => [
        documentTimestamp(document, "createdAt"),
        document.id,
      ],
      queryCursorValues: (tuple) => [new Date(tuple[0] as number), tuple[1]],
      project: () => null,
      exactCount: true,
      enrich: (page) => enrichReviews(page, context.database),
    }, context.database);
  }

  if (kind === "dishesByRestaurant") {
    requireExactKeys(
      parsed.request.criteria,
      ["directoryKind", "restaurantId", "status"],
      ["dishName"],
    );
    const restaurantId = requireDocumentId(
      parsed.request.criteria.restaurantId,
    );
    const status = requireStatus(parsed.request.criteria.status);
    const nameCriteria = normalizeRatingAdminNameCriteria(
      parsed.request.criteria.dishName,
    );
    const filters: RatingAdminFilter[] = [
      { field: "source", operation: "==", value: "biteScore" },
      { field: "adminVisible", operation: "==", value: true },
      {
        field: "restaurantSourceDocumentId",
        operation: "==",
        value: restaurantId,
      },
    ];
    if (status !== "all") {
      filters.push({
        field: "dishActive",
        operation: "==",
        value: status === "active",
      });
    }
    if (nameCriteria.anchor !== null) {
      filters.push({
        field: "namePrefixTokens",
        operation: "array-contains",
        value: nameCriteria.anchor,
      });
    }
    return executeSimplePage(parsed, {
      source: "ratingAdminDirectory",
      searchMode: kind,
      collectionPath: "dish_search_index",
      filters,
      orders: [
        { field: "normalizedName", direction: "asc" },
        { field: "sourceDocumentId", direction: "asc" },
      ],
      pageSize: ratingAdminDirectoryPageSize,
      fingerprintCriteria: {
        directoryKind: kind,
        restaurantId,
        status,
        ...(nameCriteria.normalizedName === null
          ? {}
          : { dishName: nameCriteria.normalizedName }),
      },
      cursorValues: (document) => [
        readString(document.data.normalizedName, 200) ?? "",
        readString(document.data.sourceDocumentId, 1_500) ?? "",
      ],
      queryCursorValues: (tuple) => [tuple[0], tuple[1]],
      project: () => null,
      ...(nameCriteria.requiresPostFilter
        ? {
            postFilter: (document: RatingAdminDocument) =>
              matchesRatingAdminNameWords(document.data, nameCriteria),
          }
        : {}),
      exactCount: status === "active" && !nameCriteria.requiresPostFilter,
      enrich: async (page) => {
        const sourceIds = page.map(
          (document) => idFrom(document.data, "sourceDocumentId") ?? "",
        );
        const sources = await documentsByPath(
          context.database,
          "bitescore_dishes",
          sourceIds,
        );
        return sourceIds.map((id) => {
          const source = sources.get(id);
          return source === undefined
            ? null
            : dishProjection(source, restaurantId, status);
        });
      },
    }, context.database);
  }

  requireExactKeys(
    parsed.request.criteria,
    ["directoryKind"],
    ["restaurantName"],
  );
  const nameCriteria = normalizeRatingAdminNameCriteria(
    parsed.request.criteria.restaurantName,
  );
  const filters: RatingAdminFilter[] = [
    { field: "source", operation: "==", value: "biteScore" },
    { field: "adminDirectoryVisible", operation: "==", value: true },
    { field: "isClaimed", operation: "==", value: true },
  ];
  if (nameCriteria.anchor !== null) {
    filters.push({
      field: "namePrefixTokens",
      operation: "array-contains",
      value: nameCriteria.anchor,
    });
  }
  return executeSimplePage(parsed, {
    source: "ratingAdminDirectory",
    searchMode: kind,
    collectionPath: "restaurant_search_index",
    filters,
    orders: [
      { field: "normalizedName", direction: "asc" },
      { field: "sourceDocumentId", direction: "asc" },
    ],
    pageSize: ratingAdminDirectoryPageSize,
    fingerprintCriteria: {
      directoryKind: kind,
      ...(nameCriteria.normalizedName === null
        ? {}
        : { restaurantName: nameCriteria.normalizedName }),
    },
    cursorValues: (document) => [
      readString(document.data.normalizedName, 200) ?? "",
      readString(document.data.sourceDocumentId, 1_500) ?? "",
    ],
    queryCursorValues: (tuple) => [tuple[0], tuple[1]],
    project: () => null,
    ...(nameCriteria.requiresPostFilter
      ? {
          postFilter: (document: RatingAdminDocument) =>
            matchesRatingAdminNameWords(document.data, nameCriteria),
        }
      : {}),
    exactCount: !nameCriteria.requiresPostFilter,
    enrich: async (page) => {
      const sourceIds = page.map(
        (document) => idFrom(document.data, "sourceDocumentId") ?? "",
      );
      const sources = await documentsByPath(
        context.database,
        "bitescore_restaurants",
        sourceIds,
      );
      return Promise.all(sourceIds.map(async (id) => {
        const source = sources.get(id);
        const restaurant = source === undefined
          ? null
          : restaurantSourceProjection(source);
        if (restaurant === null || restaurant.isClaimed !== true) {
          return null;
        }
        const claims = await context.database.queryDocuments({
          collectionPath: "restaurant_claim_requests",
          filters: [
            { field: "restaurantId", operation: "==", value: id },
            { field: "status", operation: "==", value: "approved" },
          ],
          orders: [
            { field: "updatedAt", direction: "desc" },
            { field: "__name__", direction: "desc" },
          ],
          limit: 1,
        });
        const claim = claims[0];
        return Object.freeze({
          kind,
          id,
          restaurant,
          approvedClaim: claim === undefined
            ? null
            : {
                id: claim.id,
                restaurantId: idFrom(claim.data, "restaurantId") ?? id,
                restaurantName:
                  readString(claim.data.restaurantName, 100) ??
                  restaurant.name,
                requesterUserId: idFrom(claim.data, "requesterUserId"),
                claimantName: readString(claim.data.claimantName, 200) ?? "",
                email: readString(claim.data.email, 320) ?? "",
                phone: readString(claim.data.phone, 100) ?? "",
                message: readString(claim.data.message, 2_000),
                status: readString(claim.data.status, 64) ?? "approved",
                createdAtMillis: timestampMillis(claim.data.createdAt),
                updatedAtMillis: timestampMillis(claim.data.updatedAt),
              },
        });
      }));
    },
  }, context.database);
}

function inviteProjection(
  document: RatingAdminDocument,
): Readonly<Record<string, unknown>> {
  const data = document.data;
  return Object.freeze({
    id: document.id,
    type: readString(data.type, 100) ?? "",
    side: "bitescore",
    status: readString(data.status, 64) ?? "",
    restaurantId: readString(data.restaurantId, 1_500) ?? "",
    pendingRestaurantKey: readString(data.pendingRestaurantKey, 1_500) ?? "",
    restaurantName: readString(data.restaurantName, 100) ?? "",
    createdByEmail: readString(data.createdByEmail, 320) ?? "",
    createdAtMillis: timestampMillis(data.createdAt),
    expiresAtMillis: timestampMillis(data.expiresAt),
    usedAtMillis: timestampMillis(data.usedAt),
    revokedAtMillis: timestampMillis(data.revokedAt),
    maxUses: Number.isSafeInteger(data.maxUses) ? data.maxUses : 1,
    useCount: Number.isSafeInteger(data.useCount) ? data.useCount : 0,
  });
}

export async function listRatingAdminInviteHistoryPageHandler(
  rawRequest: unknown,
  context: RatingAdminHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseContext(rawRequest, ratingAdminInvitePageSize, context);
  requireExactKeys(parsed.request.criteria, ["side"]);
  if (parsed.request.criteria.side !== "bitescore") {
    callableError("invalid-argument", "The invite side is invalid.");
  }
  const filters: readonly RatingAdminFilter[] = [
    { field: "side", operation: "==", value: "bitescore" },
  ];
  return executeSimplePage(parsed, {
    source: "ratingAdminInvites",
    searchMode: "bitescoreInvites",
    collectionPath: "restaurant_invites",
    filters,
    orders: [
      { field: "createdAt", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    pageSize: ratingAdminInvitePageSize,
    fingerprintCriteria: { side: "bitescore" },
    cursorValues: (document) => [
      documentTimestamp(document, "createdAt"),
      document.id,
    ],
    queryCursorValues: (tuple) => [new Date(tuple[0] as number), tuple[1]],
    project: inviteProjection,
    exactCount: true,
  }, context.database);
}

type ExactRestaurantCriteria = Readonly<{
  mode: "exactZip" | "exactCity";
  zip5?: string;
  cityStateKey?: string;
  status: RatingAdminStatus;
  restaurantName: RatingAdminNormalizedNameCriteria;
}>;

function parseExactRestaurantCriteria(
  criteria: Readonly<Record<string, unknown>>,
): ExactRestaurantCriteria {
  const mode = criteria.mode;
  if (mode === "exactZip") {
    requireExactKeys(
      criteria as Record<string, unknown>,
      ["mode", "zipCode", "status"],
      ["restaurantName"],
    );
    let zip5: string;
    try {
      zip5 = normalizeZip5(criteria.zipCode);
    } catch {
      callableError("invalid-argument", "The ZIP code is invalid.");
    }
    return {
      mode,
      zip5,
      status: requireStatus(criteria.status),
      restaurantName: normalizeRatingAdminNameCriteria(
        criteria.restaurantName,
      ),
    };
  }
  if (mode === "exactCity") {
    requireExactKeys(
      criteria as Record<string, unknown>,
      ["mode", "city", "state", "status"],
      ["restaurantName"],
    );
    let cityStateKey: string;
    try {
      normalizeStateCode(criteria.state);
      cityStateKey = buildCityStateKey(criteria.city, criteria.state);
    } catch {
      callableError(
        "invalid-argument",
        "City and a two-letter state are required.",
      );
    }
    return {
      mode,
      cityStateKey,
      status: requireStatus(criteria.status),
      restaurantName: normalizeRatingAdminNameCriteria(
        criteria.restaurantName,
      ),
    };
  }
  callableError("invalid-argument", "The restaurant search mode is invalid.");
}

export async function searchRatingAdminExactRestaurantsPage(
  parsed: RatingAdminParsedPageContext,
  context: RatingAdminHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const criteria = parseExactRestaurantCriteria(parsed.request.criteria);
  const filters: RatingAdminFilter[] = [
    { field: "source", operation: "==", value: "biteScore" },
    { field: "adminDirectoryVisible", operation: "==", value: true },
    criteria.mode === "exactZip"
      ? { field: "zip5", operation: "==", value: criteria.zip5 }
      : {
          field: "cityStateKey",
          operation: "==",
          value: criteria.cityStateKey,
        },
  ];
  if (criteria.status !== "all") {
    filters.push({
      field: "isActive",
      operation: "==",
      value: criteria.status === "active",
    });
  }
  if (criteria.restaurantName.anchor !== null) {
    filters.push({
      field: "namePrefixTokens",
      operation: "array-contains",
      value: criteria.restaurantName.anchor,
    });
  }
  const fingerprintCriteria = Object.freeze({
    mode: criteria.mode,
    status: criteria.status,
    ...(criteria.zip5 === undefined ? {} : { zip5: criteria.zip5 }),
    ...(criteria.cityStateKey === undefined
      ? {}
      : { cityStateKey: criteria.cityStateKey }),
    ...(criteria.restaurantName.normalizedName === null
      ? {}
      : { restaurantName: criteria.restaurantName.normalizedName }),
  });
  return executeSimplePage(parsed, {
    source: "ratingAdminRestaurants",
    searchMode: criteria.mode,
    collectionPath: "restaurant_search_index",
    filters,
    orders: [
      { field: "normalizedName", direction: "asc" },
      { field: "sourceDocumentId", direction: "asc" },
    ],
    pageSize: ratingAdminRestaurantPageSize,
    fingerprintCriteria,
    cursorValues: (document) => [
      readString(document.data.normalizedName, 200) ?? "",
      readString(document.data.sourceDocumentId, 1_500) ?? "",
    ],
    queryCursorValues: (tuple) => [tuple[0], tuple[1]],
    project: () => null,
    ...(criteria.restaurantName.requiresPostFilter
      ? {
          postFilter: (document: RatingAdminDocument) =>
            matchesRatingAdminNameWords(
              document.data,
              criteria.restaurantName,
            ),
        }
      : {}),
    exactCount: !criteria.restaurantName.requiresPostFilter,
    enrich: async (page) => {
      const sourceIds = page.map(
        (document) => idFrom(document.data, "sourceDocumentId") ?? "",
      );
      const sources = await documentsByPath(
        context.database,
        "bitescore_restaurants",
        sourceIds,
      );
      return sourceIds.map((id) => {
        const document = sources.get(id);
        return document === undefined
          ? null
          : ratingAdminRestaurantProjection(
              document,
              null,
              criteria.status,
            );
      });
    },
  }, context.database);
}

export function createRatingAdminParsedRestaurantContext(
  rawRequest: unknown,
  context: RatingAdminHandlerContext,
): RatingAdminParsedPageContext {
  return parseContext(rawRequest, ratingAdminRestaurantPageSize, context);
}
