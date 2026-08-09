import { createHash, randomBytes } from "node:crypto";
import {
  type DocumentData,
  type Firestore,
  type Query,
  Timestamp,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  exactRestaurantDistanceKilometers,
  extractBiteScoreRestaurantCoordinates,
  KILOMETERS_PER_MILE,
  restaurantGeographicQueryBounds,
} from "./restaurant_geo_helpers.js";
import {
  ratingAdminRestaurantPageSize,
  createRatingAdminParsedRestaurantContext,
  ratingAdminRestaurantProjection,
  type RatingAdminDocument,
  type RatingAdminFilter,
  type RatingAdminHandlerContext,
  type RatingAdminNormalizedNameCriteria,
  type RatingAdminOrder,
  type RatingAdminPagingDatabase,
  matchesRatingAdminNameWords,
  normalizeRatingAdminNameCriteria,
} from "./rating_admin_paging.js";
import { pageProtocolVersion } from "./pagination_protocol.js";
import { createQueryFingerprint } from "./query_fingerprint.js";

export const ratingAdminRadiusSessionCollection =
  "private_rating_admin_restaurant_search_sessions";
export const ratingAdminRadiusActiveCollection =
  "private_rating_admin_restaurant_search_active_sessions";
export const ratingAdminRadiusResultSubcollection = "results";
export const ratingAdminRadiusReadBudget = 450;
export const ratingAdminRadiusRangeChunkSize = 25;
export const ratingAdminRadiusMaximumRanges = 9;
export const ratingAdminRadiusIdleLifetimeMs = 15 * 60 * 1_000;
export const ratingAdminRadiusAbsoluteLifetimeMs = 60 * 60 * 1_000;
export const ratingAdminRadiusLeaseLifetimeMs = 30 * 1_000;

type RadiusCenter = Readonly<{
  latitude: number;
  longitude: number;
  displayName: string;
}>;

type RadiusRange = Readonly<{
  start: string;
  end: string;
  afterGeohash: string | null;
  afterDocumentId: string | null;
  exhausted: boolean;
}>;

export type RatingAdminRadiusSession = Readonly<{
  id: string;
  schemaVersion: 1;
  state: "preparing" | "ready" | "failed";
  callerBinding: string;
  queryFingerprint: string;
  source: "biteScore";
  searchMode: "nearbyRadius";
  pageSize: number;
  center: RadiusCenter;
  radiusMiles: number;
  status: "all" | "active" | "inactive";
  normalizedName: string | null;
  nameWords: readonly string[];
  nameAnchor: string | null;
  ranges: readonly RadiusRange[];
  createdAtMs: number;
  lastUsedAtMs: number;
  idleExpiresAtMs: number;
  absoluteExpiresAtMs: number;
  leaseToken: string | null;
  leaseUntilMs: number | null;
  lastCompletedRequestId: string | null;
  scannedDocumentCount: number;
  resultCount: number | null;
  failureMessage: string | null;
}>;

export type RatingAdminRadiusResult = Readonly<{
  id: string;
  sourceDocumentId: string;
  distanceMillimeters: number;
  normalizedName: string;
  expiresAtMs: number;
}>;

export type RadiusClaimResult = Readonly<{
  status: "claimed" | "busy" | "duplicate";
  session: RatingAdminRadiusSession;
}>;

export interface RatingAdminRadiusStore {
  createSession(session: RatingAdminRadiusSession): Promise<void>;
  getSession(sessionId: string): Promise<RatingAdminRadiusSession | null>;
  getActiveSession(
    activeKey: string,
  ): Promise<RatingAdminRadiusSession | null>;
  claimSession(input: Readonly<{
    sessionId: string;
    callerBinding: string;
    queryFingerprint: string;
    clientRequestId: string;
    leaseToken: string;
    nowMs: number;
  }>): Promise<RadiusClaimResult>;
  touchReadySession(input: Readonly<{
    sessionId: string;
    activeKey: string;
    callerBinding: string;
    queryFingerprint: string;
    nowMs: number;
  }>): Promise<RatingAdminRadiusSession>;
  writeResults(
    sessionId: string,
    results: readonly RatingAdminRadiusResult[],
  ): Promise<void>;
  finishAdvance(input: Readonly<{
    sessionId: string;
    leaseToken: string;
    clientRequestId: string;
    nowMs: number;
    ranges: readonly RadiusRange[];
    documentsRead: number;
    state: "preparing" | "ready";
    resultCount: number | null;
  }>): Promise<RatingAdminRadiusSession>;
  failAdvance(input: Readonly<{
    sessionId: string;
    leaseToken: string;
    clientRequestId: string;
    nowMs: number;
  }>): Promise<void>;
  queryResults(input: Readonly<{
    sessionId: string;
    orders: readonly RatingAdminOrder[];
    cursor?: Readonly<{
      kind: "startAfter" | "endBefore";
      values: readonly unknown[];
    }>;
    limit: number;
    limitToLast?: boolean;
  }>): Promise<readonly RatingAdminDocument[]>;
  countResults(sessionId: string): Promise<number>;
}

function invalidSession(): never {
  throw new HttpsError(
    "failed-precondition",
    "The nearby restaurant search session is unavailable or expired.",
  );
}

function invalidCriteria(message = "The restaurant search criteria are invalid."): never {
  throw new HttpsError("invalid-argument", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalidCriteria();
  }
}

function normalizedLocation(value: unknown): string {
  if (typeof value !== "string") {
    invalidCriteria("A nearby search location is required.");
  }
  const result = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!result || Array.from(result).length > 100) {
    invalidCriteria("A valid nearby search location is required.");
  }
  return result;
}

function requireRadius(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 50
  ) {
    invalidCriteria("Radius must be an integer from 1 through 50 miles.");
  }
  return value;
}

function readString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string" || !value || value.length > maximumLength) {
    return null;
  }
  return value;
}

function readInteger(value: unknown, minimum = 0): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : null;
}

function readNullableString(value: unknown, maximumLength: number): string | null | undefined {
  return value === null ? null : readString(value, maximumLength) ?? undefined;
}

function readTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isSafeInteger(value.getTime()) ? value.getTime() : null;
  }
  if (isRecord(value) && typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return readInteger(millis);
  }
  return readInteger(value);
}

function parseCenter(value: unknown): RadiusCenter | null {
  if (!isRecord(value)) {
    return null;
  }
  const latitude = value.latitude;
  const longitude = value.longitude;
  const displayName = readString(value.displayName, 500);
  if (
    typeof latitude !== "number" || !Number.isFinite(latitude) ||
    typeof longitude !== "number" || !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
    displayName === null
  ) {
    return null;
  }
  return Object.freeze({ latitude, longitude, displayName });
}

function parseRanges(value: unknown): readonly RadiusRange[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > ratingAdminRadiusMaximumRanges) {
    return null;
  }
  const ranges: RadiusRange[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      return null;
    }
    const start = readString(entry.start, 32);
    const end = readString(entry.end, 32);
    const afterGeohash = readNullableString(entry.afterGeohash, 32);
    const afterDocumentId = readNullableString(entry.afterDocumentId, 1_500);
    if (
      start === null || end === null || start > end ||
      afterGeohash === undefined || afterDocumentId === undefined ||
      typeof entry.exhausted !== "boolean" ||
      ((afterGeohash === null) !== (afterDocumentId === null))
    ) {
      return null;
    }
    ranges.push(Object.freeze({
      start,
      end,
      afterGeohash,
      afterDocumentId,
      exhausted: entry.exhausted,
    }));
  }
  return Object.freeze(ranges);
}

function parseSession(id: string, value: unknown): RatingAdminRadiusSession {
  if (!isRecord(value)) {
    invalidSession();
  }
  const center = parseCenter(value.center);
  const ranges = parseRanges(value.ranges);
  const state = value.state;
  const callerBinding = readString(value.callerBinding, 64);
  const queryFingerprint = readString(value.queryFingerprint, 64);
  const createdAtMs = readTimestampMs(value.createdAtMs);
  const lastUsedAtMs = readTimestampMs(value.lastUsedAtMs);
  const idleExpiresAtMs = readTimestampMs(value.idleExpiresAtMs);
  const absoluteExpiresAtMs = readTimestampMs(value.absoluteExpiresAtMs);
  const leaseUntilMs = value.leaseUntilMs === null
    ? null
    : readTimestampMs(value.leaseUntilMs);
  const leaseToken = readNullableString(value.leaseToken, 200);
  const lastCompletedRequestId = readNullableString(value.lastCompletedRequestId, 128);
  const normalizedName = readNullableString(value.normalizedName, 200);
  const nameAnchor = readNullableString(value.nameAnchor, 200);
  const failureMessage = readNullableString(value.failureMessage, 500);
  const scannedDocumentCount = readInteger(value.scannedDocumentCount);
  const resultCount = value.resultCount === null ? null : readInteger(value.resultCount);
  if (
    value.schemaVersion !== 1 ||
    (state !== "preparing" && state !== "ready" && state !== "failed") ||
    callerBinding === null || !/^[a-f0-9]{64}$/u.test(callerBinding) ||
    queryFingerprint === null || !/^[a-f0-9]{64}$/u.test(queryFingerprint) ||
    value.source !== "biteScore" || value.searchMode !== "nearbyRadius" ||
    value.pageSize !== ratingAdminRestaurantPageSize || center === null || ranges === null ||
    readInteger(value.radiusMiles, 1) === null ||
    (value.status !== "all" &&
      value.status !== "active" &&
      value.status !== "inactive") ||
    normalizedName === undefined || nameAnchor === undefined || failureMessage === undefined ||
    !Array.isArray(value.nameWords) || value.nameWords.some((word) => readString(word, 200) === null) ||
    createdAtMs === null || lastUsedAtMs === null || idleExpiresAtMs === null ||
    absoluteExpiresAtMs === null || leaseToken === undefined ||
    leaseUntilMs === null !== (leaseToken === null) ||
    lastCompletedRequestId === undefined || scannedDocumentCount === null ||
    resultCount === undefined || (state === "ready" && resultCount === null)
  ) {
    invalidSession();
  }
  return Object.freeze({
    id,
    schemaVersion: 1,
    state,
    callerBinding,
    queryFingerprint,
    source: "biteScore",
    searchMode: "nearbyRadius",
    pageSize: ratingAdminRestaurantPageSize,
    center,
    radiusMiles: value.radiusMiles as number,
    status: value.status,
    normalizedName,
    nameWords: Object.freeze([...(value.nameWords as string[])]),
    nameAnchor,
    ranges,
    createdAtMs,
    lastUsedAtMs,
    idleExpiresAtMs,
    absoluteExpiresAtMs,
    leaseToken,
    leaseUntilMs,
    lastCompletedRequestId,
    scannedDocumentCount,
    resultCount,
    failureMessage,
  });
}

function sessionWrite(session: RatingAdminRadiusSession): Record<string, unknown> {
  return {
    schemaVersion: session.schemaVersion,
    state: session.state,
    callerBinding: session.callerBinding,
    queryFingerprint: session.queryFingerprint,
    source: session.source,
    searchMode: session.searchMode,
    pageSize: session.pageSize,
    center: session.center,
    radiusMiles: session.radiusMiles,
    status: session.status,
    normalizedName: session.normalizedName,
    nameWords: session.nameWords,
    nameAnchor: session.nameAnchor,
    ranges: session.ranges,
    createdAtMs: session.createdAtMs,
    lastUsedAtMs: session.lastUsedAtMs,
    idleExpiresAtMs: session.idleExpiresAtMs,
    absoluteExpiresAtMs: session.absoluteExpiresAtMs,
    leaseToken: session.leaseToken,
    leaseUntilMs: session.leaseUntilMs,
    lastCompletedRequestId: session.lastCompletedRequestId,
    scannedDocumentCount: session.scannedDocumentCount,
    resultCount: session.resultCount,
    failureMessage: session.failureMessage,
    expiresAt: Timestamp.fromMillis(Math.min(
      session.idleExpiresAtMs,
      session.absoluteExpiresAtMs,
    )),
  };
}

function activeKey(callerBinding: string, queryFingerprint: string): string {
  return createHash("sha256")
    .update(JSON.stringify([callerBinding, queryFingerprint]), "utf8")
    .digest("hex");
}

function applyOrders(
  query: Query<DocumentData, DocumentData>,
  orders: readonly RatingAdminOrder[],
): Query<DocumentData, DocumentData> {
  let result = query;
  for (const order of orders) {
    result = result.orderBy(order.field, order.direction);
  }
  return result;
}

export function createFirestoreRatingAdminRadiusStore(
  firestore: Firestore,
): RatingAdminRadiusStore {
  const sessions = () => firestore.collection(ratingAdminRadiusSessionCollection);
  const active = () => firestore.collection(ratingAdminRadiusActiveCollection);
  return {
    async createSession(session) {
      const sessionRef = sessions().doc(session.id);
      const activeRef = active().doc(activeKey(session.callerBinding, session.queryFingerprint));
      const batch = firestore.batch();
      batch.create(sessionRef, sessionWrite(session));
      batch.set(activeRef, {
        sessionId: session.id,
        callerBinding: session.callerBinding,
        queryFingerprint: session.queryFingerprint,
        expiresAt: Timestamp.fromMillis(Math.min(session.idleExpiresAtMs, session.absoluteExpiresAtMs)),
      });
      await batch.commit();
    },
    async getSession(sessionId) {
      const snapshot = await sessions().doc(sessionId).get();
      return snapshot.exists ? parseSession(snapshot.id, snapshot.data()) : null;
    },
    async getActiveSession(key) {
      const activeSnapshot = await active().doc(key).get();
      if (!activeSnapshot.exists) {
        return null;
      }
      const sessionId = readString(activeSnapshot.data()?.sessionId, 128);
      if (sessionId === null) {
        invalidSession();
      }
      const snapshot = await sessions().doc(sessionId).get();
      return snapshot.exists ? parseSession(snapshot.id, snapshot.data()) : null;
    },
    async claimSession(input) {
      return firestore.runTransaction(async (transaction): Promise<RadiusClaimResult> => {
        const reference = sessions().doc(input.sessionId);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) {
          invalidSession();
        }
        const session = parseSession(snapshot.id, snapshot.data());
        if (
          session.callerBinding !== input.callerBinding ||
          session.queryFingerprint !== input.queryFingerprint
        ) {
          invalidSession();
        }
        if (session.lastCompletedRequestId === input.clientRequestId) {
          return { status: "duplicate", session };
        }
        if (
          session.leaseToken !== null &&
          session.leaseUntilMs !== null &&
          session.leaseUntilMs > input.nowMs
        ) {
          return { status: "busy", session };
        }
        const nextIdleExpiry = Math.min(
          input.nowMs + ratingAdminRadiusIdleLifetimeMs,
          session.absoluteExpiresAtMs,
        );
        transaction.update(reference, {
          leaseToken: input.leaseToken,
          leaseUntilMs: input.nowMs + ratingAdminRadiusLeaseLifetimeMs,
          lastUsedAtMs: input.nowMs,
          idleExpiresAtMs: nextIdleExpiry,
          expiresAt: Timestamp.fromMillis(nextIdleExpiry),
        });
        return {
          status: "claimed",
          session: Object.freeze({
            ...session,
            leaseToken: input.leaseToken,
            leaseUntilMs: input.nowMs + ratingAdminRadiusLeaseLifetimeMs,
            lastUsedAtMs: input.nowMs,
            idleExpiresAtMs: nextIdleExpiry,
          }),
        };
      });
    },
    async touchReadySession(input) {
      return firestore.runTransaction(async (transaction) => {
        const reference = sessions().doc(input.sessionId);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) {
          invalidSession();
        }
        const session = parseSession(snapshot.id, snapshot.data());
        if (
          session.state !== "ready" ||
          session.callerBinding !== input.callerBinding ||
          session.queryFingerprint !== input.queryFingerprint ||
          isExpired(session, input.nowMs)
        ) {
          invalidSession();
        }
        const idleExpiresAtMs = Math.min(
          input.nowMs + ratingAdminRadiusIdleLifetimeMs,
          session.absoluteExpiresAtMs,
        );
        const next = Object.freeze({
          ...session,
          lastUsedAtMs: input.nowMs,
          idleExpiresAtMs,
        });
        transaction.update(reference, {
          lastUsedAtMs: input.nowMs,
          idleExpiresAtMs,
          expiresAt: Timestamp.fromMillis(idleExpiresAtMs),
        });
        transaction.set(active().doc(input.activeKey), {
          sessionId: session.id,
          callerBinding: session.callerBinding,
          queryFingerprint: session.queryFingerprint,
          expiresAt: Timestamp.fromMillis(idleExpiresAtMs),
        });
        return next;
      });
    },
    async writeResults(sessionId, results) {
      if (results.length === 0) {
        return;
      }
      if (results.length > ratingAdminRadiusReadBudget) {
        invalidSession();
      }
      const batch = firestore.batch();
      for (const result of results) {
        batch.set(
          sessions().doc(sessionId).collection(ratingAdminRadiusResultSubcollection).doc(result.id),
          {
            sourceDocumentId: result.sourceDocumentId,
            distanceMillimeters: result.distanceMillimeters,
            normalizedName: result.normalizedName,
            expiresAt: Timestamp.fromMillis(result.expiresAtMs),
          },
        );
      }
      await batch.commit();
    },
    async finishAdvance(input) {
      return firestore.runTransaction(async (transaction) => {
        const reference = sessions().doc(input.sessionId);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) {
          invalidSession();
        }
        const session = parseSession(snapshot.id, snapshot.data());
        if (session.leaseToken !== input.leaseToken) {
          invalidSession();
        }
        const next: RatingAdminRadiusSession = Object.freeze({
          ...session,
          state: input.state,
          ranges: Object.freeze([...input.ranges]),
          lastUsedAtMs: input.nowMs,
          idleExpiresAtMs: Math.min(
            input.nowMs + ratingAdminRadiusIdleLifetimeMs,
            session.absoluteExpiresAtMs,
          ),
          leaseToken: null,
          leaseUntilMs: null,
          lastCompletedRequestId: input.clientRequestId,
          scannedDocumentCount: session.scannedDocumentCount + input.documentsRead,
          resultCount: input.resultCount,
        });
        transaction.set(reference, sessionWrite(next));
        return next;
      });
    },
    async failAdvance(input) {
      await firestore.runTransaction(async (transaction) => {
        const reference = sessions().doc(input.sessionId);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) {
          return;
        }
        const session = parseSession(snapshot.id, snapshot.data());
        if (session.leaseToken !== input.leaseToken) {
          return;
        }
        transaction.set(reference, sessionWrite(Object.freeze({
          ...session,
          state: "failed",
          failureMessage: "Nearby restaurant search preparation failed.",
          leaseToken: null,
          leaseUntilMs: null,
          lastCompletedRequestId: input.clientRequestId,
          lastUsedAtMs: input.nowMs,
          idleExpiresAtMs: Math.min(
            input.nowMs + ratingAdminRadiusIdleLifetimeMs,
            session.absoluteExpiresAtMs,
          ),
        })));
      });
    },
    async queryResults(input) {
      let query: Query<DocumentData, DocumentData> = applyOrders(
        sessions().doc(input.sessionId).collection(ratingAdminRadiusResultSubcollection),
        input.orders,
      );
      if (input.cursor?.kind === "startAfter") {
        query = query.startAfter(...input.cursor.values);
      } else if (input.cursor?.kind === "endBefore") {
        query = query.endBefore(...input.cursor.values);
      }
      query = input.limitToLast === true
        ? query.limitToLast(input.limit)
        : query.limit(input.limit);
      const snapshot = await query.get();
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data() as Readonly<Record<string, unknown>>,
      }));
    },
    async countResults(sessionId) {
      const snapshot = await sessions()
        .doc(sessionId)
        .collection(ratingAdminRadiusResultSubcollection)
        .count()
        .get();
      return snapshot.data().count;
    },
  };
}

type RadiusCriteria = Readonly<{
  locationQuery: string;
  radiusMiles: number;
  status: "all" | "active" | "inactive";
  restaurantName: RatingAdminNormalizedNameCriteria;
  fingerprintCriteria: Readonly<Record<string, unknown>>;
}>;

function parseRadiusCriteria(criteria: Readonly<Record<string, unknown>>): RadiusCriteria {
  requireExactKeys(
    criteria,
    ["mode", "locationQuery", "radiusMiles", "status"],
    ["restaurantName", "searchInstanceId"],
  );
  if (criteria.mode !== "nearbyRadius") {
    invalidCriteria("The restaurant search mode is invalid.");
  }
  const locationQuery = normalizedLocation(criteria.locationQuery);
  const radiusMiles = requireRadius(criteria.radiusMiles);
  const status = criteria.status;
  if (status !== "all" && status !== "active" && status !== "inactive") {
    invalidCriteria("The Rating status is invalid.");
  }
  const restaurantName = normalizeRatingAdminNameCriteria(criteria.restaurantName);
  const searchInstanceId = criteria.searchInstanceId;
  if (
    searchInstanceId !== undefined &&
    (typeof searchInstanceId !== "number" ||
      !Number.isSafeInteger(searchInstanceId) ||
      searchInstanceId < 1)
  ) {
    invalidCriteria("The restaurant search instance is invalid.");
  }
  return Object.freeze({
    locationQuery,
    radiusMiles,
    status,
    restaurantName,
    fingerprintCriteria: Object.freeze({
      mode: "nearbyRadius",
      locationQuery,
      radiusMiles,
      status,
      ...(searchInstanceId === undefined ? {} : { searchInstanceId }),
      ...(restaurantName.normalizedName === null
        ? {}
        : { restaurantName: restaurantName.normalizedName }),
    }),
  });
}

function isExpired(session: RatingAdminRadiusSession, nowMs: number): boolean {
  return nowMs >= session.idleExpiresAtMs || nowMs >= session.absoluteExpiresAtMs;
}

function preparationCursor(
  session: RatingAdminRadiusSession,
  parsed: ReturnType<typeof createRatingAdminParsedRestaurantContext>,
): string {
  return parsed.codec.encode({
    queryFingerprint: session.queryFingerprint,
    source: "ratingAdminRestaurants",
    searchMode: "nearbyRadius",
    pageSize: ratingAdminRestaurantPageSize,
    purpose: "forward",
    sortTuple: [1],
    callerBinding: parsed.callerBinding,
    sessionId: session.id,
    lifetimeMs: ratingAdminRadiusIdleLifetimeMs,
  });
}

function preparingResponse(
  session: RatingAdminRadiusSession,
  parsed: ReturnType<typeof createRatingAdminParsedRestaurantContext>,
): Readonly<Record<string, unknown>> {
  const completedUnits = session.ranges.filter((range) => range.exhausted).length;
  const failed = session.state === "failed";
  const nextCursor = failed ? undefined : preparationCursor(session, parsed);
  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    items: [],
    pageSize: ratingAdminRestaurantPageSize,
    hasNext: !failed,
    hasPrevious: false,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    currentPageNumber: 1,
    total: { state: "unknown" as const },
    queryFingerprint: session.queryFingerprint,
    snapshotTimestampMs: parsed.nowMs,
    capabilities: {
      first: false,
      previous: false,
      numberedVisitedPages: true,
      next: !failed,
      last: false,
    },
    preparation: {
      state: failed ? "failed" as const : "preparing" as const,
      completedUnits,
      totalUnits: session.ranges.length,
      message: failed
        ? "Nearby restaurant search preparation failed."
        : "Preparing complete nearby results…",
    },
  });
}

function resultCursorValues(document: RatingAdminDocument): readonly [number, string, string] {
  const distance = readInteger(document.data.distanceMillimeters);
  const normalizedName = readString(document.data.normalizedName, 200);
  const sourceDocumentId = readString(document.data.sourceDocumentId, 1_500);
  if (distance === null || normalizedName === null || sourceDocumentId === null) {
    invalidSession();
  }
  return [distance, normalizedName, sourceDocumentId];
}

function pageNumber(tuple: readonly unknown[]): number {
  const value = tuple[tuple.length - 1];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    invalidSession();
  }
  return value;
}

function sourceProjection(
  document: RatingAdminDocument,
  distanceMillimeters: number,
  status: "all" | "active" | "inactive",
): Readonly<Record<string, unknown>> | null {
  return ratingAdminRestaurantProjection(
    document,
    distanceMillimeters / (KILOMETERS_PER_MILE * 1_000_000),
    status,
  );
}

async function readyPage(input: Readonly<{
  session: RatingAdminRadiusSession;
  parsed: ReturnType<typeof createRatingAdminParsedRestaurantContext>;
  pagingDatabase: RatingAdminPagingDatabase;
  store: RatingAdminRadiusStore;
  decodedTuple: readonly unknown[] | null;
}>): Promise<Readonly<Record<string, unknown>>> {
  const { session, parsed, store } = input;
  const direction = parsed.request.direction;
  const total = session.resultCount ?? invalidSession();
  let currentPageNumber = direction === "last"
    ? Math.max(1, Math.ceil(total / ratingAdminRestaurantPageSize))
    : input.decodedTuple === null ? 1 : pageNumber(input.decodedTuple);
  const cursorValues = input.decodedTuple === null
    ? undefined
    : input.decodedTuple.slice(0, 3);
  const documents = await store.queryResults({
    sessionId: session.id,
    orders: [
      { field: "distanceMillimeters", direction: "asc" },
      { field: "normalizedName", direction: "asc" },
      { field: "sourceDocumentId", direction: "asc" },
    ],
    ...(cursorValues === undefined ? {} : {
      cursor: {
        kind: direction === "backward" ? "endBefore" as const : "startAfter" as const,
        values: cursorValues,
      },
    }),
    limit: direction === "last"
      ? Math.max(1, total % ratingAdminRestaurantPageSize || ratingAdminRestaurantPageSize)
      : ratingAdminRestaurantPageSize + 1,
    ...(direction === "backward" || direction === "last" ? { limitToLast: true } : {}),
  });
  const selected = direction === "backward" || direction === "last"
    ? documents.slice(Math.max(0, documents.length - ratingAdminRestaurantPageSize))
    : documents.slice(0, ratingAdminRestaurantPageSize);
  if (direction === "backward" && input.decodedTuple !== null) {
    currentPageNumber = pageNumber(input.decodedTuple);
  }
  const sourceIds = selected.map((document) => resultCursorValues(document)[2]);
  const sources = await input.pagingDatabase.getDocuments(
    sourceIds.map((id) => `bitescore_restaurants/${id}`),
  );
  const byId = new Map(sources.map((document) => [document.id, document]));
  const items = selected.flatMap((result) => {
    const [distance, , id] = resultCursorValues(result);
    const source = byId.get(id);
    const projected = source === undefined
      ? null
      : sourceProjection(source, distance, input.session.status);
    return projected === null ? [] : [projected];
  });
  const hasPrevious = currentPageNumber > 1;
  const hasNext = direction === "last"
    ? false
    : direction === "backward"
      ? true
      : documents.length > ratingAdminRestaurantPageSize;
  const first = selected[0];
  const last = selected[selected.length - 1];
  const encode = (
    document: RatingAdminDocument,
    purpose: "forward" | "backward",
    number: number,
  ): string => parsed.codec.encode({
    queryFingerprint: session.queryFingerprint,
    source: "ratingAdminRestaurants",
    searchMode: "nearbyRadius",
    pageSize: ratingAdminRestaurantPageSize,
    purpose,
    sortTuple: [...resultCursorValues(document), number],
    callerBinding: parsed.callerBinding,
    sessionId: session.id,
    lifetimeMs: ratingAdminRadiusIdleLifetimeMs,
  });
  const nextCursor = hasNext && last !== undefined
    ? encode(last, "forward", currentPageNumber + 1)
    : undefined;
  const previousCursor = hasPrevious && first !== undefined
    ? encode(first, "backward", currentPageNumber - 1)
    : undefined;
  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    items,
    pageSize: ratingAdminRestaurantPageSize,
    hasNext,
    hasPrevious,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(previousCursor === undefined ? {} : { previousCursor }),
    currentPageNumber,
    total: { state: "exact" as const, value: total },
    queryFingerprint: session.queryFingerprint,
    snapshotTimestampMs: parsed.nowMs,
    capabilities: {
      first: currentPageNumber > 1,
      previous: hasPrevious,
      numberedVisitedPages: true,
      next: hasNext,
      last: currentPageNumber < Math.max(1, Math.ceil(total / ratingAdminRestaurantPageSize)),
    },
    preparation: {
      state: "ready" as const,
      completedUnits: session.ranges.length,
      totalUnits: session.ranges.length,
    },
  });
}

export type RatingAdminRadiusHandlerContext = RatingAdminHandlerContext & Readonly<{
  radiusStore: RatingAdminRadiusStore;
  geocodeLocation: (locationQuery: string) => Promise<RadiusCenter>;
  sessionIdSource?: () => string;
  leaseTokenSource?: () => string;
}>;

function randomIdentifier(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

async function advanceSession(input: Readonly<{
  session: RatingAdminRadiusSession;
  parsed: ReturnType<typeof createRatingAdminParsedRestaurantContext>;
  context: RatingAdminRadiusHandlerContext;
}>): Promise<RatingAdminRadiusSession> {
  const leaseToken = input.context.leaseTokenSource?.() ?? randomIdentifier("lease");
  const claim = await input.context.radiusStore.claimSession({
    sessionId: input.session.id,
    callerBinding: input.parsed.callerBinding,
    queryFingerprint: input.session.queryFingerprint,
    clientRequestId: input.parsed.request.clientRequestId,
    leaseToken,
    nowMs: input.parsed.nowMs,
  });
  if (claim.status !== "claimed" || claim.session.state !== "preparing") {
    return claim.session;
  }
  let remaining = ratingAdminRadiusReadBudget;
  let documentsRead = 0;
  const ranges = [...claim.session.ranges];
  const results = new Map<string, RatingAdminRadiusResult>();
  const nameCriteria: RatingAdminNormalizedNameCriteria = {
    normalizedName: claim.session.normalizedName,
    words: claim.session.nameWords,
    anchor: claim.session.nameAnchor,
    requiresPostFilter: claim.session.nameWords.length > 1,
  };
  try {
    for (let rangeIndex = 0; rangeIndex < ranges.length && remaining > 0; rangeIndex += 1) {
      let range = ranges[rangeIndex];
      while (!range.exhausted && remaining > 0) {
        const limit = Math.min(ratingAdminRadiusRangeChunkSize, remaining);
        const filters: RatingAdminFilter[] = [
          { field: "source", operation: "==", value: "biteScore" },
          { field: "adminDirectoryVisible", operation: "==", value: true },
          { field: "geohash", operation: ">=", value: range.start },
          { field: "geohash", operation: "<=", value: range.end },
        ];
        if (claim.session.status !== "all") {
          filters.push({
            field: "isActive",
            operation: "==",
            value: claim.session.status === "active",
          });
        }
        if (claim.session.nameAnchor !== null) {
          filters.push({
            field: "namePrefixTokens",
            operation: "array-contains",
            value: claim.session.nameAnchor,
          });
        }
        const candidates = await input.context.database.queryDocuments({
          collectionPath: "restaurant_search_index",
          filters,
          orders: [
            { field: "geohash", direction: "asc" },
            { field: "sourceDocumentId", direction: "asc" },
          ],
          ...(range.afterGeohash === null ? {} : {
            cursor: {
              kind: "startAfter" as const,
              values: [range.afterGeohash, range.afterDocumentId],
            },
          }),
          limit,
        });
        documentsRead += candidates.length;
        remaining -= candidates.length;
        for (const candidate of candidates) {
          const sourceDocumentId = readString(candidate.data.sourceDocumentId, 1_500);
          const normalizedName = readString(candidate.data.normalizedName, 200);
          const coordinates = extractBiteScoreRestaurantCoordinates(
            candidate.data as Record<string, unknown>,
          );
          if (
            sourceDocumentId === null || normalizedName === null || coordinates === null ||
            !matchesRatingAdminNameWords(candidate.data, nameCriteria)
          ) {
            continue;
          }
          const distanceKilometers = exactRestaurantDistanceKilometers(
            claim.session.center,
            coordinates,
          );
          if (distanceKilometers > claim.session.radiusMiles * KILOMETERS_PER_MILE) {
            continue;
          }
          const distanceMillimeters = Math.round(distanceKilometers * 1_000_000);
          if (!Number.isSafeInteger(distanceMillimeters)) {
            continue;
          }
          const id = createHash("sha256")
            .update(JSON.stringify(["biteScore", sourceDocumentId]), "utf8")
            .digest("hex");
          results.set(id, Object.freeze({
            id,
            sourceDocumentId,
            distanceMillimeters,
            normalizedName,
            expiresAtMs: claim.session.absoluteExpiresAtMs,
          }));
        }
        const last = candidates[candidates.length - 1];
        const lastGeohash = last === undefined ? null : readString(last.data.geohash, 32);
        const lastId = last === undefined ? null : readString(last.data.sourceDocumentId, 1_500);
        const exhausted = candidates.length < limit;
        if (!exhausted && (lastGeohash === null || lastId === null)) {
          invalidSession();
        }
        range = Object.freeze({
          ...range,
          afterGeohash: lastGeohash ?? range.afterGeohash,
          afterDocumentId: lastId ?? range.afterDocumentId,
          exhausted,
        });
        ranges[rangeIndex] = range;
        if (candidates.length === 0) {
          break;
        }
      }
    }
    await input.context.radiusStore.writeResults(claim.session.id, [...results.values()]);
    const ready = ranges.every((range) => range.exhausted);
    const resultCount = ready
      ? await input.context.radiusStore.countResults(claim.session.id)
      : null;
    return input.context.radiusStore.finishAdvance({
      sessionId: claim.session.id,
      leaseToken,
      clientRequestId: input.parsed.request.clientRequestId,
      nowMs: input.parsed.nowMs,
      ranges: Object.freeze(ranges),
      documentsRead,
      state: ready ? "ready" : "preparing",
      resultCount,
    });
  } catch (error) {
    await input.context.radiusStore.failAdvance({
      sessionId: claim.session.id,
      leaseToken,
      clientRequestId: input.parsed.request.clientRequestId,
      nowMs: input.parsed.nowMs,
    });
    throw error;
  }
}

export async function searchRatingAdminRadiusRestaurantsPage(
  rawRequest: unknown,
  context: RatingAdminRadiusHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = createRatingAdminParsedRestaurantContext(rawRequest, context);
  const criteria = parseRadiusCriteria(parsed.request.criteria);
  const queryFingerprint = createQueryFingerprint(criteria.fingerprintCriteria);
  let session: RatingAdminRadiusSession | null = null;
  let decodedTuple: readonly unknown[] | null = null;

  if (parsed.request.cursor !== undefined) {
    try {
      const decoded = parsed.codec.decode(parsed.request.cursor, {
        queryFingerprint,
        source: "ratingAdminRestaurants",
        searchMode: "nearbyRadius",
        pageSize: ratingAdminRestaurantPageSize,
        callerBinding: parsed.callerBinding,
        purposes: [parsed.request.direction === "backward" ? "backward" : "forward"],
      });
      if (decoded.sessionId === undefined) {
        invalidSession();
      }
      decodedTuple = decoded.sortTuple;
      session = await context.radiusStore.getSession(decoded.sessionId);
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }
      invalidSession();
    }
  } else if (
    parsed.request.direction === "last" ||
    parsed.request.direction === "first"
  ) {
    session = await context.radiusStore.getActiveSession(
      activeKey(parsed.callerBinding, queryFingerprint),
    );
  }
  if (session === null && parsed.request.direction !== "last") {
    const center = await context.geocodeLocation(criteria.locationQuery);
    const bounds = restaurantGeographicQueryBounds(
      center,
      criteria.radiusMiles * KILOMETERS_PER_MILE,
    );
    if (bounds.length === 0 || bounds.length > ratingAdminRadiusMaximumRanges) {
      throw new HttpsError(
        "failed-precondition",
        "Nearby restaurant search could not create a bounded search plan.",
      );
    }
    const id = context.sessionIdSource?.() ?? randomIdentifier("cars");
    const ranges = bounds.map(([start, end]): RadiusRange => Object.freeze({
      start,
      end,
      afterGeohash: null,
      afterDocumentId: null,
      exhausted: false,
    }));
    session = Object.freeze({
      id,
      schemaVersion: 1,
      state: "preparing",
      callerBinding: parsed.callerBinding,
      queryFingerprint,
      source: "biteScore",
      searchMode: "nearbyRadius",
      pageSize: ratingAdminRestaurantPageSize,
      center,
      radiusMiles: criteria.radiusMiles,
      status: criteria.status,
      normalizedName: criteria.restaurantName.normalizedName,
      nameWords: criteria.restaurantName.words,
      nameAnchor: criteria.restaurantName.anchor,
      ranges: Object.freeze(ranges),
      createdAtMs: parsed.nowMs,
      lastUsedAtMs: parsed.nowMs,
      idleExpiresAtMs: parsed.nowMs + ratingAdminRadiusIdleLifetimeMs,
      absoluteExpiresAtMs: parsed.nowMs + ratingAdminRadiusAbsoluteLifetimeMs,
      leaseToken: null,
      leaseUntilMs: null,
      lastCompletedRequestId: null,
      scannedDocumentCount: 0,
      resultCount: null,
      failureMessage: null,
    });
    await context.radiusStore.createSession(session);
  }

  if (
    session === null ||
    session.callerBinding !== parsed.callerBinding ||
    session.queryFingerprint !== queryFingerprint ||
    isExpired(session, parsed.nowMs)
  ) {
    invalidSession();
  }
  if (session.state === "failed") {
    return preparingResponse(session, parsed);
  }
  if (session.state === "preparing") {
    session = await advanceSession({ session, parsed, context });
  }
  if (session.state === "ready") {
    session = await context.radiusStore.touchReadySession({
      sessionId: session.id,
      activeKey: activeKey(parsed.callerBinding, queryFingerprint),
      callerBinding: parsed.callerBinding,
      queryFingerprint,
      nowMs: parsed.nowMs,
    });
    return readyPage({
        session,
        parsed,
        pagingDatabase: context.database,
        store: context.radiusStore,
        decodedTuple: session.state === "ready" && decodedTuple?.length === 1
          ? null
          : decodedTuple,
      });
  }
  return preparingResponse(session, parsed);
}
