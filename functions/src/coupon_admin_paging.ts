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

export const couponAdminRestaurantPageSize = adminDirectoryDefaultPageSize;
export const couponAdminQueuePageSize = operationalQueueDefaultPageSize;
export const couponAdminCouponPageSize = 25;
export const couponAdminInvitePageSize = 50;
export const couponAdminPostFilterReadBudget = 500;
export const couponAdminCursorSecretName = "SEARCH_PAGINATION_CURSOR_KEY";

export type CouponAdminQueueKind =
  | "pendingApplications"
  | "nameChanges"
  | "openReports";
export type CouponAdminRestaurantSearchMode =
  | "exactZip"
  | "exactCity"
  | "nearbyRadius";

export type CouponAdminDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type CouponAdminFilter = Readonly<{
  field: string;
  operation: "==" | "array-contains" | ">=" | "<=";
  value: unknown;
}>;

export type CouponAdminOrder = Readonly<{
  field: string;
  direction: "asc" | "desc";
}>;

export type CouponAdminQuery = Readonly<{
  collectionPath: string;
  filters: readonly CouponAdminFilter[];
  orders: readonly CouponAdminOrder[];
  cursor?: Readonly<{
    kind: "startAfter" | "endBefore";
    values: readonly unknown[];
  }>;
  limit: number;
  limitToLast?: boolean;
}>;

export interface CouponAdminPagingDatabase {
  queryDocuments(query: CouponAdminQuery): Promise<readonly CouponAdminDocument[]>;
  countDocuments(value: {
    collectionPath: string;
    filters: readonly CouponAdminFilter[];
  }): Promise<number>;
  getDocuments(paths: readonly string[]): Promise<readonly CouponAdminDocument[]>;
}

function firestoreField(field: string): string | FieldPath {
  return field === "__name__" ? FieldPath.documentId() : field;
}

function applyFilters(
  query: Query<DocumentData, DocumentData>,
  filters: readonly CouponAdminFilter[],
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

export function createFirestoreCouponAdminPagingDatabase(
  firestore: Firestore,
): CouponAdminPagingDatabase {
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function readBoolean(value: unknown): boolean {
  return value === true;
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

function documentTimestamp(document: CouponAdminDocument, field: string): number {
  return timestampMillis(document.data[field]) ?? 0;
}

function callerBinding(uid: string): string {
  return createHash("sha256")
    .update(JSON.stringify(["couponAdmin", uid]), "utf8")
    .digest("hex");
}

export function decodeCouponAdminCursorKey(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    callableError(
      "failed-precondition",
      "Coupon Admin pagination is not configured.",
    );
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    callableError(
      "failed-precondition",
      "Coupon Admin pagination is not configured.",
    );
  }
  return bytes;
}

export type CouponAdminHandlerContext = Readonly<{
  adminUid: string;
  cursorSecret: unknown;
  database: CouponAdminPagingDatabase;
  now?: () => number;
  nonceSource?: (size: number) => Uint8Array;
}>;

export type CouponAdminParsedPageContext = Readonly<{
  request: PagedRequest;
  codec: OpaqueCursorCodec;
  callerBinding: string;
  nowMs: number;
}>;

function parseContext(
  rawRequest: unknown,
  expectedPageSize: number,
  context: CouponAdminHandlerContext,
): CouponAdminParsedPageContext {
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
      key: decodeCouponAdminCursorKey(context.cursorSecret),
      clock: context.now,
      nonceSource: context.nonceSource,
    }),
    callerBinding: callerBinding(adminUid),
    nowMs: context.now?.() ?? Date.now(),
  };
}

export type CouponAdminNormalizedNameCriteria = Readonly<{
  normalizedName: string | null;
  words: readonly string[];
  anchor: string | null;
  requiresPostFilter: boolean;
}>;

export function normalizeCouponAdminNameCriteria(
  value: unknown,
): CouponAdminNormalizedNameCriteria {
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

export function matchesCouponAdminNameWords(
  data: Readonly<Record<string, unknown>>,
  criteria: CouponAdminNormalizedNameCriteria,
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
  filters: readonly CouponAdminFilter[];
  orders: readonly CouponAdminOrder[];
  pageSize: number;
  fingerprintCriteria: Readonly<Record<string, unknown>>;
  cursorValues: (document: CouponAdminDocument) => readonly CursorSortValue[];
  queryCursorValues: (tuple: readonly CursorSortValue[]) => readonly unknown[];
  project: (document: CouponAdminDocument) => Readonly<Record<string, unknown>> | null;
  postFilter?: (document: CouponAdminDocument) => boolean;
  exactCount: boolean;
  enrich?: (
    documents: readonly CouponAdminDocument[],
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
  parsed: CouponAdminParsedPageContext,
  definition: SimplePageDefinition,
  database: CouponAdminPagingDatabase,
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
    : couponAdminPostFilterReadBudget);
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

function queueProjection(
  kind: CouponAdminQueueKind,
  document: CouponAdminDocument,
): Readonly<Record<string, unknown>> {
  const data = document.data;
  if (kind === "pendingApplications") {
    return Object.freeze({
      id: document.id,
      kind,
      restaurantName: readString(data.restaurantName, 100) ?? "",
      uid: readString(data.uid, 1_500) ?? "",
      email: readString(data.email, 320) ?? "",
      phone: readString(data.phoneNumber, 100) ?? readString(data.phone, 100) ?? "",
      applicantPhone: readString(data.phone, 100) ?? "",
      streetAddress: readString(data.streetAddress, 500) ?? "",
      city: readString(data.city, 100) ?? "",
      state: readString(data.state, 10) ?? "",
      zipCode: readString(data.zipCode, 20) ?? "",
      website: readString(data.website, 2_048) ?? "",
      latitude: readNumber(data.latitude),
      longitude: readNumber(data.longitude),
      approvalStatus: readString(data.approvalStatus, 64) ?? "pending",
      couponApplicationSubmitted: readBoolean(data.couponApplicationSubmitted),
      profileVersion: Number.isSafeInteger(data.profileVersion) ? data.profileVersion : 0,
      createdAtMillis: timestampMillis(data.createdAt),
      updatedAtMillis: timestampMillis(data.updatedAt),
    });
  }
  if (kind === "nameChanges") {
    return Object.freeze({
      id: document.id,
      kind,
      userId: readString(data.userId, 1_500) ?? "",
      currentRestaurantName: readString(data.currentRestaurantName, 100) ?? "",
      requestedRestaurantName: readString(data.requestedRestaurantName, 100) ?? "",
      status: readString(data.status, 64) ?? "pending",
      createdAtMillis: timestampMillis(data.createdAt),
    });
  }
  return Object.freeze({
    id: document.id,
    kind,
    reportType: readString(data.reportType, 100) ?? "",
    restaurantName: readString(data.restaurantName, 100) ?? "",
    couponTitle: readString(data.couponTitle, 100) ?? "",
    restaurantId: readString(data.restaurantId, 1_500) ?? "",
    couponId: readString(data.couponId, 1_500) ?? "",
    reason: readString(data.reason, 500) ?? "",
    note: readString(data.note, 2_000) ?? "",
    reporterUid: readString(data.reporterUid, 1_500) ?? "",
    status: readString(data.status, 64) ?? "open",
    createdAtMillis: timestampMillis(data.createdAt),
  });
}

export async function listCouponAdminQueuePageHandler(
  rawRequest: unknown,
  context: CouponAdminHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseContext(rawRequest, couponAdminQueuePageSize, context);
  if (!isPlainRecord(parsed.request.criteria)) {
    callableError("invalid-argument", "The page criteria are invalid.");
  }
  requireExactKeys(parsed.request.criteria, ["queueKind"]);
  const queueKind = parsed.request.criteria.queueKind;
  if (
    queueKind !== "pendingApplications" &&
    queueKind !== "nameChanges" &&
    queueKind !== "openReports"
  ) {
    callableError("invalid-argument", "The queue kind is invalid.");
  }
  const definition = queueKind === "pendingApplications"
    ? {
        collectionPath: "restaurant_accounts",
        statusField: "approvalStatus",
        statusValue: "pending",
        timestampField: "createdAt",
      }
    : queueKind === "nameChanges"
      ? {
          collectionPath: "restaurant_name_change_requests",
          statusField: "status",
          statusValue: "pending",
          timestampField: "createdAt",
        }
      : {
          collectionPath: "bitesaver_reports",
          statusField: "status",
          statusValue: "open",
          timestampField: "createdAt",
        };
  return executeSimplePage(parsed, {
    source: "couponAdminQueue",
    searchMode: queueKind,
    collectionPath: definition.collectionPath,
    filters: [{
      field: definition.statusField,
      operation: "==",
      value: definition.statusValue,
    }],
    orders: [
      { field: definition.timestampField, direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    pageSize: couponAdminQueuePageSize,
    fingerprintCriteria: { queueKind },
    cursorValues: (document) => [
      documentTimestamp(document, definition.timestampField),
      document.id,
    ],
    queryCursorValues: (tuple) => [new Date(tuple[0] as number), tuple[1]],
    project: (document) => queueProjection(queueKind, document),
    exactCount: true,
  }, context.database);
}

function couponProjection(document: CouponAdminDocument): Readonly<Record<string, unknown>> {
  const data = document.data;
  return Object.freeze({
    id: document.id,
    title: readString(data.title, 100) ?? "",
    restaurant: readString(data.restaurant, 100) ?? "",
    expires: readString(data.expires, 500) ?? "",
    startTimeMillis: timestampMillis(data.startTime),
    endTimeMillis: timestampMillis(data.endTime),
    usageRule: readString(data.usageRule, 500) ?? "",
    couponNumber: readString(data.couponNumber, 100),
    isProximityOnly: readBoolean(data.isProximityOnly),
    proximityRadiusMiles: readNumber(data.proximityRadiusMiles),
    details: readString(data.details, 2_000),
    imageUrl: readString(data.imageUrl, 2_048),
    createdAtMillis: timestampMillis(data.createdAt),
    updatedAtMillis: timestampMillis(data.updatedAt),
  });
}

export async function listCouponAdminCouponsPageHandler(
  rawRequest: unknown,
  context: CouponAdminHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseContext(rawRequest, couponAdminCouponPageSize, context);
  requireExactKeys(parsed.request.criteria, ["restaurantAccountId"]);
  const restaurantAccountId = requireDocumentId(
    parsed.request.criteria.restaurantAccountId,
  );
  return executeSimplePage(parsed, {
    source: "couponAdminCoupons",
    searchMode: "restaurantCoupons",
    collectionPath: `restaurant_accounts/${restaurantAccountId}/coupons`,
    filters: [],
    orders: [
      { field: "createdAt", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    pageSize: couponAdminCouponPageSize,
    fingerprintCriteria: { restaurantAccountId },
    cursorValues: (document) => [documentTimestamp(document, "createdAt"), document.id],
    queryCursorValues: (tuple) => [new Date(tuple[0] as number), tuple[1]],
    project: couponProjection,
    exactCount: true,
  }, context.database);
}

function inviteProjection(document: CouponAdminDocument): Readonly<Record<string, unknown>> {
  const data = document.data;
  return Object.freeze({
    id: document.id,
    type: readString(data.type, 100) ?? "",
    side: "coupon",
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

export async function listCouponAdminInviteHistoryPageHandler(
  rawRequest: unknown,
  context: CouponAdminHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseContext(rawRequest, couponAdminInvitePageSize, context);
  requireExactKeys(parsed.request.criteria, ["side"]);
  if (parsed.request.criteria.side !== "coupon") {
    callableError("invalid-argument", "The invite side is invalid.");
  }
  const filters: readonly CouponAdminFilter[] = [
    { field: "side", operation: "==", value: "coupon" },
  ];
  return executeSimplePage(parsed, {
    source: "couponAdminInvites",
    searchMode: "couponInvites",
    collectionPath: "restaurant_invites",
    filters,
    orders: [
      { field: "createdAt", direction: "desc" },
      { field: "__name__", direction: "desc" },
    ],
    pageSize: couponAdminInvitePageSize,
    fingerprintCriteria: { side: "coupon" },
    cursorValues: (document) => [documentTimestamp(document, "createdAt"), document.id],
    queryCursorValues: (tuple) => [new Date(tuple[0] as number), tuple[1]],
    project: inviteProjection,
    exactCount: true,
  }, context.database);
}

function restaurantProjection(
  document: CouponAdminDocument,
  distanceMiles: number | null = null,
): Readonly<Record<string, unknown>> | null {
  const data = document.data;
  const restaurantName = readString(data.restaurantName, 100);
  const approvalStatus = readString(data.approvalStatus, 64)?.toLowerCase();
  if (restaurantName === null || approvalStatus !== "approved") {
    return null;
  }
  return Object.freeze({
    source: "biteSaver",
    documentId: document.id,
    actionId: readString(data.uid, 1_500) ?? document.id,
    restaurantName,
    streetAddress: readString(data.streetAddress, 500) ?? "",
    city: readString(data.city, 100) ?? "",
    state: readString(data.state, 10) ?? "",
    zipCode: readString(data.zipCode, 20) ?? "",
    phone: readString(data.phone, 100) ?? "",
    website: readString(data.website, 2_048) ?? "",
    latitude: readNumber(data.latitude),
    longitude: readNumber(data.longitude),
    distanceMiles,
    approvalStatus,
    couponApplicationSubmitted: readBoolean(data.couponApplicationSubmitted),
    uid: readString(data.uid, 1_500),
    linkedBiteScoreRestaurantId: readString(data.linkedBiteScoreRestaurantId, 1_500),
  });
}

type ExactRestaurantCriteria = Readonly<{
  mode: "exactZip" | "exactCity";
  zip5?: string;
  cityStateKey?: string;
  restaurantName: CouponAdminNormalizedNameCriteria;
}>;

function parseExactRestaurantCriteria(
  criteria: Readonly<Record<string, unknown>>,
): ExactRestaurantCriteria {
  const mode = criteria.mode;
  if (mode === "exactZip") {
    requireExactKeys(criteria as Record<string, unknown>, ["mode", "zipCode"], ["restaurantName"]);
    let zip5: string;
    try {
      zip5 = normalizeZip5(criteria.zipCode);
    } catch {
      callableError("invalid-argument", "The ZIP code is invalid.");
    }
    return {
      mode,
      zip5,
      restaurantName: normalizeCouponAdminNameCriteria(criteria.restaurantName),
    };
  }
  if (mode === "exactCity") {
    requireExactKeys(criteria as Record<string, unknown>, ["mode", "city", "state"], ["restaurantName"]);
    let cityStateKey: string;
    try {
      normalizeStateCode(criteria.state);
      cityStateKey = buildCityStateKey(criteria.city, criteria.state);
    } catch {
      callableError("invalid-argument", "City and a two-letter state are required.");
    }
    return {
      mode,
      cityStateKey,
      restaurantName: normalizeCouponAdminNameCriteria(criteria.restaurantName),
    };
  }
  callableError("invalid-argument", "The restaurant search mode is invalid.");
}

export async function searchCouponAdminExactRestaurantsPage(
  parsed: CouponAdminParsedPageContext,
  context: CouponAdminHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const criteria = parseExactRestaurantCriteria(parsed.request.criteria);
  const filters: CouponAdminFilter[] = [
    { field: "source", operation: "==", value: "biteSaver" },
    { field: "adminDirectoryVisible", operation: "==", value: true },
    criteria.mode === "exactZip"
      ? { field: "zip5", operation: "==", value: criteria.zip5 }
      : { field: "cityStateKey", operation: "==", value: criteria.cityStateKey },
  ];
  if (criteria.restaurantName.anchor !== null) {
    filters.push({
      field: "namePrefixTokens",
      operation: "array-contains",
      value: criteria.restaurantName.anchor,
    });
  }
  const fingerprintCriteria = Object.freeze({
    mode: criteria.mode,
    ...(criteria.zip5 === undefined ? {} : { zip5: criteria.zip5 }),
    ...(criteria.cityStateKey === undefined
      ? {}
      : { cityStateKey: criteria.cityStateKey }),
    ...(criteria.restaurantName.normalizedName === null
      ? {}
      : { restaurantName: criteria.restaurantName.normalizedName }),
  });
  return executeSimplePage(parsed, {
    source: "couponAdminRestaurants",
    searchMode: criteria.mode,
    collectionPath: "restaurant_search_index",
    filters,
    orders: [
      { field: "normalizedName", direction: "asc" },
      { field: "sourceDocumentId", direction: "asc" },
    ],
    pageSize: couponAdminRestaurantPageSize,
    fingerprintCriteria,
    cursorValues: (document) => [
      readString(document.data.normalizedName, 200) ?? "",
      readString(document.data.sourceDocumentId, 1_500) ?? "",
    ],
    queryCursorValues: (tuple) => [tuple[0], tuple[1]],
    project: () => null,
    ...(criteria.restaurantName.requiresPostFilter
      ? { postFilter: (document: CouponAdminDocument) =>
          matchesCouponAdminNameWords(document.data, criteria.restaurantName) }
      : {}),
    exactCount: !criteria.restaurantName.requiresPostFilter,
    enrich: async (documents) => {
      const sourceIds = documents.map((document) =>
        readString(document.data.sourceDocumentId, 1_500) ?? "");
      const sources = await context.database.getDocuments(
        sourceIds.map((id) => `restaurant_accounts/${id}`),
      );
      const byId = new Map(sources.map((document) => [document.id, document]));
      return sourceIds.map((id) => {
        const document = byId.get(id);
        return document === undefined ? null : restaurantProjection(document);
      });
    },
  }, context.database);
}

export function createCouponAdminParsedRestaurantContext(
  rawRequest: unknown,
  context: CouponAdminHandlerContext,
): CouponAdminParsedPageContext {
  return parseContext(rawRequest, couponAdminRestaurantPageSize, context);
}
