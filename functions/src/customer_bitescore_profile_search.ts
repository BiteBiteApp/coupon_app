import {requireAccountWritableInStore} from "./account_deletion_guard.js";
import {randomBytes} from "node:crypto";
import type {CustomerBiteSaverSearchDatabase as Database, CustomerBiteSaverStoredDocument as Document,
  CustomerBiteSaverTransaction as Transaction} from "./customer_bitesaver_search_store.js";
import type {CustomerBiteScoreSearchContext} from "./customer_bitescore_search.js";
import {customerBiteScoreResultQuery} from "./customer_bitescore_search.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {validRestaurantCoordinates, exactCustomerBiteSaverDistanceMiles} from "./restaurant_geo_helpers.js";
import {biteScoreRestaurantIsActive} from "./search_index_builders.js";
import {buildCustomerBiteScoreReview, isCustomerBiteScorePublicReview, customerBiteScoreReviewIndex} from "./customer_bitescore_reads.js";
import {customerBiteScoreExpertIdIsValid, customerBiteScoreExpertMatches} from "./customer_bitescore_search_expert.js";
import {biteScoreRecord, biteScoreRequestString, customerBiteScoreDigest as digest,
  customerBiteScoreAdmissionCollection, customerBiteScoreGenerationShardPaths,
  customerBiteScoreIdleLifetimeMs, customerBiteScoreLeaseLifetimeMs, customerBiteScoreSessionLifetimeMs,
  customerBiteScoreSessionCollection, customerBiteScoreResultCollection, customerBiteScoreIndexPath,
  CustomerBiteScoreSearchError, customerBiteScoreUtf16Key,
  readCustomerBiteScoreGenerationShard, readCustomerBiteScorePublicProjection} from "./customer_bitescore_search_contract.js";

const version = "bitestar.customer-bitescore-profile-list.v1";
import {customerBiteScoreProfileGenerationPath} from "./customer_bitescore_profile_generation.js";
export {customerBiteScoreProfileGenerationCollection, customerBiteScoreProfileGenerationPath, nextCustomerBiteScoreProfileGeneration} from "./customer_bitescore_profile_generation.js";
type Data = Readonly<Record<string, unknown>>;
type Context = CustomerBiteScoreSearchContext & {userId?: string | null};
type Criteria = {kind: "savedRestaurants" | "savedDishes" | "reviews" | "localExpert";
  userId: string; sort: "mostRecent" | "highestRated" | "lowestRated" | "nearest";
  expertTypeId: string | null; location: {latitude: number; longitude: number} | null};
type Session = {version: string; sessionId: string; actor: string; instanceId: string; queryGeneration: number;
  queryFingerprint: string; criteria: Criteria; state: "preparing" | "ready" | "failed"; attempt: number;
  after: string | null; scannedCount: number; generations: number[]; leaseId: string | null; leaseUntilMs: number;
  absoluteExpiresAtMs: number; idleExpiresAtMs: number; expiresAt: Date};
type Candidate = {id: string; sourcePath: string; dishId: string | null; restaurantId: string;
  review: Data | null; dish: Data | null; restaurant: Data; source: Data; fingerprint: string};

function fail(message = "This BiteScore list is unavailable or expired. Refresh the list."): never {
  throw new CustomerBiteScoreSearchError("failed-precondition", message);
}
function id(value: unknown): string {
  const result = readBiteScoreCatalogRestaurantId(value);
  if (result === null || result !== value) fail("Invalid BiteScore identity.");
  return result;
}
function criteria(raw: unknown): Criteria {
  if (!biteScoreRecord(raw) || !["savedRestaurants", "savedDishes", "reviews", "localExpert"].includes(String(raw.kind)) ||
      Object.keys(raw).some((v) => !["kind", "userId", "sort", "expertTypeId", "location"].includes(v))) fail("Invalid BiteScore list criteria.");
  const kind = raw.kind as Criteria["kind"];
  const sort = raw.sort ?? (kind === "localExpert" ? "highestRated" : "mostRecent");
  if (!["mostRecent", "highestRated", "lowestRated", "nearest"].includes(String(sort))) fail("Invalid BiteScore list sort.");
  const expertTypeId = raw.expertTypeId == null ? null : String(raw.expertTypeId);
  if ((kind === "localExpert" && (expertTypeId === null || !customerBiteScoreExpertIdIsValid(expertTypeId))) ||
      (kind !== "localExpert" && expertTypeId !== null)) fail("Invalid expert list.");
  const location = raw.location == null ? null : biteScoreRecord(raw.location) ?
    validRestaurantCoordinates(raw.location.latitude, raw.location.longitude) : null;
  if (raw.location != null && location === null) fail("Invalid list location.");
  return {kind, userId: id(raw.userId), sort: sort as Criteria["sort"], expertTypeId, location};
}
function timestamp(context: Context): number {
  const time = context.nowMs ?? Date.now();
  if (!Number.isSafeInteger(time) || time < 0) fail();
  return time;
}
function actor(context: Context): string {
  if (!context.actorId || context.actorId.length > 2000) fail();
  return digest(version, "actor", context.actorId);
}
function path(sessionId: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sessionId)) fail();
  return `${customerBiteScoreSessionCollection}/${sessionId}`;
}
function instancePath(actorId: string, instanceId: string): string {
  return `${customerBiteScoreAdmissionCollection}/profile_instance_${digest(actorId, instanceId)}`;
}
function admissionPath(actorId: string): string { return `${customerBiteScoreAdmissionCollection}/profile_actor_${actorId}`; }
async function generation(transaction: Transaction, userId: string): Promise<number[]> {
  const documents = await transaction.getDocuments([...customerBiteScoreGenerationShardPaths, customerBiteScoreProfileGenerationPath(userId)]);
  const profile = documents[16]?.data;
  const count = profile?.generation ?? 0;
  if (!Number.isSafeInteger(count) || (count as number) < 0) fail();
  return [...documents.slice(0, 16).map((v) => readCustomerBiteScoreGenerationShard(v?.data)), count as number];
}
function readSession(document: Document | null): Session {
  if (document === null) fail();
  const s = document.data as unknown as Session;
  if (s.version !== version || document.path !== path(s.sessionId) || !["preparing", "ready", "failed"].includes(s.state) ||
      !Number.isSafeInteger(s.attempt) || s.attempt < 0 || s.attempt > 2 || !Array.isArray(s.generations) ||
      s.generations.length !== 17 || !s.generations.every(Number.isSafeInteger) ||
      !Number.isSafeInteger(s.absoluteExpiresAtMs) || !Number.isSafeInteger(s.idleExpiresAtMs) ||
      !Number.isSafeInteger(s.scannedCount) || s.scannedCount < 0 || typeof s.instanceId !== "string" ||
      !Number.isSafeInteger(s.queryGeneration) || (s.after !== null && typeof s.after !== "string")) fail();
  const c = criteria(s.criteria);
  if (digest(version, c) !== s.queryFingerprint) fail();
  return {...s, criteria: c};
}
function continuation(raw: unknown): {sessionId: string; queryFingerprint: string; cursor: unknown} {
  if (!biteScoreRecord(raw) || raw.schemaVersion !== 1 || typeof raw.sessionId !== "string" || typeof raw.queryFingerprint !== "string") fail();
  return {sessionId: raw.sessionId, queryFingerprint: raw.queryFingerprint, cursor: raw.cursor ?? null};
}
function authorize(c: Criteria, context: Context): void {
  if ((c.kind === "savedDishes" || c.kind === "savedRestaurants") && context.userId !== c.userId) {
    throw new CustomerBiteScoreSearchError("permission-denied", "Saved lists belong to the signed-in customer.");
  }
}
async function current(transaction: Transaction, input: ReturnType<typeof continuation>, context: Context): Promise<Session> {
  const session = readSession(await transaction.getDocument(path(input.sessionId)));
  if (session.actor !== actor(context) || session.queryFingerprint !== input.queryFingerprint ||
      timestamp(context) >= Math.min(session.absoluteExpiresAtMs, session.idleExpiresAtMs)) fail();
  authorize(session.criteria, context);
  await requireAccountWritableInStore(transaction, session.criteria.userId);
  if (context.userId) await requireAccountWritableInStore(transaction, context.userId);
  const instance = await transaction.getDocument(instancePath(session.actor, session.instanceId));
  if (instance?.data.sessionId !== session.sessionId || instance.data.queryGeneration !== session.queryGeneration) fail();
  return session;
}
function response(session: Session): Data {
  return {schemaVersion: 1, sessionId: session.sessionId, queryFingerprint: session.queryFingerprint, state: session.state,
    scannedCount: session.scannedCount, pageSize: 25, items: [], hasMore: false, nextCursor: null,
    retryAfterMs: session.state === "preparing" ? 150 : 0};
}

export async function startCustomerBiteScoreProfileListHandler(db: Database, raw: unknown, context: Context): Promise<Data> {
  if (!biteScoreRecord(raw) || raw.schemaVersion !== 1 || !Number.isSafeInteger(raw.queryGeneration) || (raw.queryGeneration as number) < 0) fail();
  const c = criteria(raw.criteria);
  authorize(c, context);
  const instanceId = biteScoreRequestString(raw.clientInstanceId, 128);
  const requestId = biteScoreRequestString(raw.clientRequestId, 128);
  if (!instanceId || !requestId) fail();
  const actorId = actor(context);
  const queryGeneration = raw.queryGeneration as number;
  const time = timestamp(context);
  const queryFingerprint = digest(version, c);
  const sessionId = digest(version, actorId, instanceId, requestId);
  return response(await db.runTransaction(async (tx) => {
    await requireAccountWritableInStore(tx, c.userId);
    if (context.userId) await requireAccountWritableInStore(tx, context.userId);
    const [instance, admission, previous, generations] = await Promise.all([tx.getDocument(instancePath(actorId, instanceId)),
      tx.getDocument(admissionPath(actorId)), tx.getDocument(path(sessionId)), generation(tx, c.userId)]);
    if (previous !== null) {
      const s = readSession(previous);
      if (instance?.data.sessionId !== sessionId || s.queryFingerprint !== queryFingerprint || s.queryGeneration !== queryGeneration ||
          time >= Math.min(s.idleExpiresAtMs, s.absoluteExpiresAtMs)) fail();
      return s;
    }
    if (instance && (!Number.isSafeInteger(instance.data.queryGeneration) || (instance.data.queryGeneration as number) >= queryGeneration)) fail();
    const a = admission?.data ?? {};
    const sameWindow = typeof a.windowAtMs === "number" && time - a.windowAtMs < 60_000;
    const starts = sameWindow && typeof a.starts === "number" ? a.starts : 0;
    const pending = Array.isArray(a.pending) ? a.pending.filter(biteScoreRecord).filter((v) =>
      typeof v.expiresAtMs === "number" && v.expiresAtMs > time && v.instanceId !== instanceId) : [];
    if (starts >= 12 || pending.length >= 4) throw new CustomerBiteScoreSearchError("resource-exhausted", "Please wait before preparing another profile list.");
    const s: Session = {version, sessionId, actor: actorId, instanceId, queryGeneration, queryFingerprint, criteria: c,
      state: "preparing", attempt: 0, after: null, scannedCount: 0, generations, leaseId: null, leaseUntilMs: 0,
      absoluteExpiresAtMs: time + customerBiteScoreSessionLifetimeMs, idleExpiresAtMs: time + customerBiteScoreIdleLifetimeMs,
      expiresAt: new Date(time + customerBiteScoreSessionLifetimeMs)};
    tx.createDocument(path(sessionId), s);
    tx.setDocument(instancePath(actorId, instanceId), {version, sessionId, queryGeneration, expiresAt: s.expiresAt});
    tx.setDocument(admissionPath(actorId), {version, windowAtMs: sameWindow ? a.windowAtMs : time, starts: starts + 1,
      pending: [...pending, {sessionId, instanceId, expiresAtMs: s.idleExpiresAtMs}], expiresAt: s.expiresAt});
    return s;
  }));
}

function sourceCollection(c: Criteria): string {
  return c.kind === "savedRestaurants" ? `user_profiles/${c.userId}/favorite_restaurants` :
    c.kind === "savedDishes" ? `user_profiles/${c.userId}/favorite_dishes` : customerBiteScoreReviewIndex;
}
function sourceIdentity(document: Document, c: Criteria): {id: string; dishId: string | null; restaurantId: string | null} | null {
  const data = document.data;
  if (c.kind === "savedRestaurants") {
    if (data.restaurantType === "bitesaver" || String(data.favoriteKind ?? "").startsWith("bitesaver")) return null;
    const target = readBiteScoreCatalogRestaurantId(data.restaurantId ?? document.id);
    return target === null ? null : {id: target, dishId: null, restaurantId: target};
  }
  if (c.kind === "savedDishes") {
    const target = readBiteScoreCatalogRestaurantId(data.dishId ?? document.id);
    return target === null ? null : {id: target, dishId: target, restaurantId: null};
  }
  const reviewId = readBiteScoreCatalogRestaurantId(data.reviewId);
  const dishId = readBiteScoreCatalogRestaurantId(data.dishId);
  const restaurantId = readBiteScoreCatalogRestaurantId(data.restaurantId);
  return reviewId && dishId && restaurantId && data.userId === c.userId && data.publicVisible === true ?
    {id: reviewId, dishId, restaurantId} : null;
}
async function hydrate(db: Database, documents: readonly Document[], c: Criteria, live: boolean): Promise<Candidate[]> {
  const entries = documents.map((document) => ({document, ids: sourceIdentity(document, c)})).filter((v) => v.ids !== null);
  const dishPaths = [...new Set(entries.flatMap((v) => v.ids!.dishId === null ? [] : [customerBiteScoreIndexPath("dish", v.ids!.dishId)]))];
  const dishes = new Map((await db.getDocuments(dishPaths)).filter((v): v is Document => v !== null)
    .map((v) => [v.path, readCustomerBiteScorePublicProjection(v, "dish")]));
  const parents = [...new Set(entries.flatMap((v) => {
    const dish = v.ids!.dishId === null ? null : dishes.get(customerBiteScoreIndexPath("dish", v.ids!.dishId));
    const parent = v.ids!.restaurantId ?? dish?.restaurantSourceDocumentId;
    return typeof parent === "string" ? [customerBiteScoreIndexPath("restaurant", parent)] : [];
  }))];
  const restaurants = new Map((await db.getDocuments(parents)).filter((v): v is Document => v !== null)
    .map((v) => [v.path, readCustomerBiteScorePublicProjection(v, "restaurant")]));
  const paths = live ? [...new Set(entries.flatMap(({ids}) => {
    const dish = ids!.dishId === null ? null : dishes.get(customerBiteScoreIndexPath("dish", ids!.dishId));
    const parent = ids!.restaurantId ?? dish?.restaurantSourceDocumentId;
    return [...(ids!.dishId ? [`bitescore_dishes/${ids!.dishId}`] : []),
      ...(typeof parent === "string" ? [`bitescore_restaurants/${parent}`] : []),
      ...(c.kind === "reviews" || c.kind === "localExpert" ? [`dish_reviews/${ids!.id}`] : [])];
  }))] : [];
  const roots = new Map((await db.getDocuments(paths)).filter((v): v is Document => v !== null).map((v) => [v.path, v.data]));
  const result: Candidate[] = [];
  for (const {document, ids} of entries) {
    const dish = ids!.dishId === null ? null : dishes.get(customerBiteScoreIndexPath("dish", ids!.dishId)) ?? null;
    const parentId = ids!.restaurantId ?? dish?.restaurantSourceDocumentId;
    if (typeof parentId !== "string") continue;
    const restaurant = restaurants.get(customerBiteScoreIndexPath("restaurant", parentId));
    if (!restaurant || (ids!.dishId !== null && (!dish || dish.restaurantSourceDocumentId !== parentId))) continue;
    const rawReview = live ? roots.get(`dish_reviews/${ids!.id}`) : null;
    let review: Data | null = null;
    if (c.kind === "reviews" || c.kind === "localExpert") {
      if (!biteScoreRecord(document.data.review)) continue;
      review = document.data.review;
      if (live) {
        if (!rawReview || !isCustomerBiteScorePublicReview(rawReview) || (c.kind === "localExpert" && rawReview.isDeleted === true)) continue;
        const current = buildCustomerBiteScoreReview(ids!.id, rawReview, document.data);
        if (!current || current.userId !== c.userId || current.dishId !== ids!.dishId || current.restaurantId !== parentId ||
            digest(current.review) !== digest(review)) continue;
      }
      if (c.kind === "localExpert" && (!dish || !customerBiteScoreExpertMatches(dish, c.expertTypeId!))) continue;
    }
    if (live) {
      const root = roots.get(`bitescore_restaurants/${parentId}`);
      const rawDish = ids!.dishId === null ? null : roots.get(`bitescore_dishes/${ids!.dishId}`);
      if (!root || !biteScoreRestaurantIsActive(root) || (ids!.dishId !== null && (!rawDish || rawDish.isActive === false ||
          Boolean(rawDish.mergedIntoDishId) || rawDish.restaurantId !== parentId))) continue;
    }
    result.push({id: ids!.id, sourcePath: document.path, dishId: ids!.dishId, restaurantId: parentId,
      dish, restaurant, review, source: document.data, fingerprint: digest(dish, restaurant, review)});
  }
  return result;
}
function resultPath(s: Session, candidateId: string): string {
  return `${customerBiteScoreResultCollection}/${digest(version, s.sessionId, s.attempt, candidateId)}`;
}
function ranked(candidate: Candidate, s: Session): Data {
  const c = s.criteria;
  let rank0 = 0;
  let rank1 = 0;
  let name = "";
  if (c.kind === "savedDishes") rank0 = -(candidate.dish!.overallBiteScore as number);
  if (c.kind === "savedRestaurants" || c.kind === "savedDishes") name = String((candidate.dish ?? candidate.restaurant).displayName).toLowerCase();
  else {
    const score = candidate.review!.overallBiteScore as number;
    const date = typeof candidate.review!.createdAtMicros === "number" ? candidate.review!.createdAtMicros : (candidate.review!.createdAtMs as number) * 1000;
    if (c.kind === "reviews" || c.sort === "mostRecent" || (c.sort === "nearest" && c.location === null)) rank0 = -date;
    else if (c.sort === "highestRated") { rank0 = -score; rank1 = date; }
    else if (c.sort === "lowestRated") { rank0 = score; rank1 = -date; }
    else { rank0 = exactCustomerBiteSaverDistanceMiles(c.location!, {latitude: candidate.restaurant.latitude as number,
      longitude: candidate.restaurant.longitude as number}); rank1 = -date; }
  }
  const key = customerBiteScoreUtf16Key(candidate.id);
  return {version, sessionId: s.sessionId, attempt: s.attempt, candidateId: candidate.id, sourcePath: candidate.sourcePath,
    fingerprint: candidate.fingerprint, rank0, rank1, rank2: 0, nameKey: customerBiteScoreUtf16Key(name),
    idKey0: key.subarray(0, 1500), idKey1: key.subarray(1500), expiresAt: s.expiresAt};
}

export async function advanceCustomerBiteScoreProfileListHandler(db: Database, raw: unknown, context: Context): Promise<Data> {
  const input = continuation(raw);
  const time = timestamp(context);
  const leaseId = randomBytes(16).toString("hex");
  const claim = await db.runTransaction(async (tx) => {
    const s = await current(tx, input, context);
    if (s.state !== "preparing" || s.leaseUntilMs > time) return {session: s, claimed: false};
    const admission = await tx.getDocument(admissionPath(s.actor));
    const updated = {...s, leaseId, leaseUntilMs: time + customerBiteScoreLeaseLifetimeMs,
      idleExpiresAtMs: Math.min(s.absoluteExpiresAtMs, time + customerBiteScoreIdleLifetimeMs)};
    tx.setDocument(path(s.sessionId), updated);
    if (admission && Array.isArray(admission.data.pending)) tx.setDocument(admission.path, {...admission.data,
      pending: admission.data.pending.filter(biteScoreRecord).map((v) => v.sessionId === s.sessionId ? {...v, expiresAtMs: updated.idleExpiresAtMs} : v)});
    return {session: updated, claimed: true};
  });
  if (!claim.claimed) return response(claim.session);
  const s = claim.session;
  try {
    const isReview = s.criteria.kind === "reviews" || s.criteria.kind === "localExpert";
    const documents = await db.queryDocuments({collectionPath: sourceCollection(s.criteria),
      filters: isReview ? [{field: "userId", operation: "==", value: s.criteria.userId}, {field: "publicVisible", operation: "==", value: true}] : [],
      orders: [{field: "__name__", direction: "asc"}], limit: 25, ...(s.after === null ? {} : {startAfter: [s.after]})});
    if (documents.length > 25) fail();
    const candidates = await hydrate(db, documents, s.criteria, true);
    return response(await db.runTransaction(async (tx) => {
      const live = await current(tx, input, context);
      if (live.leaseId !== leaseId || live.attempt !== s.attempt) fail();
      const complete = documents.length < 25;
      const generations = complete ? await generation(tx, s.criteria.userId) : s.generations;
      const admission = complete ? await tx.getDocument(admissionPath(s.actor)) : null;
      const changed = generations.some((v, i) => v !== s.generations[i]);
      const next: Session = {...live, after: documents[documents.length - 1]?.id ?? live.after,
        scannedCount: live.scannedCount + documents.length, state: complete ? "ready" : "preparing", leaseId: null, leaseUntilMs: 0};
      if (changed) {
        next.state = s.attempt >= 2 ? "failed" : "preparing";
        next.attempt = Math.min(2, s.attempt + 1);
        next.after = null; next.scannedCount = 0; next.generations = generations;
      } else for (const candidate of candidates) tx.setDocument(resultPath(s, candidate.id), ranked(candidate, s));
      tx.setDocument(path(s.sessionId), next);
      if (next.state !== "preparing" && admission) tx.setDocument(admission.path, {...admission.data,
        pending: Array.isArray(admission.data.pending) ? admission.data.pending.filter(biteScoreRecord).filter((v) => v.sessionId !== s.sessionId) : []});
      return next;
    }));
  } catch (error) {
    await db.runTransaction(async (tx) => {
      const stored = await tx.getDocument(path(s.sessionId));
      if (stored?.data.leaseId === leaseId) tx.setDocument(stored.path, {...stored.data, leaseId: null, leaseUntilMs: 0});
    });
    throw error;
  }
}

export async function getCustomerBiteScoreProfileListPageHandler(db: Database, raw: unknown, context: Context): Promise<Data> {
  const input = continuation(raw);
  const s = await db.runTransaction(async (tx) => {
    const live = await current(tx, input, context);
    const next = {...live, idleExpiresAtMs: Math.min(live.absoluteExpiresAtMs, timestamp(context) + customerBiteScoreIdleLifetimeMs)};
    tx.setDocument(path(live.sessionId), next);
    return next;
  });
  if (s.state !== "ready") return response(s);
  const binding = {source: "customerBiteScoreProfile", searchMode: s.criteria.kind, queryFingerprint: s.queryFingerprint,
    pageSize: 25, callerBinding: s.actor};
  let after: readonly unknown[] | undefined;
  if (input.cursor !== null) {
    const decoded = context.cursorCodec.decode(input.cursor, {...binding, purposes: ["forward"]});
    if (decoded.sessionId !== s.sessionId || decoded.sortTuple.length !== 2 || decoded.sortTuple[0] !== s.attempt ||
        typeof decoded.sortTuple[1] !== "string" || !/^[a-f0-9]{64}$/u.test(decoded.sortTuple[1])) fail();
    const last = await db.getDocument(`${customerBiteScoreResultCollection}/${decoded.sortTuple[1]}`);
    if (!last || last.data.sessionId !== s.sessionId || last.data.attempt !== s.attempt || last.data.version !== version) fail();
    after = [last.data.rank0, last.data.rank1, last.data.rank2, last.data.nameKey, last.data.idKey0, last.data.idKey1, last.id];
  }
  const documents = await db.queryDocuments(customerBiteScoreResultQuery(s.sessionId, s.attempt, 26, after));
  if (documents.length > 26) fail();
  const selected = documents.slice(0, 25);
  for (const d of selected) if (d.data.version !== version || d.data.sessionId !== s.sessionId || d.data.attempt !== s.attempt ||
    typeof d.data.sourcePath !== "string" || !d.data.sourcePath.startsWith(`${sourceCollection(s.criteria)}/`) ||
    typeof d.data.candidateId !== "string" || d.path !== resultPath(s, d.data.candidateId)) fail();
  const sources = await db.getDocuments(selected.map((v) => v.data.sourcePath as string));
  const candidates = await hydrate(db, sources.filter((v): v is Document => v !== null), s.criteria, true);
  const byPath = new Map(candidates.map((v) => [v.sourcePath, v]));
  const items = selected.flatMap((d) => {
    const candidate = byPath.get(d.data.sourcePath as string);
    if (!candidate || candidate.id !== d.data.candidateId || candidate.fingerprint !== d.data.fingerprint) return [];
    return [{restaurant: candidate.restaurant, ...(candidate.dish ? {dish: candidate.dish} : {}),
      ...(candidate.review ? {review: candidate.review} : {})}];
  });
  await db.runTransaction((tx) => current(tx, input, context));
  const last = selected[selected.length - 1];
  const hasMore = documents.length > 25;
  return {...response(s), items, hasMore, nextCursor: hasMore && last ? context.cursorCodec.encode({...binding,
    purpose: "forward", sessionId: s.sessionId, sortTuple: [s.attempt, last.id],
    lifetimeMs: Math.min(customerBiteScoreIdleLifetimeMs, s.absoluteExpiresAtMs - timestamp(context))}) : null};
}
