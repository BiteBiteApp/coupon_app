import {randomBytes} from "node:crypto";
import type {OpaqueCursorCodec} from "./opaque_cursor.js";
import type {
  CustomerBiteSaverSearchDatabase as SearchDatabase,
  CustomerBiteSaverStoredDocument as StoredDocument,
  CustomerBiteSaverQuery as SearchQuery,
  CustomerBiteSaverTransaction as SearchTransaction,
} from "./customer_bitesaver_search_store.js";
import {
  exactCustomerBiteSaverDistanceMiles,
  mergedRestaurantGeographicQueryBounds,
} from "./restaurant_geo_helpers.js";
import {biteScoreRestaurantIsActive} from "./search_index_builders.js";
import {
  biteScoreDishCustomerPublicProjectionVersion,
  biteScoreRestaurantCustomerPublicProjectionVersion,
} from "./search_index_contract.js";
import {
  biteScoreCategoryTerms,
  biteScoreFinderCloseScore,
  biteScoreFinderNameScore,
  matchesBiteScoreFood,
  matchesBiteScorePlainText,
  normalizeBiteScoreFinderText,
} from "./customer_bitescore_search_matcher.js";
import {
  biteScoreRecord,
  biteScoreRequestString,
  customerBiteScoreAdmissionCollection,
  customerBiteScoreCriteriaFingerprint,
  customerBiteScoreDigest,
  customerBiteScoreFinderSize,
  customerBiteScoreGenerationShardPaths,
  customerBiteScoreIdleLifetimeMs,
  customerBiteScoreIndexPath,
  customerBiteScoreLeaseLifetimeMs,
  customerBiteScorePageSize,
  customerBiteScorePreparationBatchSize,
  customerBiteScoreResultCollection,
  CustomerBiteScoreSearchError,
  customerBiteScoreSearchVersion,
  customerBiteScoreSessionCollection,
  customerBiteScoreSessionLifetimeMs,
  customerBiteScoreUtf16Key,
  parseCustomerBiteScoreCriteria,
  readCustomerBiteScoreGenerationShard,
  readCustomerBiteScorePublicProjection,
  type CustomerBiteScoreCriteria,
  type CustomerBiteScorePublicDto,
} from "./customer_bitescore_search_contract.js";

export {readCustomerBiteScorePublicProjection} from "./customer_bitescore_search_contract.js";
export type CustomerBiteScoreSearchContext = Readonly<{
  // Supplied by the runtime from the authenticated principal or its established
  // guest client-instance binding. Request data never chooses an authenticated actor.
  actorId: string;
  cursorCodec: OpaqueCursorCodec;
  nowMs?: number;
}>;

type Session = {
  version: string;
  sessionId: string;
  actor: string;
  instanceId: string;
  clientRequestId: string;
  queryGeneration: number;
  queryFingerprint: string;
  criteria: CustomerBiteScoreCriteria;
  state: "preparing" | "ready" | "failed";
  attempt: number;
  generations: number[];
  rangeIndex: number;
  after: string[] | null;
  currentParent: {id: string; indexId: string; geohash: string} | null;
  dishAfter: string | null;
  scannedCount: number;
  createdAtMs: number;
  absoluteExpiresAtMs: number;
  idleExpiresAtMs: number;
  leaseId: string | null;
  leaseUntilMs: number;
  expiresAt: Date;
};

type Result = Record<string, unknown> & {
  sessionId: string; attempt: number; sourceId: string; sourceIndexPath: string;
  sourceProjectionFingerprint: string; parentIndexPath: string;
  parentProjectionFingerprint: string;
  rank0: number; rank1: number; rank2: number;
  nameKey: Buffer; idKey0: Buffer; idKey1: Buffer;
};

export type CustomerBiteScoreSearchResponse = Readonly<{
  schemaVersion: 1;
  sessionId: string;
  queryFingerprint: string;
  state: "preparing" | "ready" | "failed";
  scannedCount: number;
  pageSize: number;
  items: readonly CustomerBiteScorePublicDto[];
  nextCursor: string | null;
  hasMore: boolean;
  retryAfterMs: number;
}>;

function unavailable(): never {
  throw new CustomerBiteScoreSearchError("failed-precondition", "This BiteScore search is unavailable or expired. Refresh the search.");
}
function now(context: CustomerBiteScoreSearchContext): number {
  const value = context.nowMs ?? Date.now();
  if (!Number.isSafeInteger(value) || value < 0) unavailable();
  return value;
}
function actor(context: CustomerBiteScoreSearchContext): string {
  if (!context.actorId || context.actorId.length > 2000) unavailable();
  return customerBiteScoreDigest("actor", context.actorId);
}
function sessionPath(id: string): string {
  if (!/^[a-f0-9]{64}$/u.test(id)) unavailable();
  return `${customerBiteScoreSessionCollection}/${id}`;
}
function instancePath(actorId: string, instanceId: string): string {
  return `${customerBiteScoreAdmissionCollection}/instance_${customerBiteScoreDigest(actorId, instanceId)}`;
}
function actorPath(actorId: string): string {
  return `${customerBiteScoreAdmissionCollection}/actor_${actorId}`;
}
function readSession(document: StoredDocument | null): Session {
  if (document === null) unavailable();
  const s = document.data as unknown as Session;
  if (s.version !== customerBiteScoreSearchVersion || document.path !== sessionPath(s.sessionId) ||
      !["preparing", "ready", "failed"].includes(s.state) ||
      !/^[a-f0-9]{64}$/u.test(s.actor) || typeof s.instanceId !== "string" ||
      !Number.isSafeInteger(s.attempt) || s.attempt < 0 || s.attempt > 2 ||
      !Number.isSafeInteger(s.scannedCount) || s.scannedCount < 0 ||
      !Number.isSafeInteger(s.absoluteExpiresAtMs) || !Number.isSafeInteger(s.idleExpiresAtMs) ||
      !Number.isSafeInteger(s.queryGeneration) || s.queryGeneration < 0 ||
      !Array.isArray(s.generations) || s.generations.length !== 16 ||
      !s.generations.every((v) => Number.isSafeInteger(v) && v >= 0) ||
      !Number.isSafeInteger(s.rangeIndex) || s.rangeIndex < 0 || s.rangeIndex > 9 ||
      (s.after !== null && (!Array.isArray(s.after) || s.after.length > 2 || !s.after.every((v) => typeof v === "string"))) ||
      (s.currentParent !== null && (!biteScoreRecord(s.currentParent) ||
        typeof s.currentParent.id !== "string" || typeof s.currentParent.indexId !== "string" || typeof s.currentParent.geohash !== "string")) ||
      (s.dishAfter !== null && typeof s.dishAfter !== "string")) unavailable();
  const criteria = parseCustomerBiteScoreCriteria(s.criteria);
  if (customerBiteScoreCriteriaFingerprint(criteria) !== s.queryFingerprint) unavailable();
  return {...s, criteria};
}
function response(session: Session): CustomerBiteScoreSearchResponse {
  return Object.freeze({schemaVersion: 1, sessionId: session.sessionId,
    queryFingerprint: session.queryFingerprint, state: session.state, scannedCount: session.scannedCount,
    pageSize: session.criteria.finder === null ? customerBiteScorePageSize : customerBiteScoreFinderSize,
    items: Object.freeze([]), nextCursor: null, hasMore: false,
    retryAfterMs: session.state === "preparing" ? 150 : 0});
}

function parseContinuation(input: unknown): {sessionId: string; queryFingerprint: string; cursor: unknown} {
  if (!biteScoreRecord(input) || input.schemaVersion !== 1 || typeof input.sessionId !== "string" ||
      typeof input.queryFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(input.queryFingerprint)) unavailable();
  return {sessionId: input.sessionId, queryFingerprint: input.queryFingerprint, cursor: input.cursor ?? null};
}

async function requireCurrentSession(transaction: SearchTransaction, input: ReturnType<typeof parseContinuation>,
  context: CustomerBiteScoreSearchContext): Promise<Session> {
  const session = readSession(await transaction.getDocument(sessionPath(input.sessionId)));
  if (session.actor !== actor(context) || session.queryFingerprint !== input.queryFingerprint ||
      now(context) >= Math.min(session.absoluteExpiresAtMs, session.idleExpiresAtMs)) unavailable();
  const active = await transaction.getDocument(instancePath(session.actor, session.instanceId));
  if (active?.data.sessionId !== session.sessionId || active.data.queryGeneration !== session.queryGeneration) unavailable();
  return session;
}

async function generations(transaction: SearchTransaction): Promise<number[]> {
  const documents = await transaction.getDocuments(customerBiteScoreGenerationShardPaths);
  return documents.map((v) => readCustomerBiteScoreGenerationShard(v?.data));
}

export async function startCustomerBiteScoreSearchHandler(database: SearchDatabase, input: unknown,
  context: CustomerBiteScoreSearchContext): Promise<CustomerBiteScoreSearchResponse> {
  if (!biteScoreRecord(input) || input.schemaVersion !== 1 ||
      !Number.isSafeInteger(input.queryGeneration) || (input.queryGeneration as number) < 0) {
    throw new CustomerBiteScoreSearchError("invalid-argument", "Invalid BiteScore search generation.");
  }
  const instanceId = biteScoreRequestString(input.clientInstanceId, 128);
  const clientRequestId = biteScoreRequestString(input.clientRequestId, 128);
  if (!instanceId || !clientRequestId) unavailable();
  const criteria = parseCustomerBiteScoreCriteria(input.criteria);
  const queryFingerprint = customerBiteScoreCriteriaFingerprint(criteria);
  const actorId = actor(context);
  const timestamp = now(context);
  const queryGeneration = input.queryGeneration as number;
  const id = customerBiteScoreDigest("session", actorId, instanceId, clientRequestId);
  const session = await database.runTransaction(async (transaction) => {
    const [active, admission, previous, catalog] = await Promise.all([
      transaction.getDocument(instancePath(actorId, instanceId)), transaction.getDocument(actorPath(actorId)),
      transaction.getDocument(sessionPath(id)), generations(transaction),
    ]);
    if (previous !== null) {
      const prior = readSession(previous);
      if (prior.queryFingerprint !== queryFingerprint || prior.queryGeneration !== queryGeneration ||
          active?.data.sessionId !== id || timestamp >= Math.min(prior.idleExpiresAtMs, prior.absoluteExpiresAtMs)) unavailable();
      return prior;
    }
    if (active !== null && (!Number.isSafeInteger(active.data.queryGeneration) ||
        (active.data.queryGeneration as number) >= queryGeneration)) unavailable();
    const a = admission?.data ?? {};
    const currentWindow = typeof a.windowAtMs === "number" && timestamp - a.windowAtMs < 60_000;
    const starts = currentWindow && typeof a.starts === "number" ? a.starts : 0;
    // Existing customer-session admission pattern: bound starts and concurrent
    // unfinished work. Finder uses the same work budget and never spawns jobs.
    if (starts >= 6) throw new CustomerBiteScoreSearchError("resource-exhausted", "Please wait before starting another search.");
    const pending = Array.isArray(a.pending) ? a.pending.filter(biteScoreRecord).filter((v) =>
      typeof v.expiresAtMs === "number" && v.expiresAtMs > timestamp && v.instanceId !== instanceId) : [];
    if (pending.length >= 2) throw new CustomerBiteScoreSearchError("resource-exhausted", "Please finish another search first.");
    const next: Session = {version: customerBiteScoreSearchVersion, sessionId: id, actor: actorId,
      instanceId, clientRequestId, queryGeneration, queryFingerprint, criteria, state: "preparing", attempt: 0,
      generations: catalog, rangeIndex: 0, after: null, currentParent: null, dishAfter: null,
      scannedCount: 0, createdAtMs: timestamp,
      absoluteExpiresAtMs: timestamp + customerBiteScoreSessionLifetimeMs,
      idleExpiresAtMs: timestamp + customerBiteScoreIdleLifetimeMs,
      leaseId: null, leaseUntilMs: 0, expiresAt: new Date(timestamp + customerBiteScoreSessionLifetimeMs)};
    transaction.createDocument(sessionPath(id), next);
    transaction.setDocument(instancePath(actorId, instanceId), {version: customerBiteScoreSearchVersion,
      sessionId: id, queryGeneration, expiresAt: next.expiresAt});
    transaction.setDocument(actorPath(actorId), {version: customerBiteScoreSearchVersion,
      windowAtMs: currentWindow ? a.windowAtMs : timestamp, starts: starts + 1,
      pending: [...pending, {sessionId: id, instanceId, expiresAtMs: next.idleExpiresAtMs}], expiresAt: next.expiresAt});
    return next;
  });
  return response(session);
}

function ranges(session: Session): readonly (readonly [string, string])[] {
  return session.criteria.center === null || session.criteria.restaurantId !== null ? [["", ""]] :
    mergedRestaurantGeographicQueryBounds(session.criteria.center, session.criteria.radiusMiles);
}

export function customerBiteScorePreparationQuery(session: Session): SearchQuery {
  const criteria = session.criteria;
  const filters: SearchQuery["filters"][number][] = [
    {field: "source", operation: "==", value: "biteScore"},
    {field: "publicVisible", operation: "==", value: true},
    {field: "customerPublicProjectionVersion", operation: "==", value: criteria.kind === "dish"
      ? biteScoreDishCustomerPublicProjectionVersion : biteScoreRestaurantCustomerPublicProjectionVersion},
  ];
  if (criteria.kind === "dish" && criteria.restaurantId !== null) {
    filters.push({field: "restaurantSourceDocumentId", operation: "==", value: criteria.restaurantId});
  }
  const useGeography = criteria.center !== null && criteria.restaurantId === null;
  if (useGeography) {
    const range = ranges(session)[session.rangeIndex];
    if (!range) unavailable();
    filters.push({field: "geohash", operation: ">=", value: range[0]}, {field: "geohash", operation: "<=", value: range[1]});
  }
  return {collectionPath: criteria.kind === "dish" ? "dish_search_index" : "restaurant_search_index",
    filters, orders: !useGeography ? [{field: "__name__", direction: "asc"}] :
      [{field: "geohash", direction: "asc"}, {field: "__name__", direction: "asc"}],
    ...(session.after === null ? {} : {startAfter: session.after}), limit: customerBiteScorePreparationBatchSize};
}

type PreparationBatch = {
  documents: readonly StoredDocument[]; rangeIndex: number; after: string[] | null;
  currentParent: Session["currentParent"]; dishAfter: string | null;
  complete: boolean; scanned: number;
};

async function prepareBatch(database: SearchDatabase, session: Session): Promise<PreparationBatch> {
  const byParent = session.criteria.kind === "dish" && session.criteria.center !== null && session.criteria.restaurantId === null;
  if (!byParent) {
    const documents = await database.queryDocuments(customerBiteScorePreparationQuery(session));
    if (documents.length > customerBiteScorePreparationBatchSize) unavailable();
    const last = documents[documents.length - 1];
    const done = documents.length < customerBiteScorePreparationBatchSize;
    const rangeIndex = done ? session.rangeIndex + 1 : session.rangeIndex;
    const useGeography = session.criteria.center !== null && session.criteria.restaurantId === null;
    return {documents, rangeIndex, after: done || !last ? null : useGeography ?
      [last.data.geohash as string, last.id] : [last.id], currentParent: null, dishAfter: null,
      complete: rangeIndex >= ranges(session).length, scanned: documents.length};
  }
  // Walk the authoritative restaurant geography and then that restaurant's
  // indexed dishes. A parent's move may precede its asynchronous dish fan-out;
  // querying stale dish geohashes would otherwise permanently omit matches.
  let parent = session.currentParent;
  let scanned = 0;
  if (parent === null) {
    const query = customerBiteScorePreparationQuery({...session,
      criteria: {...session.criteria, kind: "restaurant"}});
    const parents = await database.queryDocuments({...query, limit: 1});
    if (parents.length > 1) unavailable();
    scanned += parents.length;
    const document = parents[0];
    if (document === undefined) {
      const rangeIndex = session.rangeIndex + 1;
      return {documents: [], rangeIndex, after: null, currentParent: null, dishAfter: null,
        complete: rangeIndex >= ranges(session).length, scanned};
    }
    const projection = readCustomerBiteScorePublicProjection(document, "restaurant");
    if (projection === null || exactCustomerBiteSaverDistanceMiles(session.criteria.center!,
      {latitude: projection.latitude as number, longitude: projection.longitude as number}) > session.criteria.radiusMiles) {
      return {documents: [], rangeIndex: session.rangeIndex,
        after: [document.data.geohash as string, document.id], currentParent: null, dishAfter: null, complete: false, scanned};
    }
    parent = {id: projection.sourceDocumentId as string, indexId: document.id, geohash: document.data.geohash as string};
  }
  const query = customerBiteScorePreparationQuery({...session, after: session.dishAfter === null ? null : [session.dishAfter],
    criteria: {...session.criteria, center: null, restaurantId: parent.id}});
  const documents = await database.queryDocuments(query);
  if (documents.length > customerBiteScorePreparationBatchSize) unavailable();
  const last = documents[documents.length - 1];
  const done = documents.length < customerBiteScorePreparationBatchSize;
  return {documents, rangeIndex: session.rangeIndex,
    after: done ? [parent.geohash, parent.indexId] : session.after,
    currentParent: done ? null : parent, dishAfter: done || !last ? null : last.id,
    complete: false, scanned: scanned + documents.length};
}

function text(dto: CustomerBiteScorePublicDto, key: string): string {
  return typeof dto[key] === "string" ? dto[key] : "";
}
function strings(dto: CustomerBiteScorePublicDto, key: string): string[] {
  return Array.isArray(dto[key]) ? dto[key].filter((v): v is string => typeof v === "string") : [];
}

function matchAndRank(criteria: CustomerBiteScoreCriteria, dto: CustomerBiteScorePublicDto,
  parent: CustomerBiteScorePublicDto): {rank0: number; rank1: number; rank2: number; distanceMiles: number | null} | null {
  const distanceMiles = criteria.center === null ? null : exactCustomerBiteSaverDistanceMiles(criteria.center,
    {latitude: parent.latitude as number, longitude: parent.longitude as number});
  if (distanceMiles !== null && distanceMiles > criteria.radiusMiles) return null;
  if (criteria.restaurantId !== null && parent.sourceDocumentId !== criteria.restaurantId) return null;
  if (criteria.center === null && criteria.locationText &&
      !text(parent, "city").toLowerCase().includes(criteria.locationText) &&
      !text(parent, "zipCode").toLowerCase().includes(criteria.locationText)) return null;
  if (criteria.kind === "restaurant") {
    let score = 0;
    if (criteria.finder !== null) {
      if (text(dto, "state").trim().toUpperCase() !== criteria.finder.state) return null;
      const filter = criteria.finder.location;
      if (criteria.finder.mode === "close") {
        if (normalizeBiteScoreFinderText(text(dto, "city")) !== normalizeBiteScoreFinderText(filter)) return null;
        score = biteScoreFinderCloseScore(criteria.text, text(dto, "displayName"));
      } else {
        if (filter && (/^[0-9]+$/u.test(filter)
          ? !text(dto, "zipCode").trim().startsWith(filter)
          : !normalizeBiteScoreFinderText(text(dto, "city")).includes(normalizeBiteScoreFinderText(filter)))) return null;
        score = biteScoreFinderNameScore(criteria.text, text(dto, "displayName"));
      }
      if (score <= 0) return null;
    } else if (criteria.text && !matchesBiteScorePlainText(text(dto, "displayName"), criteria.text)) return null;
    return {rank0: criteria.finder === null && criteria.sort === "Closest" ? distanceMiles ?? 0 : -score,
      rank1: 0, rank2: 0, distanceMiles};
  }
  const category = {category: text(dto, "category"), subcategory: text(dto, "subcategory"),
    categoryManualKeywords: text(dto, "categoryManualKeywords"), categoryTags: strings(dto, "categoryTags")};
  const terms = biteScoreCategoryTerms(category);
  if (criteria.categoryQueries.length > 0 && !criteria.categoryQueries.some((query) => matchesBiteScoreFood(terms, query))) return null;
  if (criteria.text && !matchesBiteScoreFood([text(dto, "displayName")], criteria.text, true) &&
      !matchesBiteScorePlainText(text(parent, "displayName"), criteria.text) &&
      !matchesBiteScoreFood(terms, criteria.text, true) && !matchesBiteScoreFood([
        [category.subcategory.trim(), category.categoryManualKeywords.trim(), ...category.categoryTags].filter(Boolean).join(" "),
      ], criteria.text, true)) return null;
  const score = -(dto.overallBiteScore as number);
  const count = -(dto.ratingCount as number);
  if (criteria.sort === "Dish Name") return {rank0: 0, rank1: 0, rank2: 0, distanceMiles};
  const component = {"Best Value": "valueScoreAverage", "Best Flavor": "tastinessScoreAverage",
    "Highest Quality": "qualityScoreAverage", "Most Enjoyed": "overallImpressionAverage"} as const;
  if (criteria.sort in component) {
    const v = dto[component[criteria.sort as keyof typeof component]];
    return {rank0: typeof v === "number" ? -v : 1, rank1: score, rank2: count, distanceMiles};
  }
  if (criteria.sort === "Closest") return {rank0: distanceMiles ?? 0, rank1: score, rank2: count, distanceMiles};
  if (criteria.sort === "Most Reviewed") return {rank0: count, rank1: score, rank2: 0, distanceMiles};
  return {rank0: score, rank1: count, rank2: 0, distanceMiles};
}

function resultPath(session: Session, sourceId: string): string {
  return `${customerBiteScoreResultCollection}/${customerBiteScoreDigest("result", session.sessionId, session.attempt, sourceId)}`;
}

async function buildResults(database: SearchDatabase, session: Session, documents: readonly StoredDocument[]): Promise<Result[]> {
  const projections = documents.map((document) => ({document,
    projection: readCustomerBiteScorePublicProjection(document, session.criteria.kind)}));
  const parentPaths = [...new Set(projections.flatMap(({projection}) => projection === null || session.criteria.kind === "restaurant" ? [] :
    [customerBiteScoreIndexPath("restaurant", projection.restaurantSourceDocumentId as string)]))];
  const parents = new Map((await database.getDocuments(parentPaths)).filter((v): v is StoredDocument => v !== null)
    .map((v) => [v.path, readCustomerBiteScorePublicProjection(v, "restaurant")]));
  const result: Result[] = [];
  for (const {document, projection} of projections) {
    if (projection === null) continue;
    const parentPath = session.criteria.kind === "restaurant" ? document.path :
      customerBiteScoreIndexPath("restaurant", projection.restaurantSourceDocumentId as string);
    const parent = session.criteria.kind === "restaurant" ? projection : parents.get(parentPath);
    if (parent == null) continue;
    const ranks = matchAndRank(session.criteria, projection, parent);
    if (ranks === null) continue;
    const sourceId = projection.sourceDocumentId as string;
    const idKey = customerBiteScoreUtf16Key(sourceId);
    result.push({version: customerBiteScoreSearchVersion, sessionId: session.sessionId, attempt: session.attempt,
      sourceId, sourceIndexPath: document.path, sourceProjectionFingerprint: customerBiteScoreDigest(projection),
      parentIndexPath: parentPath, parentProjectionFingerprint: customerBiteScoreDigest(parent),
      rank0: ranks.rank0, rank1: ranks.rank1, rank2: ranks.rank2,
      nameKey: customerBiteScoreUtf16Key(text(projection, "displayName").toLowerCase()),
      idKey0: idKey.subarray(0, 1500), idKey1: idKey.subarray(1500), expiresAt: session.expiresAt});
  }
  return result;
}

export async function advanceCustomerBiteScoreSearchHandler(database: SearchDatabase, raw: unknown,
  context: CustomerBiteScoreSearchContext): Promise<CustomerBiteScoreSearchResponse> {
  const input = parseContinuation(raw);
  const timestamp = now(context);
  const leaseId = randomBytes(16).toString("hex");
  const claim = await database.runTransaction(async (transaction) => {
    const session = await requireCurrentSession(transaction, input, context);
    if (session.state !== "preparing" || session.leaseUntilMs > timestamp) return {session, claimed: false};
    const admission = await transaction.getDocument(actorPath(session.actor));
    const updated = {...session, leaseId, leaseUntilMs: timestamp + customerBiteScoreLeaseLifetimeMs,
      idleExpiresAtMs: Math.min(session.absoluteExpiresAtMs, timestamp + customerBiteScoreIdleLifetimeMs)};
    transaction.setDocument(sessionPath(session.sessionId), updated);
    if (admission !== null && Array.isArray(admission.data.pending)) {
      transaction.setDocument(admission.path, {...admission.data,
        pending: admission.data.pending.filter(biteScoreRecord).map((v) =>
          v.sessionId === session.sessionId ? {...v, expiresAtMs: updated.idleExpiresAtMs} : v)});
    }
    return {session: updated, claimed: true};
  });
  if (!claim.claimed) return response(claim.session);
  try {
    const session = claim.session;
    const batch = await prepareBatch(database, session);
    const results = await buildResults(database, session, batch.documents);
    const complete = batch.complete;
    const next = await database.runTransaction(async (transaction) => {
      const current = await requireCurrentSession(transaction, input, context);
      if (current.leaseId !== leaseId || current.attempt !== session.attempt) unavailable();
      const catalog = complete ? await generations(transaction) : session.generations;
      const admission = complete ? await transaction.getDocument(actorPath(session.actor)) : null;
      const changed = catalog.some((v, i) => v !== session.generations[i]);
      const updated: Session = {...current, leaseId: null, leaseUntilMs: 0, rangeIndex: batch.rangeIndex,
        after: batch.after, currentParent: batch.currentParent, dishAfter: batch.dishAfter,
        scannedCount: current.scannedCount + batch.scanned,
        state: complete ? "ready" : "preparing"};
      if (changed) {
        updated.state = session.attempt >= 2 ? "failed" : "preparing";
        updated.attempt = Math.min(2, session.attempt + 1);
        updated.generations = catalog;
        updated.rangeIndex = 0;
        updated.after = null;
        updated.currentParent = null;
        updated.dishAfter = null;
        updated.scannedCount = 0;
      } else {
        for (const result of results) transaction.setDocument(resultPath(session, result.sourceId), result);
      }
      transaction.setDocument(sessionPath(session.sessionId), updated);
      if (updated.state !== "preparing" && admission !== null) {
        const pending = Array.isArray(admission.data.pending) ? admission.data.pending.filter(biteScoreRecord)
          .filter((v) => v.sessionId !== session.sessionId) : [];
        transaction.setDocument(admission.path, {...admission.data, pending});
      }
      return updated;
    });
    return response(next);
  } catch (error) {
    // Retryable failures release only this lease. A later request can resume the
    // exact stored scan cursor; already committed batches are never rescanned.
    await database.runTransaction(async (transaction) => {
      const stored = await transaction.getDocument(sessionPath(input.sessionId));
      if (stored?.data.leaseId === leaseId) transaction.setDocument(stored.path,
        {...stored.data, leaseId: null, leaseUntilMs: 0});
    });
    throw error;
  }
}

const resultOrder = Object.freeze(["rank0", "rank1", "rank2", "nameKey", "idKey0", "idKey1", "__name__"]
  .map((field) => Object.freeze({field, direction: "asc" as const})));

export function customerBiteScoreResultQuery(sessionId: string, attempt: number, limit: number,
  after?: readonly unknown[]): SearchQuery {
  return {collectionPath: customerBiteScoreResultCollection,
    filters: [{field: "sessionId", operation: "==", value: sessionId}, {field: "attempt", operation: "==", value: attempt}],
    orders: resultOrder, limit, ...(after === undefined ? {} : {startAfter: after})};
}

function resultTuple(document: StoredDocument): readonly unknown[] {
  return resultOrder.map(({field}) => field === "__name__" ? document.id : document.data[field]);
}

async function visibleResults(database: SearchDatabase, session: Session,
  documents: readonly StoredDocument[]): Promise<readonly CustomerBiteScorePublicDto[]> {
  const paths = new Set<string>();
  for (const document of documents) {
    const r = document.data;
    if (r.version !== customerBiteScoreSearchVersion || r.sessionId !== session.sessionId || r.attempt !== session.attempt ||
        typeof r.sourceId !== "string" || document.path !== resultPath(session, r.sourceId)) unavailable();
    const sourcePath = customerBiteScoreIndexPath(session.criteria.kind, r.sourceId);
    if (sourcePath !== r.sourceIndexPath || typeof r.parentIndexPath !== "string") unavailable();
    paths.add(sourcePath);
    paths.add(r.parentIndexPath);
    paths.add(`${session.criteria.kind === "dish" ? "bitescore_dishes" : "bitescore_restaurants"}/${r.sourceId}`);
  }
  const current = new Map((await database.getDocuments([...paths])).filter((v): v is StoredDocument => v !== null).map((v) => [v.path, v]));
  const parentRootPaths = [...new Set(documents.flatMap((v) => {
    const p = readCustomerBiteScorePublicProjection(current.get(v.data.parentIndexPath as string) ?? null, "restaurant");
    return p === null ? [] : [`bitescore_restaurants/${p.sourceDocumentId}`];
  }))];
  const roots = new Map((await database.getDocuments(parentRootPaths)).filter((v): v is StoredDocument => v !== null).map((v) => [v.path, v]));
  const result: CustomerBiteScorePublicDto[] = [];
  for (const document of documents) {
    const r = document.data;
    const projection = readCustomerBiteScorePublicProjection(current.get(r.sourceIndexPath as string) ?? null, session.criteria.kind);
    const parent = readCustomerBiteScorePublicProjection(current.get(r.parentIndexPath as string) ?? null, "restaurant");
    if (projection === null || parent === null || customerBiteScoreDigest(projection) !== r.sourceProjectionFingerprint ||
        customerBiteScoreDigest(parent) !== r.parentProjectionFingerprint) continue;
    const root = roots.get(`bitescore_restaurants/${parent.sourceDocumentId}`);
    const dish = session.criteria.kind === "dish" ? current.get(`bitescore_dishes/${r.sourceId}`) : null;
    if (root === undefined || !biteScoreRestaurantIsActive(root.data) ||
        (session.criteria.kind === "dish" && (dish == null || dish.data.isActive === false ||
          (dish.data.mergedIntoDishId != null && dish.data.mergedIntoDishId !== "") ||
          dish.data.restaurantId !== parent.sourceDocumentId))) continue;
    // Reconstruct from the verified allowlist instead of trusting a stored DTO
    // field if a future server writer accidentally adds private metadata.
    result.push(Object.freeze({...projection, ...(session.criteria.kind === "dish" ? {restaurant: parent} : {}),
      distanceMiles: session.criteria.center === null ? null : exactCustomerBiteSaverDistanceMiles(session.criteria.center,
        {latitude: parent.latitude as number, longitude: parent.longitude as number})}));
  }
  return Object.freeze(result);
}

export async function getCustomerBiteScoreSearchPageHandler(database: SearchDatabase, raw: unknown,
  context: CustomerBiteScoreSearchContext): Promise<CustomerBiteScoreSearchResponse> {
  const input = parseContinuation(raw);
  const session = await database.runTransaction(async (transaction) => {
    const current = await requireCurrentSession(transaction, input, context);
    const updated = {...current, idleExpiresAtMs: Math.min(current.absoluteExpiresAtMs, now(context) + customerBiteScoreIdleLifetimeMs)};
    transaction.setDocument(sessionPath(current.sessionId), updated);
    return updated;
  });
  if (session.state !== "ready") return response(session);
  const pageSize = session.criteria.finder === null ? customerBiteScorePageSize : customerBiteScoreFinderSize;
  const binding = {source: "customerBiteScore", searchMode: session.criteria.kind,
    queryFingerprint: session.queryFingerprint, pageSize, callerBinding: session.actor};
  let after: readonly unknown[] | undefined;
  if (input.cursor !== null) {
    if (session.criteria.finder !== null) unavailable();
    const decoded = context.cursorCodec.decode(input.cursor, {...binding, purposes: ["forward"]});
    if (decoded.sessionId !== session.sessionId || decoded.sortTuple.length !== 2 ||
        decoded.sortTuple[0] !== session.attempt || typeof decoded.sortTuple[1] !== "string") unavailable();
    const result = await database.getDocument(`${customerBiteScoreResultCollection}/${decoded.sortTuple[1]}`);
    if (result === null || result.data.sessionId !== session.sessionId || result.data.attempt !== session.attempt) unavailable();
    after = resultTuple(result);
  }
  const documents = await database.queryDocuments(customerBiteScoreResultQuery(session.sessionId, session.attempt, pageSize + 1, after));
  if (documents.length > pageSize + 1) unavailable();
  const page = documents.slice(0, pageSize);
  const items = await visibleResults(database, session, page);
  // Recheck criteria/actor after asynchronous hydration before publishing.
  await database.runTransaction((transaction) => requireCurrentSession(transaction, input, context));
  const last = page[page.length - 1];
  const hasMore = session.criteria.finder === null && documents.length > pageSize;
  return Object.freeze({...response(session), items, hasMore,
    nextCursor: !hasMore || last === undefined ? null : context.cursorCodec.encode({...binding,
      purpose: "forward", sessionId: session.sessionId, sortTuple: [session.attempt, last.id],
      lifetimeMs: Math.min(customerBiteScoreIdleLifetimeMs, session.absoluteExpiresAtMs - now(context))})});
}
