import { createHash, randomBytes } from "node:crypto";
import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type Query,
  Timestamp,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  adminLinkRestaurantCursorSource,
  adminLinkRestaurantFingerprintCriteria,
  adminLinkRestaurantPageSize,
  type AdminLinkRestaurantPageContext,
  type AdminLinkRestaurantParsedContext,
  adminLinkRestaurantSearchMode,
  createAdminLinkRestaurantParsedContext,
} from "./admin_link_restaurant_paging.js";
import {
  type AdminCatalogBindingVerificationRequest,
  type AdminRestaurantQueryDocument,
  type AdminRestaurantSearchCandidate,
  type AdminRestaurantSource,
  buildAdminRestaurantQueryPlans,
  normalizeAdminRestaurantName,
  readNormalizedAdminRestaurantNameFilter,
  rehydrateAdminRestaurantSearchPage,
  resolveAdminRestaurantSearchCenter,
  processAdminRestaurantSearchCandidates,
  type ResolvedAdminRestaurantSearchCenter,
} from "./admin_restaurant_search_helpers.js";
import { pageProtocolVersion } from "./pagination_protocol.js";
import { createQueryFingerprint } from "./query_fingerprint.js";
import { readBiteScoreCatalogRestaurantId } from "./restaurant_invite_helpers.js";

export const adminLinkRestaurantSessionCollection =
  "private_admin_link_restaurant_search_sessions";
export const adminLinkRestaurantActiveCollection =
  "private_admin_link_restaurant_search_active_sessions";
export const adminLinkRestaurantResultSubcollection = "results";
export const adminLinkRestaurantReadBudget = 450;
export const adminLinkRestaurantMaximumAdvanceWrites =
  adminLinkRestaurantReadBudget + 3;
export const adminLinkRestaurantRangeChunkSize = 25;
export const adminLinkRestaurantMaximumRangesPerSource = 9;
export const adminLinkRestaurantMaximumRanges = 18;
export const adminLinkRestaurantMaximumNormalizedNameLength = 200;
export const adminLinkRestaurantIdleLifetimeMs = 15 * 60 * 1_000;
export const adminLinkRestaurantAbsoluteLifetimeMs = 60 * 60 * 1_000;
export const adminLinkRestaurantLeaseLifetimeMs = 30 * 1_000;

type SessionRange = Readonly<{
  source: AdminRestaurantSource;
  collectionName: "bitescore_restaurants" | "restaurant_accounts";
  start: string;
  end: string;
  biteScoreIsActive: boolean | null;
  afterGeohash: string | null;
  afterDocumentId: string | null;
  exhausted: boolean;
}>;

export type AdminLinkRestaurantSession = Readonly<{
  id: string;
  schemaVersion: 1;
  orderingVersion: 1;
  state: "preparing" | "ready" | "failed";
  callerBinding: string;
  queryFingerprint: string;
  searchInstanceHash: string;
  pageSize: 50;
  center: ResolvedAdminRestaurantSearchCenter;
  centerInput: Readonly<Record<string, unknown>>;
  radiusMiles: number;
  normalizedRestaurantName: string | null;
  sources: readonly AdminRestaurantSource[];
  biteScoreStatus: "active" | "inactive" | "all";
  ranges: readonly SessionRange[];
  createdAtMs: number;
  lastUsedAtMs: number;
  idleExpiresAtMs: number;
  absoluteExpiresAtMs: number;
  leaseToken: string | null;
  leaseUntilMs: number | null;
  leaseGeneration: number;
  lastCompletedRequestId: string | null;
  scannedDocumentCount: number;
  failureMessage: string | null;
}>;

export type AdminLinkRestaurantMaterializedResult = Readonly<{
  id: string;
  source: AdminRestaurantSource;
  sourceDocumentId: string;
  distanceMillimeters: number;
  normalizedName: string;
  expiresAtMs: number;
}>;

export type AdminLinkRestaurantMaterializedOrder = Readonly<{
  distanceMillimeters: number;
  normalizedName: string;
  sourceDocumentId: string;
  source: AdminRestaurantSource;
}>;

type StoredDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

type ClaimResult = Readonly<{
  status: "claimed" | "busy" | "duplicate";
  session: AdminLinkRestaurantSession;
}>;

export interface AdminLinkRestaurantRadiusStore {
  acquireInitialSession(input: Readonly<{
    activeKey: string;
    session: AdminLinkRestaurantSession;
    nowMs: number;
  }>): Promise<AdminLinkRestaurantSession>;
  getSession(sessionId: string): Promise<AdminLinkRestaurantSession | null>;
  claimSession(input: Readonly<{
    sessionId: string;
    callerBinding: string;
    queryFingerprint: string;
    clientRequestId: string;
    leaseToken: string;
    nowMs: number;
  }>): Promise<ClaimResult>;
  touchReadySession(input: Readonly<{
    sessionId: string;
    activeKey: string;
    callerBinding: string;
    queryFingerprint: string;
    nowMs: number;
  }>): Promise<AdminLinkRestaurantSession>;
  queryCandidates(input: Readonly<{
    range: SessionRange;
    limit: number;
  }>): Promise<readonly AdminRestaurantQueryDocument[]>;
  finishAdvance(input: Readonly<{
    sessionId: string;
    leaseToken: string;
    leaseGeneration: number;
    clientRequestId: string;
    ranges: readonly SessionRange[];
    documentsRead: number;
    state: "preparing" | "ready";
    results: readonly AdminLinkRestaurantMaterializedResult[];
  }>): Promise<AdminLinkRestaurantSession>;
  failAdvance(input: Readonly<{
    sessionId: string;
    leaseToken: string;
    leaseGeneration: number;
    clientRequestId: string;
  }>): Promise<void>;
  queryResults(input: Readonly<{
    sessionId: string;
    after?: readonly [number, string, string, AdminRestaurantSource];
    limit: number;
  }>): Promise<readonly StoredDocument[]>;
  getSourceDocuments(
    identities: readonly Readonly<{
      source: AdminRestaurantSource;
      documentId: string;
    }>[],
  ): Promise<readonly AdminRestaurantSearchCandidate[]>;
}

export type AdminLinkRestaurantHandlerContext =
  AdminLinkRestaurantPageContext & Readonly<{
    store: AdminLinkRestaurantRadiusStore;
    getGeocodingApiKey: () => string;
    fetchGeocoding: typeof fetch;
    verifyBiteSaverCatalogBindings?: (
      requests: readonly AdminCatalogBindingVerificationRequest[],
    ) => Promise<ReadonlySet<string>>;
    loadQrPreparationDocuments?: (
      catalogRestaurantIds: readonly string[],
    ) => Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>;
    loadQrPreparationInvitationDocuments?: (
      invitationIds: readonly string[],
    ) => Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>;
    sessionIdSource?: () => string;
    leaseTokenSource?: () => string;
  }>;

function invalidSession(): never {
  throw new HttpsError(
    "failed-precondition",
    "This search expired. Run it again to see current results.",
  );
}

function readString(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" && value.length > 0 &&
      value.length <= maximumLength
    ? value
    : null;
}

function readNormalizedOrderingName(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > adminLinkRestaurantMaximumNormalizedNameLength ||
    normalizeAdminRestaurantName(value) !== value
  ) {
    return null;
  }
  return value;
}

function readInteger(value: unknown, minimum = 0): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) &&
      value >= minimum
    ? value
    : null;
}

function timestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as { toMillis?: () => unknown };
    const millis = candidate.toMillis?.();
    return typeof millis === "number" && Number.isSafeInteger(millis) &&
        millis >= 0
      ? millis
      : null;
  }
  return null;
}

function parseCenter(value: unknown): ResolvedAdminRestaurantSearchCenter | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const data = value as Record<string, unknown>;
  const latitude = data.latitude;
  const longitude = data.longitude;
  const displayName = readString(data.displayName, 500);
  if (
    typeof latitude !== "number" || !Number.isFinite(latitude) ||
    latitude < -90 || latitude > 90 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) ||
    longitude < -180 || longitude > 180 || displayName === null
  ) {
    return null;
  }
  return Object.freeze({ latitude, longitude, displayName });
}

function parseSources(value: unknown): readonly AdminRestaurantSource[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    return null;
  }
  const sources: AdminRestaurantSource[] = [];
  for (const entry of value) {
    if (
      (entry !== "biteScore" && entry !== "biteSaver") ||
      sources.includes(entry)
    ) {
      return null;
    }
    sources.push(entry);
  }
  return Object.freeze(sources);
}

function parseRanges(value: unknown): readonly SessionRange[] | null {
  if (!Array.isArray(value) || value.length < 1 ||
      value.length > adminLinkRestaurantMaximumRanges) {
    return null;
  }
  const ranges: SessionRange[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const data = entry as Record<string, unknown>;
    const source = data.source;
    const collectionName = data.collectionName;
    const start = readString(data.start, 32);
    const end = readString(data.end, 32);
    const afterGeohash = data.afterGeohash === null
      ? null
      : readString(data.afterGeohash, 32);
    const afterDocumentId = data.afterDocumentId === null
      ? null
      : readBiteScoreCatalogRestaurantId(data.afterDocumentId);
    if (
      (source !== "biteScore" && source !== "biteSaver") ||
      collectionName !== (source === "biteScore"
        ? "bitescore_restaurants"
        : "restaurant_accounts") ||
      start === null || end === null || start > end ||
      (data.biteScoreIsActive !== null &&
        typeof data.biteScoreIsActive !== "boolean") ||
      (source === "biteSaver" && data.biteScoreIsActive !== null) ||
      typeof data.exhausted !== "boolean" ||
      ((afterGeohash === null) !== (afterDocumentId === null))
    ) {
      return null;
    }
    ranges.push(Object.freeze({
      source,
      collectionName: collectionName as SessionRange["collectionName"],
      start,
      end,
      biteScoreIsActive: data.biteScoreIsActive as boolean | null,
      afterGeohash,
      afterDocumentId,
      exhausted: data.exhausted,
    }));
  }
  return Object.freeze(ranges);
}

function parseSession(
  id: string,
  value: unknown,
): AdminLinkRestaurantSession {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidSession();
  }
  const data = value as Record<string, unknown>;
  const center = parseCenter(data.center);
  const sources = parseSources(data.sources);
  const ranges = parseRanges(data.ranges);
  const createdAtMs = timestampMs(data.createdAtMs);
  const lastUsedAtMs = timestampMs(data.lastUsedAtMs);
  const idleExpiresAtMs = timestampMs(data.idleExpiresAtMs);
  const absoluteExpiresAtMs = timestampMs(data.absoluteExpiresAtMs);
  const leaseUntilMs = data.leaseUntilMs === null
    ? null
    : timestampMs(data.leaseUntilMs);
  const normalizedRestaurantName = data.normalizedRestaurantName === null
    ? null
    : readNormalizedAdminRestaurantNameFilter(data.normalizedRestaurantName);
  const radiusMiles = data.radiusMiles;
  if (
    data.schemaVersion !== 1 || data.orderingVersion !== 1 ||
    (data.state !== "preparing" && data.state !== "ready" &&
      data.state !== "failed") ||
    readString(data.callerBinding, 64) === null ||
    readString(data.queryFingerprint, 64) === null ||
    readString(data.searchInstanceHash, 64) === null ||
    data.pageSize !== adminLinkRestaurantPageSize || center === null ||
    data.centerInput === null || typeof data.centerInput !== "object" ||
    Array.isArray(data.centerInput) ||
    typeof radiusMiles !== "number" || !Number.isFinite(radiusMiles) ||
    radiusMiles <= 0 || radiusMiles > 50 ||
    (data.normalizedRestaurantName !== null &&
      normalizedRestaurantName === null) ||
    sources === null ||
    (data.biteScoreStatus !== "active" &&
      data.biteScoreStatus !== "inactive" && data.biteScoreStatus !== "all") ||
    ranges === null || createdAtMs === null || lastUsedAtMs === null ||
    idleExpiresAtMs === null || absoluteExpiresAtMs === null ||
    (data.leaseToken !== null && readString(data.leaseToken, 128) === null) ||
    (data.leaseToken === null) !== (leaseUntilMs === null) ||
    readInteger(data.leaseGeneration) === null ||
    (data.lastCompletedRequestId !== null &&
      readString(data.lastCompletedRequestId, 128) === null) ||
    readInteger(data.scannedDocumentCount) === null ||
    (data.failureMessage !== null && readString(data.failureMessage, 500) === null)
  ) {
    invalidSession();
  }
  return Object.freeze({
    id,
    schemaVersion: 1,
    orderingVersion: 1,
    state: data.state as AdminLinkRestaurantSession["state"],
    callerBinding: data.callerBinding as string,
    queryFingerprint: data.queryFingerprint as string,
    searchInstanceHash: data.searchInstanceHash as string,
    pageSize: adminLinkRestaurantPageSize,
    center,
    centerInput: Object.freeze({ ...(data.centerInput as Record<string, unknown>) }),
    radiusMiles,
    normalizedRestaurantName,
    sources,
    biteScoreStatus: data.biteScoreStatus as AdminLinkRestaurantSession["biteScoreStatus"],
    ranges,
    createdAtMs,
    lastUsedAtMs,
    idleExpiresAtMs,
    absoluteExpiresAtMs,
    leaseToken: data.leaseToken as string | null,
    leaseUntilMs,
    leaseGeneration: data.leaseGeneration as number,
    lastCompletedRequestId: data.lastCompletedRequestId as string | null,
    scannedDocumentCount: data.scannedDocumentCount as number,
    failureMessage: data.failureMessage as string | null,
  });
}

function sessionWrite(session: AdminLinkRestaurantSession): Record<string, unknown> {
  return {
    schemaVersion: session.schemaVersion,
    orderingVersion: session.orderingVersion,
    state: session.state,
    callerBinding: session.callerBinding,
    queryFingerprint: session.queryFingerprint,
    searchInstanceHash: session.searchInstanceHash,
    pageSize: session.pageSize,
    center: session.center,
    centerInput: session.centerInput,
    radiusMiles: session.radiusMiles,
    normalizedRestaurantName: session.normalizedRestaurantName,
    sources: session.sources,
    biteScoreStatus: session.biteScoreStatus,
    ranges: session.ranges,
    createdAtMs: session.createdAtMs,
    lastUsedAtMs: session.lastUsedAtMs,
    idleExpiresAtMs: session.idleExpiresAtMs,
    absoluteExpiresAtMs: session.absoluteExpiresAtMs,
    leaseToken: session.leaseToken,
    leaseUntilMs: session.leaseUntilMs,
    leaseGeneration: session.leaseGeneration,
    lastCompletedRequestId: session.lastCompletedRequestId,
    scannedDocumentCount: session.scannedDocumentCount,
    failureMessage: session.failureMessage,
    expiresAt: Timestamp.fromMillis(Math.min(
      session.idleExpiresAtMs,
      session.absoluteExpiresAtMs,
    )),
  };
}

function activeKey(
  callerBinding: string,
  queryFingerprint: string,
  searchInstanceHash: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([callerBinding, queryFingerprint, searchInstanceHash]),
      "utf8",
    )
    .digest("hex");
}

function completedAdvanceRequestMarkerId(clientRequestId: string): string {
  return `request_${createHash("sha256")
    .update(JSON.stringify([
      "adminLinkRestaurantCompletedAdvanceRequest",
      1,
      clientRequestId,
    ]), "utf8")
    .digest("hex")}`;
}

function activePointerWrite(
  session: AdminLinkRestaurantSession,
  expiresAtMs: number,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    sessionId: session.id,
    callerBinding: session.callerBinding,
    queryFingerprint: session.queryFingerprint,
    searchInstanceHash: session.searchInstanceHash,
    expiresAt: Timestamp.fromMillis(expiresAtMs),
  });
}

function canRefreshActivePointer(
  value: unknown,
  session: AdminLinkRestaurantSession,
  nowMs: number,
): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const data = value as Record<string, unknown>;
  if (
    data.sessionId === session.id &&
    data.callerBinding === session.callerBinding &&
    data.queryFingerprint === session.queryFingerprint &&
    data.searchInstanceHash === session.searchInstanceHash
  ) {
    return true;
  }
  const expiresAtMs = timestampMs(data.expiresAt);
  return expiresAtMs !== null && expiresAtMs <= nowMs;
}

function expired(session: AdminLinkRestaurantSession, nowMs: number): boolean {
  return nowMs >= session.idleExpiresAtMs || nowMs >= session.absoluteExpiresAtMs;
}

export function createFirestoreAdminLinkRestaurantRadiusStore(
  firestore: Firestore,
  now: () => number = Date.now,
): AdminLinkRestaurantRadiusStore {
  const sessions = () => firestore.collection(adminLinkRestaurantSessionCollection);
  const active = () => firestore.collection(adminLinkRestaurantActiveCollection);
  const freshNowMs = (readTime?: Timestamp): number => {
    const value = readTime?.toMillis() ?? now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("The Admin Link session clock is invalid.");
    }
    return value;
  };
  return {
    async acquireInitialSession(input) {
      return firestore.runTransaction(async (transaction) => {
        const activeReference = active().doc(input.activeKey);
        const activeSnapshot = await transaction.get(activeReference);
        let existing: AdminLinkRestaurantSession | null = null;
        if (
          activeSnapshot.exists &&
          activeSnapshot.data()?.callerBinding === input.session.callerBinding &&
          activeSnapshot.data()?.queryFingerprint === input.session.queryFingerprint &&
          activeSnapshot.data()?.searchInstanceHash ===
            input.session.searchInstanceHash
        ) {
          const sessionId = readString(activeSnapshot.data()?.sessionId, 128);
          if (sessionId !== null) {
            const sessionSnapshot = await transaction.get(sessions().doc(sessionId));
            if (sessionSnapshot.exists) {
              try {
                existing = parseSession(sessionSnapshot.id, sessionSnapshot.data());
              } catch (_error) {
                existing = null;
              }
            }
          }
        }
        if (
          existing !== null &&
          existing.callerBinding === input.session.callerBinding &&
          existing.queryFingerprint === input.session.queryFingerprint &&
          existing.searchInstanceHash === input.session.searchInstanceHash &&
          !expired(existing, input.nowMs)
        ) {
          transaction.set(activeReference, activePointerWrite(
            existing,
            Math.min(
              existing.idleExpiresAtMs,
              existing.absoluteExpiresAtMs,
            ),
          ));
          return existing;
        }
        transaction.create(
          sessions().doc(input.session.id),
          sessionWrite(input.session),
        );
        transaction.set(activeReference, activePointerWrite(
          input.session,
          Math.min(
            input.session.idleExpiresAtMs,
            input.session.absoluteExpiresAtMs,
          ),
        ));
        return input.session;
      });
    },
    async getSession(sessionId) {
      const snapshot = await sessions().doc(sessionId).get();
      return snapshot.exists ? parseSession(snapshot.id, snapshot.data()) : null;
    },
    async claimSession(input) {
      return firestore.runTransaction(async (transaction): Promise<ClaimResult> => {
        const reference = sessions().doc(input.sessionId);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) {
          invalidSession();
        }
        const session = parseSession(snapshot.id, snapshot.data());
        const claimNowMs = freshNowMs(snapshot.readTime);
        if (
          session.callerBinding !== input.callerBinding ||
          session.queryFingerprint !== input.queryFingerprint ||
          expired(session, claimNowMs)
        ) {
          invalidSession();
        }
        const requestMarker = await transaction.get(reference
          .collection(adminLinkRestaurantResultSubcollection)
          .doc(completedAdvanceRequestMarkerId(input.clientRequestId)));
        if (
          requestMarker.exists ||
          session.lastCompletedRequestId === input.clientRequestId
        ) {
          return Object.freeze({ status: "duplicate" as const, session });
        }
        if (session.leaseToken !== null && session.leaseUntilMs !== null &&
            session.leaseUntilMs > claimNowMs) {
          return Object.freeze({ status: "busy" as const, session });
        }
        if (session.leaseGeneration >= Number.MAX_SAFE_INTEGER) {
          invalidSession();
        }
        const idleExpiresAtMs = Math.min(
          claimNowMs + adminLinkRestaurantIdleLifetimeMs,
          session.absoluteExpiresAtMs,
        );
        const activeReference = active().doc(activeKey(
          session.callerBinding,
          session.queryFingerprint,
          session.searchInstanceHash,
        ));
        const activeSnapshot = await transaction.get(activeReference);
        if (!canRefreshActivePointer(
          activeSnapshot.exists ? activeSnapshot.data() : null,
          session,
          claimNowMs,
        )) {
          invalidSession();
        }
        const claimed = Object.freeze({
          ...session,
          leaseToken: input.leaseToken,
          leaseUntilMs: claimNowMs + adminLinkRestaurantLeaseLifetimeMs,
          leaseGeneration: session.leaseGeneration + 1,
          lastUsedAtMs: claimNowMs,
          idleExpiresAtMs,
        });
        transaction.update(reference, {
          leaseToken: claimed.leaseToken,
          leaseUntilMs: claimed.leaseUntilMs,
          leaseGeneration: claimed.leaseGeneration,
          lastUsedAtMs: claimed.lastUsedAtMs,
          idleExpiresAtMs,
          expiresAt: Timestamp.fromMillis(idleExpiresAtMs),
        });
        transaction.set(
          activeReference,
          activePointerWrite(claimed, idleExpiresAtMs),
        );
        return Object.freeze({ status: "claimed" as const, session: claimed });
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
        const touchNowMs = freshNowMs(snapshot.readTime);
        if (
          session.state !== "ready" ||
          session.callerBinding !== input.callerBinding ||
          session.queryFingerprint !== input.queryFingerprint ||
          expired(session, touchNowMs) ||
          input.activeKey !== activeKey(
            session.callerBinding,
            session.queryFingerprint,
            session.searchInstanceHash,
          )
        ) {
          invalidSession();
        }
        const activeReference = active().doc(input.activeKey);
        const activeSnapshot = await transaction.get(activeReference);
        if (!canRefreshActivePointer(
          activeSnapshot.exists ? activeSnapshot.data() : null,
          session,
          touchNowMs,
        )) {
          invalidSession();
        }
        const idleExpiresAtMs = Math.min(
          touchNowMs + adminLinkRestaurantIdleLifetimeMs,
          session.absoluteExpiresAtMs,
        );
        const next = Object.freeze({
          ...session,
          lastUsedAtMs: touchNowMs,
          idleExpiresAtMs,
        });
        transaction.update(reference, {
          lastUsedAtMs: touchNowMs,
          idleExpiresAtMs,
          expiresAt: Timestamp.fromMillis(idleExpiresAtMs),
        });
        transaction.set(
          activeReference,
          activePointerWrite(next, idleExpiresAtMs),
        );
        return next;
      });
    },
    async queryCandidates(input) {
      let query: Query<DocumentData, DocumentData> = firestore
        .collection(input.range.collectionName);
      if (input.range.biteScoreIsActive !== null) {
        query = query.where("isActive", "==", input.range.biteScoreIsActive);
      }
      query = query
        .where("geohash", ">=", input.range.start)
        .where("geohash", "<=", input.range.end)
        .orderBy("geohash", "asc")
        .orderBy(FieldPath.documentId(), "asc");
      if (input.range.afterGeohash !== null) {
        query = query.startAfter(
          input.range.afterGeohash,
          input.range.afterDocumentId,
        );
      }
      const snapshot = await query.limit(input.limit).get();
      return snapshot.docs.map((document) => Object.freeze({
        documentId: document.id,
        data: document.data(),
      }));
    },
    async finishAdvance(input) {
      if (input.results.length > adminLinkRestaurantReadBudget) {
        invalidSession();
      }
      for (const result of input.results) {
        if (
          !/^[a-f0-9]{64}$/u.test(result.id) ||
          (result.source !== "biteScore" && result.source !== "biteSaver") ||
          readBiteScoreCatalogRestaurantId(result.sourceDocumentId) === null ||
          readInteger(result.distanceMillimeters) === null ||
          readNormalizedOrderingName(result.normalizedName) === null ||
          readInteger(result.expiresAtMs) === null
        ) {
          invalidSession();
        }
      }
      return firestore.runTransaction(async (transaction) => {
        const reference = sessions().doc(input.sessionId);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) {
          invalidSession();
        }
        const session = parseSession(snapshot.id, snapshot.data());
        const commitNowMs = freshNowMs(snapshot.readTime);
        if (
          session.leaseToken !== input.leaseToken ||
          session.leaseGeneration !== input.leaseGeneration ||
          session.leaseUntilMs === null ||
          session.leaseUntilMs <= commitNowMs ||
          expired(session, commitNowMs) ||
          input.results.some((result) =>
            result.expiresAtMs !== session.absoluteExpiresAtMs)
        ) {
          invalidSession();
        }
        const activeReference = active().doc(activeKey(
          session.callerBinding,
          session.queryFingerprint,
          session.searchInstanceHash,
        ));
        const activeSnapshot = await transaction.get(activeReference);
        if (!canRefreshActivePointer(
          activeSnapshot.exists ? activeSnapshot.data() : null,
          session,
          commitNowMs,
        )) {
          invalidSession();
        }
        const idleExpiresAtMs = Math.min(
          commitNowMs + adminLinkRestaurantIdleLifetimeMs,
          session.absoluteExpiresAtMs,
        );
        const next: AdminLinkRestaurantSession = Object.freeze({
          ...session,
          state: input.state,
          ranges: Object.freeze([...input.ranges]),
          lastUsedAtMs: commitNowMs,
          idleExpiresAtMs,
          leaseToken: null,
          leaseUntilMs: null,
          lastCompletedRequestId: input.clientRequestId,
          scannedDocumentCount: session.scannedDocumentCount + input.documentsRead,
        });
        for (const result of input.results) {
          transaction.set(
            reference.collection(adminLinkRestaurantResultSubcollection).doc(
              result.id,
            ),
            {
              source: result.source,
              sourceDocumentId: result.sourceDocumentId,
              distanceMillimeters: result.distanceMillimeters,
              normalizedName: result.normalizedName,
              schemaVersion: 1,
              orderingVersion: 1,
              expiresAt: Timestamp.fromMillis(result.expiresAtMs),
            },
          );
        }
        transaction.create(
          reference.collection(adminLinkRestaurantResultSubcollection).doc(
            completedAdvanceRequestMarkerId(input.clientRequestId),
          ),
          {
            // Ordering fields are deliberately absent: the four-field results
            // query excludes this TTL-covered private idempotency marker.
            markerType: "completedAdvanceRequest",
            schemaVersion: 1,
            completedAt: Timestamp.fromMillis(commitNowMs),
            expiresAt: Timestamp.fromMillis(session.absoluteExpiresAtMs),
          },
        );
        transaction.set(reference, sessionWrite(next));
        transaction.set(
          activeReference,
          activePointerWrite(next, idleExpiresAtMs),
        );
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
        const failureNowMs = freshNowMs(snapshot.readTime);
        if (
          session.leaseToken !== input.leaseToken ||
          session.leaseGeneration !== input.leaseGeneration ||
          session.leaseUntilMs === null ||
          session.leaseUntilMs <= failureNowMs ||
          expired(session, failureNowMs)
        ) {
          return;
        }
        const activeReference = active().doc(activeKey(
          session.callerBinding,
          session.queryFingerprint,
          session.searchInstanceHash,
        ));
        const activeSnapshot = await transaction.get(activeReference);
        if (!canRefreshActivePointer(
          activeSnapshot.exists ? activeSnapshot.data() : null,
          session,
          failureNowMs,
        )) {
          return;
        }
        const failed = Object.freeze({
          ...session,
          state: "failed" as const,
          failureMessage: "Restaurant search preparation failed.",
          leaseToken: null,
          leaseUntilMs: null,
          lastCompletedRequestId: input.clientRequestId,
          lastUsedAtMs: failureNowMs,
          idleExpiresAtMs: Math.min(
            failureNowMs + adminLinkRestaurantIdleLifetimeMs,
            session.absoluteExpiresAtMs,
          ),
        });
        transaction.set(reference, sessionWrite(failed));
        transaction.set(
          activeReference,
          activePointerWrite(failed, failed.idleExpiresAtMs),
        );
      });
    },
    async queryResults(input) {
      let query: Query<DocumentData, DocumentData> = sessions()
        .doc(input.sessionId)
        .collection(adminLinkRestaurantResultSubcollection)
        .orderBy("distanceMillimeters", "asc")
        .orderBy("normalizedName", "asc")
        .orderBy("sourceDocumentId", "asc")
        .orderBy("source", "asc");
      if (input.after !== undefined) {
        query = query.startAfter(...input.after);
      }
      const snapshot = await query.limit(input.limit).get();
      return snapshot.docs.map((document) => Object.freeze({
        id: document.id,
        data: document.data(),
      }));
    },
    async getSourceDocuments(identities) {
      if (identities.length === 0) {
        return [];
      }
      if (identities.length > adminLinkRestaurantPageSize) {
        invalidSession();
      }
      const references = identities.map((identity) => firestore
        .collection(identity.source === "biteScore"
          ? "bitescore_restaurants"
          : "restaurant_accounts")
        .doc(identity.documentId));
      const snapshots = await firestore.getAll(...references);
      return snapshots.flatMap((snapshot, index) => snapshot.exists
        ? [Object.freeze({
            source: identities[index].source,
            documentId: snapshot.id,
            data: snapshot.data() as Readonly<Record<string, unknown>>,
          })]
        : []);
    },
  };
}

function randomIdentifier(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

function preparationCursor(
  session: AdminLinkRestaurantSession,
  parsed: AdminLinkRestaurantParsedContext,
): string {
  return parsed.codec.encode({
    queryFingerprint: session.queryFingerprint,
    source: adminLinkRestaurantCursorSource,
    searchMode: adminLinkRestaurantSearchMode,
    pageSize: adminLinkRestaurantPageSize,
    purpose: "forward",
    sortTuple: [0],
    callerBinding: parsed.callerBinding,
    sessionId: session.id,
    lifetimeMs: adminLinkRestaurantIdleLifetimeMs,
  });
}

function responseMetadata(session: AdminLinkRestaurantSession) {
  return {
    searchCenter: session.center,
    radiusMiles: session.radiusMiles,
    queriedSources: session.sources,
  };
}

function preparingResponse(
  session: AdminLinkRestaurantSession,
  parsed: AdminLinkRestaurantParsedContext,
  busy: boolean,
): Readonly<Record<string, unknown>> {
  const completedUnits = session.ranges.filter((range) => range.exhausted).length;
  const failed = session.state === "failed";
  const nextCursor = failed ? undefined : preparationCursor(session, parsed);
  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    items: [],
    pageSize: adminLinkRestaurantPageSize,
    hasNext: !failed,
    hasPrevious: false,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    total: { state: "unknown" as const },
    queryFingerprint: session.queryFingerprint,
    snapshotTimestampMs: parsed.nowMs,
    capabilities: {
      first: false,
      previous: false,
      numberedVisitedPages: false,
      next: !failed,
      last: false,
    },
    preparation: {
      state: failed ? "failed" as const : "preparing" as const,
      completedUnits,
      totalUnits: session.ranges.length,
      message: failed
        ? "Restaurant search preparation failed. Run the search again."
        : busy
        ? "BiteStar is already checking the remaining nearby restaurants."
        : "Preparing complete nearby results…",
    },
    ...responseMetadata(session),
  });
}

function materializedTuple(
  document: StoredDocument,
): readonly [number, string, string, AdminRestaurantSource] {
  const distance = readInteger(document.data.distanceMillimeters);
  const normalizedName = readNormalizedOrderingName(
    document.data.normalizedName,
  );
  const sourceDocumentId = readBiteScoreCatalogRestaurantId(
    document.data.sourceDocumentId,
  );
  const source = document.data.source;
  if (
    !/^[a-f0-9]{64}$/u.test(document.id) ||
    distance === null || normalizedName === null || sourceDocumentId === null ||
    (source !== "biteScore" && source !== "biteSaver")
  ) {
    invalidSession();
  }
  return [distance, normalizedName, sourceDocumentId, source];
}

function materializedOrder(
  document: StoredDocument,
): AdminLinkRestaurantMaterializedOrder {
  const tuple = materializedTuple(document);
  return Object.freeze({
    distanceMillimeters: tuple[0],
    normalizedName: tuple[1],
    sourceDocumentId: tuple[2],
    source: tuple[3],
  });
}

async function readyPage(input: Readonly<{
  session: AdminLinkRestaurantSession;
  parsed: AdminLinkRestaurantParsedContext;
  context: AdminLinkRestaurantHandlerContext;
  after: readonly [number, string, string, AdminRestaurantSource] | null;
}>): Promise<Readonly<Record<string, unknown>>> {
  const documents = await input.context.store.queryResults({
    sessionId: input.session.id,
    ...(input.after === null ? {} : { after: input.after }),
    limit: adminLinkRestaurantPageSize + 1,
  });
  if (documents.length > adminLinkRestaurantPageSize + 1) {
    invalidSession();
  }
  const validatedDocuments = documents.map((document) => Object.freeze({
    document,
    order: materializedOrder(document),
  }));
  const selectedEntries = validatedDocuments
    .slice(0, adminLinkRestaurantPageSize)
    .map(({order}) => Object.freeze({
      identity: Object.freeze({
        source: order.source,
        documentId: order.sourceDocumentId,
      }),
      order,
    }));
  const identities = selectedEntries.map((entry) => entry.identity);
  const currentCandidates = await input.context.store.getSourceDocuments(
    identities,
  );
  const currentByKey = new Map(currentCandidates.map((candidate) => [
    `${candidate.source}:${candidate.documentId}`,
    candidate,
  ]));
  const orderedCandidates = identities.flatMap((identity) => {
    const candidate = currentByKey.get(
      `${identity.source}:${identity.documentId}`,
    );
    return candidate === undefined ? [] : [candidate];
  });
  const response = await rehydrateAdminRestaurantSearchPage({
    request: input.parsed.criteria.request,
    searchCenter: input.session.center,
    candidates: orderedCandidates,
    dependencies: {
      verifyBiteSaverCatalogBindings:
        input.context.verifyBiteSaverCatalogBindings,
      loadQrPreparationDocuments: input.context.loadQrPreparationDocuments,
      loadQrPreparationInvitationDocuments:
        input.context.loadQrPreparationInvitationDocuments,
    },
  });
  const materializedOrdersByKey = new Map(selectedEntries.map((entry) => [
    `${entry.identity.source}:${entry.identity.documentId}`,
    entry.order,
  ]));
  const currentResultsByKey = new Map<
    string,
    (typeof response.results)[number]
  >();
  for (const result of response.results) {
    const key = `${result.source}:${result.documentId}`;
    if (currentResultsByKey.has(key) || !materializedOrdersByKey.has(key)) {
      invalidSession();
    }
    if (
      readNormalizedOrderingName(
        normalizeAdminRestaurantName(result.restaurantName),
      ) === null
    ) {
      continue;
    }
    currentResultsByKey.set(key, result);
  }
  const visibleItems = selectedEntries.flatMap((entry) => {
    const key = `${entry.identity.source}:${entry.identity.documentId}`;
    const result = currentResultsByKey.get(key);
    return result === undefined
      ? []
      : [Object.freeze({ ...result, materializedOrder: entry.order })];
  });
  const hasNext = validatedDocuments.length > adminLinkRestaurantPageSize;
  const last = selectedEntries[selectedEntries.length - 1];
  const consumedBoundary = last === undefined
    ? undefined
    : last.order;
  const nextCursor = hasNext && last !== undefined
    ? input.parsed.codec.encode({
        queryFingerprint: input.session.queryFingerprint,
        source: adminLinkRestaurantCursorSource,
        searchMode: adminLinkRestaurantSearchMode,
        pageSize: adminLinkRestaurantPageSize,
        purpose: "forward",
        sortTuple: [
          last.order.distanceMillimeters,
          last.order.normalizedName,
          last.order.sourceDocumentId,
          last.order.source,
        ],
        callerBinding: input.parsed.callerBinding,
        sessionId: input.session.id,
        lifetimeMs: adminLinkRestaurantIdleLifetimeMs,
      })
    : undefined;
  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    items: visibleItems,
    pageSize: adminLinkRestaurantPageSize,
    hasNext,
    hasPrevious: false,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(consumedBoundary === undefined ? {} : { consumedBoundary }),
    total: { state: "unknown" as const },
    queryFingerprint: input.session.queryFingerprint,
    snapshotTimestampMs: input.parsed.nowMs,
    capabilities: {
      first: false,
      previous: false,
      numberedVisitedPages: false,
      next: hasNext,
      last: false,
    },
    preparation: {
      state: "ready" as const,
      completedUnits: input.session.ranges.length,
      totalUnits: input.session.ranges.length,
    },
    ...responseMetadata(input.session),
  });
}

async function advanceSession(input: Readonly<{
  session: AdminLinkRestaurantSession;
  parsed: AdminLinkRestaurantParsedContext;
  context: AdminLinkRestaurantHandlerContext;
}>): Promise<Readonly<{
  session: AdminLinkRestaurantSession;
  busy: boolean;
}>> {
  const leaseToken = input.context.leaseTokenSource?.() ??
    randomIdentifier("lease");
  const claim = await input.context.store.claimSession({
    sessionId: input.session.id,
    callerBinding: input.parsed.callerBinding,
    queryFingerprint: input.session.queryFingerprint,
    clientRequestId: input.parsed.request.clientRequestId,
    leaseToken,
    nowMs: input.parsed.nowMs,
  });
  if (claim.status !== "claimed" || claim.session.state !== "preparing") {
    return Object.freeze({
      session: claim.session,
      busy: claim.status === "busy",
    });
  }
  let remaining = adminLinkRestaurantReadBudget;
  let documentsRead = 0;
  const ranges = [...claim.session.ranges];
  const results = new Map<string, AdminLinkRestaurantMaterializedResult>();
  try {
    for (let index = 0; index < ranges.length && remaining > 0; index += 1) {
      let range = ranges[index];
      while (!range.exhausted && remaining > 0) {
        const limit = Math.min(adminLinkRestaurantRangeChunkSize, remaining);
        const documents = await input.context.store.queryCandidates({
          range,
          limit,
        });
        if (documents.length > limit) {
          invalidSession();
        }
        documentsRead += documents.length;
        remaining -= documents.length;
        for (const document of documents) {
          const candidate: AdminRestaurantSearchCandidate = Object.freeze({
            ...document,
            source: range.source,
          });
          const projected = processAdminRestaurantSearchCandidates({
            request: input.parsed.criteria.request,
            searchCenter: claim.session.center,
            candidates: [candidate],
            anyQueryReachedCandidateLimit: false,
          }).results[0];
          if (projected === undefined) {
            continue;
          }
          const distanceMillimeters = Math.round(
            projected.distanceMiles * 1_609_344,
          );
          if (!Number.isSafeInteger(distanceMillimeters)) {
            continue;
          }
          const normalizedName = readNormalizedOrderingName(
            normalizeAdminRestaurantName(projected.restaurantName),
          );
          if (normalizedName === null) {
            continue;
          }
          const id = createHash("sha256")
            .update(JSON.stringify([
              "adminLinkRestaurantResult",
              1,
              1,
              range.source,
              projected.documentId,
            ]), "utf8")
            .digest("hex");
          results.set(id, Object.freeze({
            id,
            source: range.source,
            sourceDocumentId: projected.documentId,
            distanceMillimeters,
            normalizedName,
            expiresAtMs: claim.session.absoluteExpiresAtMs,
          }));
        }
        const last = documents[documents.length - 1];
        const lastGeohash = last === undefined
          ? null
          : readString(last.data.geohash, 32);
        const lastDocumentId = last === undefined
          ? null
          : readBiteScoreCatalogRestaurantId(last.documentId);
        const rangeExhausted = documents.length < limit;
        if (!rangeExhausted &&
            (lastGeohash === null || lastDocumentId === null)) {
          invalidSession();
        }
        range = Object.freeze({
          ...range,
          afterGeohash: lastGeohash ?? range.afterGeohash,
          afterDocumentId: lastDocumentId ?? range.afterDocumentId,
          exhausted: rangeExhausted,
        });
        ranges[index] = range;
        if (documents.length === 0) {
          break;
        }
      }
    }
    const ready = ranges.every((range) => range.exhausted);
    const session = await input.context.store.finishAdvance({
      sessionId: claim.session.id,
      leaseToken,
      leaseGeneration: claim.session.leaseGeneration,
      clientRequestId: input.parsed.request.clientRequestId,
      ranges: Object.freeze(ranges),
      documentsRead,
      state: ready ? "ready" : "preparing",
      results: Object.freeze([...results.values()]),
    });
    return Object.freeze({ session, busy: false });
  } catch (error) {
    await input.context.store.failAdvance({
      sessionId: claim.session.id,
      leaseToken,
      leaseGeneration: claim.session.leaseGeneration,
      clientRequestId: input.parsed.request.clientRequestId,
    });
    throw error;
  }
}

function decodedMaterializedTuple(
  value: readonly unknown[],
): readonly [number, string, string, AdminRestaurantSource] | null {
  if (value.length === 1 && value[0] === 0) {
    return null;
  }
  if (value.length !== 4) {
    invalidSession();
  }
  const source = value[3];
  if (
    readInteger(value[0]) === null ||
    readNormalizedOrderingName(value[1]) === null ||
    readBiteScoreCatalogRestaurantId(value[2]) === null ||
    (source !== "biteScore" && source !== "biteSaver")
  ) {
    invalidSession();
  }
  return value as readonly [number, string, string, AdminRestaurantSource];
}

export async function searchAdminLinkRestaurantsPageHandler(
  rawRequest: unknown,
  context: AdminLinkRestaurantHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = createAdminLinkRestaurantParsedContext(rawRequest, context);
  let center: ResolvedAdminRestaurantSearchCenter;
  if (parsed.request.direction === "first") {
    if (parsed.criteria.resolvedCenter !== null) {
      throw new HttpsError(
        "invalid-argument",
        "A new restaurant search must resolve a fresh search center.",
      );
    }
    center = await resolveAdminRestaurantSearchCenter(
      parsed.criteria.request.center,
      {
        getGeocodingApiKey: context.getGeocodingApiKey,
        fetchGeocoding: context.fetchGeocoding,
      },
    );
  } else {
    center = parsed.criteria.resolvedCenter ?? invalidSession();
  }
  const queryFingerprint = createQueryFingerprint(
    adminLinkRestaurantFingerprintCriteria(parsed.criteria, center),
  );
  const searchInstanceHash = createHash("sha256")
    .update(parsed.criteria.searchInstanceId, "utf8")
    .digest("hex");
  let session: AdminLinkRestaurantSession | null = null;
  let after: readonly [number, string, string, AdminRestaurantSource] | null =
    null;
  if (parsed.request.cursor !== undefined) {
    try {
      const decoded = parsed.codec.decode(parsed.request.cursor, {
        queryFingerprint,
        source: adminLinkRestaurantCursorSource,
        searchMode: adminLinkRestaurantSearchMode,
        pageSize: adminLinkRestaurantPageSize,
        callerBinding: parsed.callerBinding,
        purposes: ["forward"],
      });
      if (decoded.sessionId === undefined) {
        invalidSession();
      }
      after = decodedMaterializedTuple(decoded.sortTuple);
      session = await context.store.getSession(decoded.sessionId);
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }
      invalidSession();
    }
  } else {
    const plans = buildAdminRestaurantQueryPlans(
      center,
      parsed.criteria.request.radiusMiles,
      parsed.criteria.request.sources,
      parsed.criteria.request.biteScoreStatus,
    );
    if (
      plans.length === 0 || plans.length > adminLinkRestaurantMaximumRanges ||
      parsed.criteria.request.sources.some((source) =>
        plans.filter((plan) => plan.source === source).length >
          adminLinkRestaurantMaximumRangesPerSource)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Nearby restaurant search could not create a bounded search plan.",
      );
    }
    const id = context.sessionIdSource?.() ?? randomIdentifier("alrs");
    const nowMs = parsed.nowMs;
    const proposedSession: AdminLinkRestaurantSession = Object.freeze({
      id,
      schemaVersion: 1,
      orderingVersion: 1,
      state: "preparing",
      callerBinding: parsed.callerBinding,
      queryFingerprint,
      searchInstanceHash,
      pageSize: adminLinkRestaurantPageSize,
      center,
      centerInput: parsed.criteria.center,
      radiusMiles: parsed.criteria.request.radiusMiles,
      normalizedRestaurantName:
        parsed.criteria.request.normalizedRestaurantName,
      sources: Object.freeze([...parsed.criteria.request.sources]),
      biteScoreStatus: parsed.criteria.request.biteScoreStatus,
      ranges: Object.freeze(plans.map((plan): SessionRange => Object.freeze({
        source: plan.source,
        collectionName: plan.collectionName,
        start: plan.geohashStart,
        end: plan.geohashEnd,
        biteScoreIsActive: plan.biteScoreIsActive,
        afterGeohash: null,
        afterDocumentId: null,
        exhausted: false,
      }))),
      createdAtMs: nowMs,
      lastUsedAtMs: nowMs,
      idleExpiresAtMs: nowMs + adminLinkRestaurantIdleLifetimeMs,
      absoluteExpiresAtMs: nowMs + adminLinkRestaurantAbsoluteLifetimeMs,
      leaseToken: null,
      leaseUntilMs: null,
      leaseGeneration: 0,
      lastCompletedRequestId: null,
      scannedDocumentCount: 0,
      failureMessage: null,
    });
    session = await context.store.acquireInitialSession({
      activeKey: activeKey(
        parsed.callerBinding,
        queryFingerprint,
        searchInstanceHash,
      ),
      session: proposedSession,
      nowMs,
    });
  }
  if (
    session === null || session.callerBinding !== parsed.callerBinding ||
    session.queryFingerprint !== queryFingerprint ||
    session.searchInstanceHash !== searchInstanceHash ||
    expired(session, parsed.nowMs)
  ) {
    invalidSession();
  }
  if (session.state === "failed") {
    return preparingResponse(session, parsed, false);
  }
  let busy = false;
  if (session.state === "preparing") {
    const advanced = await advanceSession({ session, parsed, context });
    session = advanced.session;
    busy = advanced.busy;
  }
  if (session.state === "ready") {
    session = await context.store.touchReadySession({
      sessionId: session.id,
      activeKey: activeKey(
        parsed.callerBinding,
        queryFingerprint,
        session.searchInstanceHash,
      ),
      callerBinding: parsed.callerBinding,
      queryFingerprint,
      nowMs: parsed.nowMs,
    });
    return readyPage({ session, parsed, context, after });
  }
  return preparingResponse(session, parsed, busy);
}
