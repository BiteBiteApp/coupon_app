import { createHash } from "node:crypto";
import { FieldPath, type DocumentData, type Firestore, type Query } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  adminUserClaimedRestaurantCollection,
  adminUserClaimedRestaurantVersion,
  adminUserDirectoryCollection,
  adminUserDirectoryVersion,
} from "./admin_user_directory_contract.js";
import {
  normalizeAdminUserEmail,
  normalizeAdminUserPhone,
} from "./admin_user_directory_builders.js";
import { OpaqueCursorCodec, type CursorSortValue } from "./opaque_cursor.js";
import {
  adminDirectoryDefaultPageSize,
  pageProtocolVersion,
  parsePagedRequest,
  type PagedRequest,
} from "./pagination_protocol.js";
import { createQueryFingerprint } from "./query_fingerprint.js";
import {
  maximumWordPrefixLength,
  normalizeSearchName,
} from "./search_normalization.js";

export const ratingAdminPeoplePageSize = adminDirectoryDefaultPageSize;
export const ratingAdminPeoplePostFilterReadBudget = 500;
export const ratingAdminClaimedPreviewLimit = 6;
export const ratingAdminClaimedPreviewDisplayLimit = 5;
export const ratingAdminPeopleCursorSecretName =
  "SEARCH_PAGINATION_CURSOR_KEY";
export const contributionPointLedgerCollection =
  "bitescore_contribution_point_ledger";

export type RatingAdminPeopleDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type RatingAdminPeopleFilter = Readonly<{
  field: string;
  operation: "==" | "array-contains";
  value: unknown;
}>;

export type RatingAdminPeopleOrder = Readonly<{
  field: string;
  direction: "asc" | "desc";
}>;

export type RatingAdminPeopleQuery = Readonly<{
  collectionPath: string;
  filters: readonly RatingAdminPeopleFilter[];
  orders: readonly RatingAdminPeopleOrder[];
  cursor?: Readonly<{
    kind: "startAfter" | "endBefore";
    values: readonly unknown[];
  }>;
  limit: number;
  limitToLast?: boolean;
}>;

export interface RatingAdminPeoplePagingDatabase {
  queryDocuments(
    query: RatingAdminPeopleQuery,
  ): Promise<readonly RatingAdminPeopleDocument[]>;
  countDocuments(value: {
    collectionPath: string;
    filters: readonly RatingAdminPeopleFilter[];
  }): Promise<number>;
  getDocuments(
    paths: readonly string[],
  ): Promise<readonly RatingAdminPeopleDocument[]>;
}

export function createFirestoreRatingAdminPeoplePagingDatabase(
  firestore: Firestore,
): RatingAdminPeoplePagingDatabase {
  const field = (value: string): string | FieldPath =>
    value === "__name__" ? FieldPath.documentId() : value;
  const filters = (
    source: Query<DocumentData, DocumentData>,
    values: readonly RatingAdminPeopleFilter[],
  ): Query<DocumentData, DocumentData> => {
    let result = source;
    for (const value of values) {
      result = result.where(field(value.field), value.operation, value.value);
    }
    return result;
  };
  return {
    async queryDocuments(options) {
      let query = filters(
        firestore.collection(options.collectionPath),
        options.filters,
      );
      for (const order of options.orders) {
        query = query.orderBy(field(order.field), order.direction);
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
      const snapshot = await filters(
        firestore.collection(options.collectionPath),
        options.filters,
      ).count().get();
      return snapshot.data().count;
    },
    async getDocuments(paths) {
      if (paths.length === 0) return [];
      const snapshots = await firestore.getAll(
        ...paths.map((path) => firestore.doc(path)),
      );
      return snapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({
          id: snapshot.id,
          data: snapshot.data() as Readonly<Record<string, unknown>>,
        }));
    },
  };
}

export type RatingAdminPeopleHandlerContext = Readonly<{
  adminUid: string;
  cursorSecret: unknown;
  database: RatingAdminPeoplePagingDatabase;
  now?: () => number;
  nonceSource?: (size: number) => Uint8Array;
}>;

type ParsedContext = Readonly<{
  request: PagedRequest;
  codec: OpaqueCursorCodec;
  callerBinding: string;
  nowMs: number;
}>;

type UserSearchMode =
  | "viewAll"
  | "displayName"
  | "uid"
  | "email"
  | "phone"
  | "claimedRestaurant";

type UserPointsSort =
  | "mostPoints"
  | "fewestPoints"
  | "displayNameAz"
  | "mostRecentActivity";

type NameCriteria = Readonly<{
  normalized: string;
  words: readonly string[];
  anchor: string;
  requiresPostFilter: boolean;
}>;

type ClaimedBoundary = readonly [
  string | null,
  string | null,
  string | null,
];

type ClaimedCollectCursorState = Readonly<{
  phase: "collect";
  rawBoundary: ClaimedBoundary;
  logicalStartOwner: string | null;
  previousStartOwner: string | null;
  twoBackStartOwner: string | null;
  targetPageNumber: number;
  visiblePageNumber: number;
}>;

type ClaimedLookaheadCursorState = Readonly<{
  phase: "lookahead";
  rawBoundary: ClaimedBoundary;
  pageLastOwner: string;
  logicalStartOwner: string | null;
  previousStartOwner: string | null;
  targetPageNumber: number;
  visiblePageNumber: number;
}>;

type ClaimedCursorState =
  | ClaimedCollectCursorState
  | ClaimedLookaheadCursorState;

const claimedCollectCursorSession = "ratingAdminClaimedCollect";
const claimedLookaheadCursorSession = "ratingAdminClaimedLookahead";

type OrderedDefinition = Readonly<{
  source: string;
  searchMode: string;
  collectionPath: string;
  filters: readonly RatingAdminPeopleFilter[];
  orders: readonly RatingAdminPeopleOrder[];
  fingerprintCriteria: Readonly<Record<string, unknown>>;
  cursorValues: (
    document: RatingAdminPeopleDocument,
  ) => readonly CursorSortValue[];
  queryCursorValues: (
    tuple: readonly CursorSortValue[],
  ) => readonly unknown[];
  project: (
    document: RatingAdminPeopleDocument,
  ) => Readonly<Record<string, unknown>>;
  enrich?: (
    documents: readonly RatingAdminPeopleDocument[],
  ) => Promise<readonly Readonly<Record<string, unknown>>[]>;
}>;

function callableError(
  code: "invalid-argument" | "failed-precondition",
  message: string,
): never {
  throw new HttpsError(code, message);
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    callableError("invalid-argument", "The page criteria are invalid.");
  }
}

function requireString(
  value: unknown,
  maximumLength: number,
  message = "The page criteria are invalid.",
): string {
  if (typeof value !== "string") callableError("invalid-argument", message);
  const result = value.trim();
  if (!result || Array.from(result).length > maximumLength) {
    callableError("invalid-argument", message);
  }
  return result;
}

function requireDocumentId(value: unknown): string {
  const result = requireString(
    value,
    1_500,
    "The document identity is invalid.",
  );
  if (result.includes("/")) {
    callableError("invalid-argument", "The document identity is invalid.");
  }
  return result;
}

function readString(value: unknown, maximumLength = 2_048): string | null {
  if (typeof value !== "string") return null;
  const result = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return result && Array.from(result).length <= maximumLength ? result : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
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

function cursorKey(value: unknown): Uint8Array {
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

function parseContext(
  rawRequest: unknown,
  context: RatingAdminPeopleHandlerContext,
): ParsedContext {
  let request: PagedRequest;
  try {
    request = parsePagedRequest(rawRequest, ratingAdminPeoplePageSize);
  } catch {
    callableError("invalid-argument", "The page request is invalid.");
  }
  if (request.pageSize !== ratingAdminPeoplePageSize) {
    callableError("invalid-argument", "The page size is invalid.");
  }
  const adminUid = requireDocumentId(context.adminUid);
  const key = cursorKey(context.cursorSecret);
  return {
    request,
    codec: new OpaqueCursorCodec({
      key,
      clock: context.now,
      nonceSource: context.nonceSource,
    }),
    callerBinding: createHash("sha256")
      .update(JSON.stringify(["ratingAdminPeople", adminUid]), "utf8")
      .digest("hex"),
    nowMs: context.now?.() ?? Date.now(),
  };
}

function pageNumber(tuple: readonly CursorSortValue[]): number {
  const value = tuple[tuple.length - 1];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }
  return value;
}

function decodeCursor(
  parsed: ParsedContext,
  value: {
    queryFingerprint: string;
    source: string;
    searchMode: string;
    tupleLength: number;
  },
): readonly CursorSortValue[] | null {
  if (parsed.request.cursor === undefined) return null;
  try {
    const decoded = parsed.codec.decode(parsed.request.cursor, {
      queryFingerprint: value.queryFingerprint,
      source: value.source,
      searchMode: value.searchMode,
      pageSize: ratingAdminPeoplePageSize,
      callerBinding: parsed.callerBinding,
      purposes: [
        parsed.request.direction === "backward" ? "backward" : "forward",
      ],
    });
    if (decoded.sortTuple.length !== value.tupleLength) throw new Error();
    return decoded.sortTuple;
  } catch {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }
}

function response(value: {
  parsed: ParsedContext;
  items: readonly Readonly<Record<string, unknown>>[];
  queryFingerprint: string;
  currentPageNumber: number;
  total: Readonly<Record<string, unknown>>;
  hasNext: boolean;
  hasPrevious: boolean;
  nextCursor?: string;
  previousCursor?: string;
  allowLast: boolean;
  preparation?: Readonly<{
    state: "preparing" | "ready" | "failed";
    completedUnits: number;
    message?: string;
  }>;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    items: value.items,
    pageSize: ratingAdminPeoplePageSize,
    hasNext: value.hasNext,
    hasPrevious: value.hasPrevious,
    ...(value.nextCursor === undefined ? {} : { nextCursor: value.nextCursor }),
    ...(value.previousCursor === undefined
      ? {}
      : { previousCursor: value.previousCursor }),
    currentPageNumber: value.currentPageNumber,
    total: value.total,
    queryFingerprint: value.queryFingerprint,
    snapshotTimestampMs: value.parsed.nowMs,
    capabilities: {
      first: value.currentPageNumber > 1,
      previous: value.hasPrevious,
      numberedVisitedPages: true,
      next: value.hasNext,
      last: value.allowLast && value.hasNext,
    },
    ...(value.preparation === undefined
      ? {}
      : { preparation: value.preparation }),
  });
}

function encodeBoundary(value: {
  parsed: ParsedContext;
  queryFingerprint: string;
  source: string;
  searchMode: string;
  purpose: "forward" | "backward";
  tuple: readonly CursorSortValue[];
  targetPage: number;
}): string {
  return value.parsed.codec.encode({
    queryFingerprint: value.queryFingerprint,
    source: value.source,
    searchMode: value.searchMode,
    pageSize: ratingAdminPeoplePageSize,
    purpose: value.purpose,
    sortTuple: [...value.tuple, value.targetPage],
    callerBinding: value.parsed.callerBinding,
  });
}

async function executeOrderedPage(
  parsed: ParsedContext,
  definition: OrderedDefinition,
  database: RatingAdminPeoplePagingDatabase,
): Promise<Readonly<Record<string, unknown>>> {
  const queryFingerprint = createQueryFingerprint(
    definition.fingerprintCriteria,
  );
  const tuple = decodeCursor(parsed, {
    queryFingerprint,
    source: definition.source,
    searchMode: definition.searchMode,
    tupleLength: definition.orders.length + 1,
  });
  const total = await database.countDocuments({
    collectionPath: definition.collectionPath,
    filters: definition.filters,
  });
  let currentPageNumber = tuple === null ? 1 : pageNumber(tuple);
  if (parsed.request.direction === "last") {
    currentPageNumber = Math.max(
      1,
      Math.ceil(total / ratingAdminPeoplePageSize),
    );
  }
  const lastPageSize = parsed.request.direction === "last"
    ? Math.max(1, total % ratingAdminPeoplePageSize || ratingAdminPeoplePageSize)
    : null;
  const documents = await database.queryDocuments({
    collectionPath: definition.collectionPath,
    filters: definition.filters,
    orders: definition.orders,
    ...(tuple === null
      ? {}
      : {
          cursor: {
            kind: parsed.request.direction === "backward"
              ? "endBefore" as const
              : "startAfter" as const,
            values: definition.queryCursorValues(tuple),
          },
        }),
    limit: lastPageSize ?? ratingAdminPeoplePageSize + 1,
    ...(parsed.request.direction === "backward" ||
      parsed.request.direction === "last"
      ? { limitToLast: true }
      : {}),
  });
  const selected = parsed.request.direction === "backward" ||
      parsed.request.direction === "last"
    ? documents.slice(Math.max(0, documents.length - ratingAdminPeoplePageSize))
    : documents.slice(0, ratingAdminPeoplePageSize);
  const items = definition.enrich === undefined
    ? selected.map(definition.project)
    : await definition.enrich(selected);
  const hasNext = parsed.request.direction === "backward"
    ? currentPageNumber < Math.max(
        1,
        Math.ceil(total / ratingAdminPeoplePageSize),
      )
    : parsed.request.direction === "last"
      ? false
      : documents.length > ratingAdminPeoplePageSize;
  const hasPrevious = currentPageNumber > 1;
  const first = selected[0];
  const last = selected[selected.length - 1];
  const nextCursor = hasNext && last !== undefined
    ? encodeBoundary({
        parsed,
        queryFingerprint,
        source: definition.source,
        searchMode: definition.searchMode,
        purpose: "forward",
        tuple: definition.cursorValues(last),
        targetPage: currentPageNumber + 1,
      })
    : undefined;
  const previousCursor = hasPrevious && first !== undefined
    ? encodeBoundary({
        parsed,
        queryFingerprint,
        source: definition.source,
        searchMode: definition.searchMode,
        purpose: "backward",
        tuple: definition.cursorValues(first),
        targetPage: currentPageNumber - 1,
      })
    : undefined;
  return response({
    parsed,
    items,
    queryFingerprint,
    currentPageNumber,
    total: { state: "exact", value: total },
    hasNext,
    hasPrevious,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(previousCursor === undefined ? {} : { previousCursor }),
    allowLast: true,
  });
}

function nameCriteria(value: unknown, label: string): NameCriteria {
  const source = requireString(value, 100, `${label} is invalid.`);
  let normalized: string;
  try {
    normalized = normalizeSearchName(source);
  } catch {
    callableError("invalid-argument", `${label} is invalid.`);
  }
  const words = normalized.split(" ");
  if (words.some((word) => Array.from(word).length < 2)) {
    callableError(
      "invalid-argument",
      `${label} words must contain at least two characters.`,
    );
  }
  const anchorWord = [...words].sort((first, second) =>
    second.length - first.length || first.localeCompare(second))[0];
  return {
    normalized,
    words: Object.freeze(words),
    anchor: Array.from(anchorWord)
      .slice(0, maximumWordPrefixLength)
      .join(""),
    requiresPostFilter:
      words.length > 1 ||
      Array.from(anchorWord).length > maximumWordPrefixLength,
  };
}

function matchesWords(value: unknown, criteria: NameCriteria): boolean {
  const normalized = readString(value, 200);
  if (normalized === null) return false;
  const sourceWords = normalized.split(" ");
  return criteria.words.every((word) =>
    sourceWords.some((sourceWord) => sourceWord.startsWith(word)));
}

function activityTags(
  data: Readonly<Record<string, unknown>>,
): readonly string[] {
  const values: string[] = [];
  if (readBoolean(data.roleCouponOwner)) values.push("Coupon");
  if (readBoolean(data.activityProfile)) values.push("Profile");
  if (readBoolean(data.roleBiteScoreOwner)) values.push("BiteScore Owner");
  if (readBoolean(data.activityClaims)) values.push("Claims");
  if (readBoolean(data.activityReviews)) values.push("Reviews");
  if (readBoolean(data.activityReports)) values.push("Reports");
  if (readBoolean(data.activityDishSuggestions)) values.push("Suggestions");
  if (readBoolean(data.activityReviewVotes)) values.push("Review Votes");
  return Object.freeze(values);
}

function directoryProjection(
  document: RatingAdminPeopleDocument,
  claimedRestaurantNames: readonly string[] = [],
  hasMoreClaimedRestaurants = false,
): Readonly<Record<string, unknown>> {
  const data = document.data;
  if (
    data.directoryVersion !== adminUserDirectoryVersion ||
    readString(data.uid, 1_500) !== document.id
  ) {
    callableError("failed-precondition", "The user directory is unavailable.");
  }
  const displayName = readString(data.displayName, 320);
  const contributionPoints = readSafeInteger(data.contributionPoints);
  if (displayName === null || contributionPoints === null) {
    callableError("failed-precondition", "The user directory is unavailable.");
  }
  return Object.freeze({
    uid: document.id,
    displayName,
    email: readString(data.displayEmail, 320),
    phoneNumber: readString(data.displayPhone, 64),
    claimedRestaurantNames,
    hasMoreClaimedRestaurants,
    hasRestaurantAccount: readBoolean(data.roleCouponOwner),
    hasBiteScoreOwnership: readBoolean(data.roleBiteScoreOwner),
    isAdmin: readBoolean(data.roleAdmin),
    isEmailVerified: readBoolean(data.emailVerified),
    restaurantAccountStatus:
      readString(data.couponAccountStatus, 64) ?? "none",
    activityTags: activityTags(data),
  });
}

async function enrichDirectoryUsers(
  documents: readonly RatingAdminPeopleDocument[],
  database: RatingAdminPeoplePagingDatabase,
  matchedNames: ReadonlyMap<string, string> = new Map(),
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const previews = await Promise.all(documents.map(async (document) => {
    const rows = await database.queryDocuments({
      collectionPath: adminUserClaimedRestaurantCollection,
      filters: [
        {
          field: "claimedRestaurantVersion",
          operation: "==",
          value: adminUserClaimedRestaurantVersion,
        },
        { field: "ownerUid", operation: "==", value: document.id },
        { field: "isClaimed", operation: "==", value: true },
        { field: "isActive", operation: "==", value: true },
      ],
      orders: [
        { field: "normalizedRestaurantName", direction: "asc" },
        { field: "sourceRestaurantId", direction: "asc" },
      ],
      limit: ratingAdminClaimedPreviewLimit,
    });
    const names = rows
      .map((row) => readString(row.data.displayRestaurantName, 100))
      .filter((name): name is string => name !== null)
      .slice(0, ratingAdminClaimedPreviewDisplayLimit);
    const matched = matchedNames.get(document.id);
    if (matched !== undefined && !names.includes(matched)) {
      if (names.length === ratingAdminClaimedPreviewDisplayLimit) {
        names[names.length - 1] = matched;
      } else {
        names.push(matched);
      }
    }
    return directoryProjection(
      document,
      Object.freeze(names),
      rows.length > ratingAdminClaimedPreviewDisplayLimit,
    );
  }));
  return Object.freeze(previews);
}

function displayTuple(
  document: RatingAdminPeopleDocument,
): readonly CursorSortValue[] {
  return [readString(document.data.normalizedDisplayName, 320) ?? "", document.id];
}

function displayQueryTuple(
  tuple: readonly CursorSortValue[],
): readonly unknown[] {
  if (typeof tuple[0] !== "string" || typeof tuple[1] !== "string") {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }
  return [tuple[0], tuple[1]];
}

async function executeDisplayNamePostFilter(
  parsed: ParsedContext,
  criteria: NameCriteria,
  context: RatingAdminPeopleHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  if (parsed.request.direction === "last") {
    callableError("invalid-argument", "Last-page navigation is unavailable.");
  }
  const searchMode = "displayName";
  const source = "ratingAdminUsers";
  const queryFingerprint = createQueryFingerprint({
    entity: "users",
    mode: searchMode,
    value: criteria.normalized,
  });
  const tuple = decodeCursor(parsed, {
    queryFingerprint,
    source,
    searchMode,
    tupleLength: 3,
  });
  const currentPageNumber = tuple === null ? 1 : pageNumber(tuple);
  const raw = await context.database.queryDocuments({
    collectionPath: adminUserDirectoryCollection,
    filters: [{
      field: "displayNamePrefixTokens",
      operation: "array-contains",
      value: criteria.anchor,
    }],
    orders: [
      { field: "normalizedDisplayName", direction: "asc" },
      { field: "__name__", direction: "asc" },
    ],
    ...(tuple === null
      ? {}
      : {
          cursor: {
            kind: parsed.request.direction === "backward"
              ? "endBefore" as const
              : "startAfter" as const,
            values: displayQueryTuple(tuple),
          },
        }),
    limit: ratingAdminPeoplePostFilterReadBudget,
    ...(parsed.request.direction === "backward"
      ? { limitToLast: true }
      : {}),
  });
  const matching = raw.filter((document) =>
    matchesWords(document.data.normalizedDisplayName, criteria));
  const selected = parsed.request.direction === "backward"
    ? matching.slice(Math.max(0, matching.length - ratingAdminPeoplePageSize))
    : matching.slice(0, ratingAdminPeoplePageSize);
  const items = await enrichDirectoryUsers(selected, context.database);
  const hasNext = parsed.request.direction === "backward"
    ? true
    : matching.length > ratingAdminPeoplePageSize ||
      raw.length === ratingAdminPeoplePostFilterReadBudget;
  const hasPrevious = currentPageNumber > 1;
  const firstRaw = raw[0];
  const lastSelected = selected[selected.length - 1];
  const lastRaw = raw[raw.length - 1];
  const nextAnchor = matching.length > ratingAdminPeoplePageSize
    ? lastSelected
    : lastRaw;
  const nextCursor = hasNext && nextAnchor !== undefined
    ? encodeBoundary({
        parsed,
        queryFingerprint,
        source,
        searchMode,
        purpose: "forward",
        tuple: displayTuple(nextAnchor),
        targetPage: currentPageNumber + 1,
      })
    : undefined;
  const previousCursor = hasPrevious && firstRaw !== undefined
    ? encodeBoundary({
        parsed,
        queryFingerprint,
        source,
        searchMode,
        purpose: "backward",
        tuple: displayTuple(firstRaw),
        targetPage: currentPageNumber - 1,
      })
    : undefined;
  return response({
    parsed,
    items,
    queryFingerprint,
    currentPageNumber,
    total: { state: "unknown" },
    hasNext,
    hasPrevious,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(previousCursor === undefined ? {} : { previousCursor }),
    allowLast: false,
  });
}

function claimedTuple(
  document: RatingAdminPeopleDocument,
): readonly CursorSortValue[] {
  return [
    readString(document.data.ownerUid, 1_500) ?? "",
    readString(document.data.normalizedRestaurantName, 200) ?? "",
    readString(document.data.sourceRestaurantId, 1_500) ?? "",
  ];
}

function claimedCursorString(value: CursorSortValue): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }
  return value;
}

function claimedCursorPage(value: CursorSortValue): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }
  return value;
}

function claimedBoundary(
  owner: CursorSortValue,
  name: CursorSortValue,
  sourceId: CursorSortValue,
): ClaimedBoundary {
  const result: ClaimedBoundary = [
    claimedCursorString(owner),
    claimedCursorString(name),
    claimedCursorString(sourceId),
  ];
  const populated = result.filter((value) => value !== null).length;
  if (populated !== 0 && populated !== 1 && populated !== 3) {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }
  if (populated === 1 && result[0] === null) {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }
  return result;
}

function claimedBoundaryValues(
  boundary: ClaimedBoundary,
): readonly unknown[] | null {
  if (boundary[0] === null) return null;
  if (boundary[1] === null && boundary[2] === null) return [boundary[0]];
  return [boundary[0], boundary[1], boundary[2]];
}

function claimedRawBoundary(
  document: RatingAdminPeopleDocument,
): ClaimedBoundary {
  const tuple = claimedTuple(document);
  return [
    claimedCursorString(tuple[0]),
    claimedCursorString(tuple[1]),
    claimedCursorString(tuple[2]),
  ];
}

function claimedOwnerBoundary(ownerUid: string | null): ClaimedBoundary {
  return ownerUid === null ? [null, null, null] : [ownerUid, null, null];
}

function decodeClaimedCursor(
  parsed: ParsedContext,
  queryFingerprint: string,
): ClaimedCursorState {
  if (parsed.request.cursor === undefined) {
    return {
      phase: "collect",
      rawBoundary: [null, null, null],
      logicalStartOwner: null,
      previousStartOwner: null,
      twoBackStartOwner: null,
      targetPageNumber: 1,
      visiblePageNumber: 1,
    };
  }
  try {
    const decoded = parsed.codec.decode(parsed.request.cursor, {
      queryFingerprint,
      source: "ratingAdminUsers",
      searchMode: "claimedRestaurant",
      pageSize: ratingAdminPeoplePageSize,
      callerBinding: parsed.callerBinding,
      purposes: [
        parsed.request.direction === "backward" ? "backward" : "forward",
      ],
    });
    if (decoded.sortTuple.length !== 8) throw new Error();
    const rawBoundary = claimedBoundary(
      decoded.sortTuple[0],
      decoded.sortTuple[1],
      decoded.sortTuple[2],
    );
    const targetPageNumber = claimedCursorPage(decoded.sortTuple[6]);
    const visiblePageNumber = claimedCursorPage(decoded.sortTuple[7]);
    if (decoded.sessionId === claimedCollectCursorSession) {
      return {
        phase: "collect",
        rawBoundary,
        logicalStartOwner: claimedCursorString(decoded.sortTuple[3]),
        previousStartOwner: claimedCursorString(decoded.sortTuple[4]),
        twoBackStartOwner: claimedCursorString(decoded.sortTuple[5]),
        targetPageNumber,
        visiblePageNumber,
      };
    }
    if (decoded.sessionId === claimedLookaheadCursorSession) {
      const pageLastOwner = claimedCursorString(decoded.sortTuple[3]);
      if (pageLastOwner === null) throw new Error();
      return {
        phase: "lookahead",
        rawBoundary,
        pageLastOwner,
        logicalStartOwner: claimedCursorString(decoded.sortTuple[4]),
        previousStartOwner: claimedCursorString(decoded.sortTuple[5]),
        targetPageNumber,
        visiblePageNumber,
      };
    }
    throw new Error();
  } catch {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }
}

function encodeClaimedCursor(value: {
  parsed: ParsedContext;
  queryFingerprint: string;
  purpose: "forward" | "backward";
  state: ClaimedCursorState;
}): string {
  const state = value.state;
  const stateValues = state.phase === "collect"
    ? [
        state.logicalStartOwner,
        state.previousStartOwner,
        state.twoBackStartOwner,
      ]
    : [
        state.pageLastOwner,
        state.logicalStartOwner,
        state.previousStartOwner,
      ];
  return value.parsed.codec.encode({
    queryFingerprint: value.queryFingerprint,
    source: "ratingAdminUsers",
    searchMode: "claimedRestaurant",
    pageSize: ratingAdminPeoplePageSize,
    purpose: value.purpose,
    sortTuple: [
      ...state.rawBoundary,
      ...stateValues,
      state.targetPageNumber,
      state.visiblePageNumber,
    ],
    callerBinding: value.parsed.callerBinding,
    sessionId: state.phase === "collect"
      ? claimedCollectCursorSession
      : claimedLookaheadCursorSession,
  });
}

function claimedPreviousCursor(value: {
  parsed: ParsedContext;
  queryFingerprint: string;
  state: ClaimedCollectCursorState;
}): string | undefined {
  if (value.state.targetPageNumber <= 1) return undefined;
  return encodeClaimedCursor({
    parsed: value.parsed,
    queryFingerprint: value.queryFingerprint,
    purpose: "backward",
    state: {
      phase: "collect",
      rawBoundary: claimedOwnerBoundary(value.state.previousStartOwner),
      logicalStartOwner: value.state.previousStartOwner,
      previousStartOwner: value.state.twoBackStartOwner,
      twoBackStartOwner: null,
      targetPageNumber: value.state.targetPageNumber - 1,
      visiblePageNumber: value.state.targetPageNumber,
    },
  });
}

async function executeClaimedRestaurantUsers(
  parsed: ParsedContext,
  criteria: NameCriteria,
  context: RatingAdminPeopleHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  if (parsed.request.direction === "last") {
    callableError("invalid-argument", "Last-page navigation is unavailable.");
  }
  const queryFingerprint = createQueryFingerprint({
    entity: "users",
    mode: "claimedRestaurant",
    value: criteria.normalized,
  });
  const state = decodeClaimedCursor(parsed, queryFingerprint);
  const cursorValues = claimedBoundaryValues(state.rawBoundary);
  const raw = await context.database.queryDocuments({
    collectionPath: adminUserClaimedRestaurantCollection,
    filters: [
      {
        field: "claimedRestaurantVersion",
        operation: "==",
        value: adminUserClaimedRestaurantVersion,
      },
      { field: "isClaimed", operation: "==", value: true },
      { field: "isActive", operation: "==", value: true },
      {
        field: "restaurantNamePrefixTokens",
        operation: "array-contains",
        value: criteria.anchor,
      },
    ],
    orders: [
      { field: "ownerUid", direction: "asc" },
      { field: "normalizedRestaurantName", direction: "asc" },
      { field: "sourceRestaurantId", direction: "asc" },
    ],
    ...(cursorValues === null
      ? {}
      : {
          cursor: {
            kind: "startAfter" as const,
            values: cursorValues,
          },
        }),
    limit: ratingAdminPeoplePostFilterReadBudget,
  });
  const matching = raw.filter((document) =>
    matchesWords(document.data.normalizedRestaurantName, criteria));

  if (state.phase === "lookahead") {
    const hasNext = matching.some((document) => {
      const ownerUid = readString(document.data.ownerUid, 1_500);
      return ownerUid !== null &&
        ownerUid !== state.pageLastOwner &&
        !ownerUid.includes("/");
    });
    if (!hasNext && raw.length === ratingAdminPeoplePostFilterReadBudget) {
      const lastRaw = raw[raw.length - 1];
      if (lastRaw === undefined) {
        callableError("failed-precondition", "The claimed User search is unavailable.");
      }
      const nextCursor = encodeClaimedCursor({
        parsed,
        queryFingerprint,
        purpose: "forward",
        state: { ...state, rawBoundary: claimedRawBoundary(lastRaw) },
      });
      return response({
        parsed,
        items: [],
        queryFingerprint,
        currentPageNumber: state.visiblePageNumber,
        total: { state: "unknown" },
        hasNext: true,
        hasPrevious: false,
        nextCursor,
        allowLast: false,
        preparation: {
          state: "preparing",
          completedUnits: 0,
          message: "Preparing claimed User results…",
        },
      });
    }
    const nextCursor = hasNext
      ? encodeClaimedCursor({
          parsed,
          queryFingerprint,
          purpose: "forward",
          state: {
            phase: "collect",
            rawBoundary: claimedOwnerBoundary(state.pageLastOwner),
            logicalStartOwner: state.pageLastOwner,
            previousStartOwner: state.logicalStartOwner,
            twoBackStartOwner: state.previousStartOwner,
            targetPageNumber: state.targetPageNumber + 1,
            visiblePageNumber: state.targetPageNumber,
          },
        })
      : undefined;
    return response({
      parsed,
      items: [],
      queryFingerprint,
      currentPageNumber: state.targetPageNumber,
      total: { state: "unknown" },
      hasNext,
      hasPrevious: false,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      allowLast: false,
      preparation: { state: "ready", completedUnits: 0 },
    });
  }

  const owners = new Map<string, RatingAdminPeopleDocument>();
  for (const document of matching) {
    const ownerUid = readString(document.data.ownerUid, 1_500);
    if (
      ownerUid !== null &&
      !ownerUid.includes("/") &&
      !owners.has(ownerUid)
    ) {
      owners.set(ownerUid, document);
    }
  }
  const ownerEntries = [...owners.entries()];
  if (ownerEntries.length === 0) {
    if (raw.length === ratingAdminPeoplePostFilterReadBudget) {
      const lastRaw = raw[raw.length - 1];
      if (lastRaw === undefined) {
        callableError("failed-precondition", "The claimed User search is unavailable.");
      }
      const nextCursor = encodeClaimedCursor({
        parsed,
        queryFingerprint,
        purpose: "forward",
        state: { ...state, rawBoundary: claimedRawBoundary(lastRaw) },
      });
      return response({
        parsed,
        items: [],
        queryFingerprint,
        currentPageNumber: state.visiblePageNumber,
        total: { state: "unknown" },
        hasNext: true,
        hasPrevious: false,
        nextCursor,
        allowLast: false,
        preparation: {
          state: "preparing",
          completedUnits: 0,
          message: "Preparing claimed User results…",
        },
      });
    }
    if (state.targetPageNumber !== 1) {
      callableError(
        "failed-precondition",
        "The claimed User search changed. Refresh and try again.",
      );
    }
    return response({
      parsed,
      items: [],
      queryFingerprint,
      currentPageNumber: 1,
      total: { state: "unknown" },
      hasNext: false,
      hasPrevious: false,
      allowLast: false,
    });
  }

  const selectedOwners = ownerEntries.slice(0, ratingAdminPeoplePageSize);
  const ownerIds = selectedOwners.map(([ownerUid]) => ownerUid);
  const directoryDocuments = await context.database.getDocuments(
    ownerIds.map((ownerUid) => `${adminUserDirectoryCollection}/${ownerUid}`),
  );
  const directoryById = new Map(
    directoryDocuments.map((document) => [document.id, document]),
  );
  const selectedDirectory = ownerIds
    .map((ownerUid) => directoryById.get(ownerUid))
    .filter(
      (document): document is RatingAdminPeopleDocument =>
        document !== undefined,
    );
  if (selectedDirectory.length !== selectedOwners.length) {
    callableError("failed-precondition", "The claimed User search is unavailable.");
  }
  const matchedNames = new Map<string, string>();
  for (const [ownerUid, row] of selectedOwners) {
    const name = readString(row.data.displayRestaurantName, 100);
    if (name !== null) matchedNames.set(ownerUid, name);
  }
  const items = await enrichDirectoryUsers(
    selectedDirectory,
    context.database,
    matchedNames,
  );
  const lastOwner = selectedOwners[selectedOwners.length - 1]?.[0];
  if (lastOwner === undefined) {
    callableError("failed-precondition", "The claimed User search is unavailable.");
  }
  const previousCursor = claimedPreviousCursor({
    parsed,
    queryFingerprint,
    state,
  });
  if (
    ownerEntries.length <= ratingAdminPeoplePageSize &&
    raw.length === ratingAdminPeoplePostFilterReadBudget
  ) {
    const continuationCursor = encodeClaimedCursor({
      parsed,
      queryFingerprint,
      purpose: "forward",
      state: {
        phase: "lookahead",
        rawBoundary: claimedOwnerBoundary(lastOwner),
        pageLastOwner: lastOwner,
        logicalStartOwner: state.logicalStartOwner,
        previousStartOwner: state.previousStartOwner,
        targetPageNumber: state.targetPageNumber,
        visiblePageNumber: state.visiblePageNumber,
      },
    });
    return response({
      parsed,
      items,
      queryFingerprint,
      currentPageNumber: state.visiblePageNumber,
      total: { state: "unknown" },
      hasNext: true,
      hasPrevious: previousCursor !== undefined,
      nextCursor: continuationCursor,
      ...(previousCursor === undefined ? {} : { previousCursor }),
      allowLast: false,
      preparation: {
        state: "preparing",
        completedUnits: 0,
        message: "Preparing claimed User results…",
      },
    });
  }

  const hasNext = ownerEntries.length > ratingAdminPeoplePageSize;
  const nextCursor = hasNext
    ? encodeClaimedCursor({
        parsed,
        queryFingerprint,
        purpose: "forward",
        state: {
          phase: "collect",
          rawBoundary: claimedOwnerBoundary(lastOwner),
          logicalStartOwner: lastOwner,
          previousStartOwner: state.logicalStartOwner,
          twoBackStartOwner: state.previousStartOwner,
          targetPageNumber: state.targetPageNumber + 1,
          visiblePageNumber: state.targetPageNumber,
        },
      })
    : undefined;
  return response({
    parsed,
    items,
    queryFingerprint,
    currentPageNumber: state.targetPageNumber,
    total: { state: "unknown" },
    hasNext,
    hasPrevious: previousCursor !== undefined,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(previousCursor === undefined ? {} : { previousCursor }),
    allowLast: false,
  });
}

function parseUserMode(value: unknown): UserSearchMode {
  if (
    value !== "viewAll" &&
    value !== "displayName" &&
    value !== "uid" &&
    value !== "email" &&
    value !== "phone" &&
    value !== "claimedRestaurant"
  ) {
    callableError("invalid-argument", "The user search mode is invalid.");
  }
  return value;
}

export async function searchRatingAdminUsersPageHandler(
  rawRequest: unknown,
  context: RatingAdminPeopleHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseContext(rawRequest, context);
  const mode = parseUserMode(parsed.request.criteria.mode);
  if (mode === "viewAll") {
    requireExactKeys(parsed.request.criteria, ["mode"]);
    return executeOrderedPage(parsed, {
      source: "ratingAdminUsers",
      searchMode: mode,
      collectionPath: adminUserDirectoryCollection,
      filters: [],
      orders: [
        { field: "normalizedDisplayName", direction: "asc" },
        { field: "__name__", direction: "asc" },
      ],
      fingerprintCriteria: { entity: "users", mode },
      cursorValues: displayTuple,
      queryCursorValues: displayQueryTuple,
      project: directoryProjection,
      enrich: (documents) =>
        enrichDirectoryUsers(documents, context.database),
    }, context.database);
  }

  requireExactKeys(parsed.request.criteria, ["mode", "value"]);
  if (mode === "uid") {
    if (
      parsed.request.direction !== "first" ||
      parsed.request.cursor !== undefined
    ) {
      callableError("invalid-argument", "UID navigation is invalid.");
    }
    const uid = requireDocumentId(parsed.request.criteria.value);
    const queryFingerprint = createQueryFingerprint({
      entity: "users",
      mode,
      value: uid,
    });
    const documents = await context.database.getDocuments([
      `${adminUserDirectoryCollection}/${uid}`,
    ]);
    const exact = documents.filter((document) => document.id === uid);
    const items = await enrichDirectoryUsers(exact, context.database);
    return response({
      parsed,
      items,
      queryFingerprint,
      currentPageNumber: 1,
      total: { state: "exact", value: items.length },
      hasNext: false,
      hasPrevious: false,
      allowLast: false,
    });
  }

  if (mode === "displayName") {
    const criteria = nameCriteria(
      parsed.request.criteria.value,
      "The display-name prefix",
    );
    if (criteria.requiresPostFilter) {
      return executeDisplayNamePostFilter(parsed, criteria, context);
    }
    return executeOrderedPage(parsed, {
      source: "ratingAdminUsers",
      searchMode: mode,
      collectionPath: adminUserDirectoryCollection,
      filters: [{
        field: "displayNamePrefixTokens",
        operation: "array-contains",
        value: criteria.anchor,
      }],
      orders: [
        { field: "normalizedDisplayName", direction: "asc" },
        { field: "__name__", direction: "asc" },
      ],
      fingerprintCriteria: {
        entity: "users",
        mode,
        value: criteria.normalized,
      },
      cursorValues: displayTuple,
      queryCursorValues: displayQueryTuple,
      project: directoryProjection,
      enrich: (documents) =>
        enrichDirectoryUsers(documents, context.database),
    }, context.database);
  }

  if (mode === "claimedRestaurant") {
    return executeClaimedRestaurantUsers(
      parsed,
      nameCriteria(
        parsed.request.criteria.value,
        "The claimed-restaurant prefix",
      ),
      context,
    );
  }

  let field: string;
  let normalized: string | null;
  if (mode === "email") {
    field = "normalizedEmail";
    normalized = normalizeAdminUserEmail(parsed.request.criteria.value);
  } else {
    field = "normalizedPhone";
    normalized = normalizeAdminUserPhone(parsed.request.criteria.value);
  }
  if (normalized === null) {
    callableError(
      "invalid-argument",
      mode === "email" ? "The email is invalid." : "The phone is invalid.",
    );
  }
  return executeOrderedPage(parsed, {
    source: "ratingAdminUsers",
    searchMode: mode,
    collectionPath: adminUserDirectoryCollection,
    filters: [{ field, operation: "==", value: normalized }],
    orders: [
      { field: "normalizedDisplayName", direction: "asc" },
      { field: "__name__", direction: "asc" },
    ],
    fingerprintCriteria: { entity: "users", mode, value: normalized },
    cursorValues: displayTuple,
    queryCursorValues: displayQueryTuple,
    project: directoryProjection,
    enrich: (documents) => enrichDirectoryUsers(documents, context.database),
  }, context.database);
}

function parseUserPointsSort(value: unknown): UserPointsSort {
  if (
    value !== "mostPoints" &&
    value !== "fewestPoints" &&
    value !== "displayNameAz" &&
    value !== "mostRecentActivity"
  ) {
    callableError("invalid-argument", "The User Points sort is invalid.");
  }
  return value;
}

function pointOrders(sort: UserPointsSort): readonly RatingAdminPeopleOrder[] {
  switch (sort) {
    case "mostPoints":
      return [
        { field: "contributionPoints", direction: "desc" },
        { field: "normalizedUserPointsDisplayName", direction: "asc" },
        { field: "__name__", direction: "asc" },
      ];
    case "fewestPoints":
      return [
        { field: "contributionPoints", direction: "asc" },
        { field: "normalizedUserPointsDisplayName", direction: "asc" },
        { field: "__name__", direction: "asc" },
      ];
    case "displayNameAz":
      return [
        { field: "normalizedUserPointsDisplayName", direction: "asc" },
        { field: "__name__", direction: "asc" },
      ];
    case "mostRecentActivity":
      return [
        { field: "lastContributionAt", direction: "desc" },
        { field: "contributionPoints", direction: "desc" },
        { field: "normalizedUserPointsDisplayName", direction: "asc" },
        { field: "__name__", direction: "asc" },
      ];
  }
}

function pointTuple(
  document: RatingAdminPeopleDocument,
  orders: readonly RatingAdminPeopleOrder[],
): readonly CursorSortValue[] {
  return orders.map((order) => {
    if (order.field === "__name__") return document.id;
    if (order.field === "lastContributionAt") {
      return timestampMillis(document.data.lastContributionAt);
    }
    const value = document.data[order.field];
    return typeof value === "string" ||
        (typeof value === "number" && Number.isSafeInteger(value))
      ? value
      : null;
  });
}

function pointQueryTuple(
  tuple: readonly CursorSortValue[],
  orders: readonly RatingAdminPeopleOrder[],
): readonly unknown[] {
  return orders.map((order, index) => {
    const value = tuple[index];
    if (order.field === "lastContributionAt") {
      if (value === null) return null;
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        callableError(
          "invalid-argument",
          "The page cursor is invalid or expired.",
        );
      }
      return new Date(value);
    }
    if (order.field === "contributionPoints") {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        callableError(
          "invalid-argument",
          "The page cursor is invalid or expired.",
        );
      }
    } else if (typeof value !== "string") {
      callableError(
        "invalid-argument",
        "The page cursor is invalid or expired.",
      );
    }
    return value;
  });
}

function pointsProjection(
  document: RatingAdminPeopleDocument,
): Readonly<Record<string, unknown>> {
  const data = document.data;
  if (
    data.directoryVersion !== adminUserDirectoryVersion ||
    readString(data.uid, 1_500) !== document.id ||
    data.includedInUserPointsDirectory !== true
  ) {
    callableError("failed-precondition", "The User Points directory is unavailable.");
  }
  const displayName = readString(data.userPointsDisplayName, 320);
  const totalPoints = readSafeInteger(data.contributionPoints);
  if (displayName === null || totalPoints === null) {
    callableError("failed-precondition", "The User Points directory is unavailable.");
  }
  return Object.freeze({
    userId: document.id,
    displayName,
    totalPoints,
    lastActivityAtMillis: timestampMillis(data.lastContributionAt),
  });
}

export async function listRatingAdminUserPointsPageHandler(
  rawRequest: unknown,
  context: RatingAdminPeopleHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseContext(rawRequest, context);
  requireExactKeys(parsed.request.criteria, ["sort"]);
  const sort = parseUserPointsSort(parsed.request.criteria.sort);
  const orders = pointOrders(sort);
  return executeOrderedPage(parsed, {
    source: "ratingAdminUserPoints",
    searchMode: sort,
    collectionPath: adminUserDirectoryCollection,
    filters: [{
      field: "includedInUserPointsDirectory",
      operation: "==",
      value: true,
    }],
    orders,
    fingerprintCriteria: { entity: "userPoints", sort },
    cursorValues: (document) => pointTuple(document, orders),
    queryCursorValues: (tuple) => pointQueryTuple(tuple, orders),
    project: pointsProjection,
  }, context.database);
}

function ledgerProjection(
  document: RatingAdminPeopleDocument,
  expectedUserId: string,
): Readonly<Record<string, unknown>> {
  const data = document.data;
  if (readString(data.userId, 1_500) !== expectedUserId) {
    callableError("failed-precondition", "The contribution ledger is unavailable.");
  }
  const pointsDelta = readSafeInteger(data.pointsDelta);
  const description = readString(data.description, 2_000);
  const createdAtMillis = timestampMillis(data.createdAt);
  if (
    pointsDelta === null ||
    description === null ||
    createdAtMillis === null
  ) {
    callableError("failed-precondition", "The contribution ledger is unavailable.");
  }
  return Object.freeze({
    id: document.id,
    userId: expectedUserId,
    pointsDelta,
    description,
    dishId: readString(data.dishId, 1_500),
    dishName: readString(data.dishName, 320),
    restaurantId: readString(data.restaurantId, 1_500),
    restaurantName: readString(data.restaurantName, 320),
    restaurantCity: readString(data.restaurantCity, 100),
    restaurantState: readString(data.restaurantState, 10),
    restaurantAddress: readString(data.restaurantAddress, 500),
    restaurantPhone: readString(data.restaurantPhone, 64),
    requestId: readString(data.requestId, 1_500),
    reason: readString(data.reason, 2_000),
    createdAtMillis,
  });
}

export async function listRatingAdminContributionLedgerPageHandler(
  rawRequest: unknown,
  context: RatingAdminPeopleHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseContext(rawRequest, context);
  requireExactKeys(parsed.request.criteria, ["userId"]);
  const userId = requireDocumentId(parsed.request.criteria.userId);
  const cursorValues = (
    document: RatingAdminPeopleDocument,
  ): readonly CursorSortValue[] => {
    const createdAt = timestampMillis(document.data.createdAt);
    if (createdAt === null) {
      callableError("failed-precondition", "The contribution ledger is unavailable.");
    }
    return [createdAt, document.id];
  };
  return executeOrderedPage(parsed, {
    source: "ratingAdminContributionLedger",
    searchMode: "byUser",
    collectionPath: contributionPointLedgerCollection,
    filters: [{ field: "userId", operation: "==", value: userId }],
    orders: [
      { field: "createdAt", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    fingerprintCriteria: { entity: "contributionLedger", userId },
    cursorValues,
    queryCursorValues: (tuple) => {
      if (
        typeof tuple[0] !== "number" ||
        !Number.isSafeInteger(tuple[0]) ||
        typeof tuple[1] !== "string"
      ) {
        callableError(
          "invalid-argument",
          "The page cursor is invalid or expired.",
        );
      }
      return [new Date(tuple[0]), tuple[1]];
    },
    project: (document) => ledgerProjection(document, userId),
  }, context.database);
}
