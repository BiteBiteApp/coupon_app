import {isDeepStrictEqual} from "node:util";
import {createHash} from "node:crypto";
import {FieldPath, type Firestore, type Query, type Transaction, Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {createQueryFingerprint} from "./query_fingerprint.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {biteScoreRestaurantIsActive} from "./search_index_builders.js";
import {
  biteScoreRecord, biteScoreRequestString, customerBiteScoreGenerationShardPaths,
  customerBiteScoreIndexPath, readCustomerBiteScoreGenerationShard,
  readCustomerBiteScorePublicProjection,
} from "./customer_bitescore_search_contract.js";
import type {CustomerBiteScoreReadContext} from "./customer_bitescore_reads.js";

const version = "bitestar.customer-bitescore-suggestions.v1";
export const customerBiteScoreSuggestionSessions = "private_bitescore_suggestion_sessions";
export const customerBiteScoreSuggestionAdmission = "private_bitescore_suggestion_admission";
export const customerBiteScoreSuggestionGenerations = "private_bitescore_suggestion_generations";
const catalogGenerationPath = `${customerBiteScoreSuggestionGenerations}/catalog`;
const batchSize = 25;
const topSize = 8;
const lifetimeMs = 15 * 60_000;
type Data = Record<string, unknown>;
type Kind = "catalog" | "similar";
type Candidate = {id: string; score: number; name: string; value: Data};
type Session = {version: string; actor: string; kind: Kind; fingerprint: string; generation: number;
  requestId: string; step: number; after: string | null; top: Candidate[]; ready: boolean;
  sourceGenerations: number[]; expiresAtMs: number; expiresAt: Timestamp};
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function unavailable(): never { throw new HttpsError("failed-precondition", "Suggestions changed or expired. Please try again."); }
function exactId(value: unknown): string {
  const result = readBiteScoreCatalogRestaurantId(value);
  if (!result || result !== value) throw new HttpsError("invalid-argument", "Invalid restaurant identity.");
  return result;
}
function compare(a: Candidate, b: Candidate): number {
  return b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function tokens(value: string): string[] { return value.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean); }
function normalized(value: string): string { return value.trim().toLowerCase().replace(/[^\w\s]+/gu, " ").replace(/\s+/gu, " ").trim(); }
function editDistance(left: string, right: string): number {
  let previous = Array.from({length: right.length + 1}, (_, i) => i);
  for (let i = 0; i < left.length; i++) {
    const row = [i + 1];
    for (let j = 0; j < right.length; j++) row.push(Math.min(row[j] + 1, previous[j + 1] + 1, previous[j] + (left[i] === right[j] ? 0 : 1)));
    previous = row;
  }
  return previous[right.length];
}
/** Same Dart UTF-16/string and ASCII-token ranking as the existing create flow. */
export function customerBiteScoreSimilarDishScore(query: string, dishName: string): number {
  query = normalized(query); const name = normalized(dishName);
  if (!query || !name) return 0;
  if (name === query) return 1;
  if (name.includes(query) || query.includes(name)) return 0.88 + 0.1 * Math.min(name.length, query.length) / Math.max(name.length, query.length);
  const queryTokens = new Set(query.split(" ")); const dishTokens = new Set(name.split(" "));
  const shared = [...queryTokens].filter((v) => dishTokens.has(v)).length;
  return Math.max(shared ? 0.62 + 0.12 * shared / queryTokens.size : 0, 1 - editDistance(name, query) / Math.max(name.length, query.length));
}
export function customerBiteScoreCatalogCandidate(id: string, raw: Data, query: string): Candidate | null {
  const canonicalName = [raw.canonicalName, raw.name, raw.title].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  if (!canonicalName) return null;
  const name = canonicalName.trim(); const lower = name.toLowerCase();
  const aliases = Array.isArray(raw.aliases) ? raw.aliases.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()).filter(Boolean) : [];
  const fullTerms = [lower, ...aliases];
  const words = new Set(fullTerms.flatMap((v) => [v, ...tokens(v)]));
  const queryTokens = tokens(query);
  if (!queryTokens.length || !queryTokens.every((v) => [...words].some((word) => word.includes(v)))) return null;
  let score = queryTokens.length * 10 - name.length;
  if (lower === query) score += 500;
  if (lower.startsWith(query)) score += 250;
  if (lower.includes(query)) score += 120;
  if (fullTerms.some((v) => v.startsWith(query))) score += 80;
  // The create form displays two aliases. Other catalog fields never cross this boundary.
  return {id, name: lower, score, value: {canonicalName: name, aliases: aliases.slice(0, 2)}};
}
function accept(top: Candidate[], candidate: Candidate, kind: Kind): Candidate[] {
  const key = (v: Candidate) => kind === "catalog" ? v.name : v.id;
  const old = top.find((v) => key(v) === key(candidate));
  if (old && compare(old, candidate) <= 0) return top;
  return [...top.filter((v) => key(v) !== key(candidate)), candidate].sort(compare).slice(0, topSize);
}

async function validateReady(db: Firestore, tx: Transaction, session: Session, query: string, restaurantId: string | null): Promise<Session> {
  if (!session.ready) return session;
  if (session.kind === "catalog") {
    const sources = session.top.length ? await tx.getAll(...session.top.map((item) => db.doc(`dish_catalog/${item.id}`))) : [];
    sources.forEach((source, i) => {
      const current = source.exists ? customerBiteScoreCatalogCandidate(source.id, source.data()!, query) : null;
      if (!isDeepStrictEqual(current, session.top[i])) unavailable();
    });
  } else {
    const [parent, parentIndex, ...sources] = await tx.getAll(db.doc(`bitescore_restaurants/${restaurantId}`), db.doc(customerBiteScoreIndexPath("restaurant", restaurantId!)), ...session.top.flatMap((item) => [db.doc(`bitescore_dishes/${item.id}`), db.doc(customerBiteScoreIndexPath("dish", item.id))]));
    const restaurant = parentIndex.exists ? readCustomerBiteScorePublicProjection({id: parentIndex.id, path: parentIndex.ref.path, data: parentIndex.data()!}, "restaurant") : null;
    if (!parent.exists || !biteScoreRestaurantIsActive(parent.data()!) || !restaurant) unavailable();
    session.top.forEach((item, i) => {
      const raw = sources[i * 2].data(); const index = sources[i * 2 + 1];
      const dto = index.exists ? readCustomerBiteScorePublicProjection({id: index.id, path: index.ref.path, data: index.data()!}, "dish") : null;
      if (!raw || !dto || raw.restaurantId !== restaurantId || raw.isActive === false || raw.active === false || raw.mergedIntoDishId || raw.name !== dto.displayName || !isDeepStrictEqual({...dto, restaurant}, item.value)) unavailable();
    });
  }
  return session;
}

/** Any catalog edit invalidates in-progress ranking. Duplicate events only cause a safe refresh. */
export async function reconcileCustomerBiteScoreSuggestionCatalog(db: Firestore): Promise<void> {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(catalogGenerationPath); const previous = (await tx.get(ref)).data();
    const generation = previous?.generation ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0 || !Number.isSafeInteger(generation + 1)) unavailable();
    tx.set(ref, {version, generation: generation + 1});
  });
}

/** Each call performs at most one 25-candidate scan and retains only the global best eight. */
export async function getCustomerBiteScoreSuggestionsHandler(db: Firestore, raw: unknown,
  context: CustomerBiteScoreReadContext & {nowMs?: number}): Promise<Data> {
  if (!biteScoreRecord(raw) || raw.schemaVersion !== 1 || (raw.kind !== "catalog" && raw.kind !== "similar")) throw new HttpsError("invalid-argument", "Invalid suggestion request.");
  const kind = raw.kind;
  const query = biteScoreRequestString(raw.query, 800).trim().toLowerCase();
  const restaurantId = kind === "similar" ? exactId(raw.restaurantId) : null;
  if (kind === "catalog" ? !tokens(query).length : !normalized(query)) return {schemaVersion: 1, kind, state: "ready", items: [], nextCursor: null};
  const instanceId = biteScoreRequestString(raw.clientInstanceId, 128);
  const requestId = biteScoreRequestString(raw.clientRequestId, 128);
  const generation = raw.queryGeneration;
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(instanceId) || !/^[A-Za-z0-9_-]{16,128}$/u.test(requestId) || !Number.isSafeInteger(generation) || (generation as number) < 0) throw new HttpsError("invalid-argument", "Invalid suggestion generation.");
  if (!context.actorId) unavailable();
  const actor = hash(context.actorId);
  const fingerprint = createQueryFingerprint({version, kind, query, restaurantId});
  const binding = {queryFingerprint: fingerprint, source: "customerBiteScoreSuggestions", searchMode: kind, pageSize: topSize, callerBinding: actor};
  const sessionId = hash([version, actor, instanceId, kind, requestId, generation]);
  const now = context.nowMs ?? Date.now();
  let expectedStep: number | null = null;
  if (raw.cursor != null) {
    const decoded = context.cursorCodec.decode(raw.cursor as string, {...binding, purposes: ["forward"]});
    if (decoded.sortTuple[0] !== sessionId || !Number.isSafeInteger(decoded.sortTuple[1])) unavailable();
    expectedStep = decoded.sortTuple[1] as number;
  }
  const result = await db.runTransaction(async (tx) => {
    const ref = db.doc(`${customerBiteScoreSuggestionSessions}/${sessionId}`);
    const activeRef = db.doc(`${customerBiteScoreSuggestionAdmission}/active_${hash([actor, instanceId, kind])}`);
    const admissionRef = db.doc(`${customerBiteScoreSuggestionAdmission}/actor_${actor}`);
    const generationPaths = kind === "catalog" ? [catalogGenerationPath] : [...customerBiteScoreGenerationShardPaths];
    const [saved, active, admission, ...generations] = await tx.getAll(ref, activeRef, admissionRef, ...generationPaths.map((p) => db.doc(p)));
    const sourceGenerations = generations.map((doc) => kind === "similar" ? readCustomerBiteScoreGenerationShard(doc.data()) : (doc.data()?.generation ?? 0));
    if (!sourceGenerations.every((v) => Number.isSafeInteger(v) && v >= 0)) unavailable();
    let session: Session;
    if (saved.exists) {
      session = saved.data() as Session;
      if (session.version !== version || session.actor !== actor || session.kind !== kind || session.fingerprint !== fingerprint || session.generation !== generation || session.requestId !== requestId || session.expiresAtMs <= now || active.data()?.sessionId !== sessionId || JSON.stringify(session.sourceGenerations) !== JSON.stringify(sourceGenerations)) unavailable();
      if (expectedStep !== null && expectedStep > session.step) unavailable();
      if (session.ready || expectedStep === null || expectedStep < session.step) return validateReady(db, tx, session, query, restaurantId);
    } else {
      if (expectedStep !== null || (active.exists && active.data()!.generation >= (generation as number))) unavailable();
      const previous = admission.data();
      const inWindow = previous && now - previous.windowAtMs < 60_000;
      const starts = inWindow ? previous.starts : 0;
      if (starts >= 30) throw new HttpsError("resource-exhausted", "Please wait before requesting more suggestions.");
      session = {version, actor, kind, fingerprint, generation: generation as number, requestId, step: 0, after: null, top: [], ready: false, sourceGenerations, expiresAtMs: now + lifetimeMs, expiresAt: Timestamp.fromMillis(now + lifetimeMs)};
    }
    let restaurant: Data | null = null;
    if (restaurantId !== null) {
      const [source, index] = await tx.getAll(db.doc(`bitescore_restaurants/${restaurantId}`), db.doc(customerBiteScoreIndexPath("restaurant", restaurantId)));
      restaurant = index.exists ? readCustomerBiteScorePublicProjection({id: index.id, path: index.ref.path, data: index.data()!}, "restaurant") : null;
      if (!source.exists || !biteScoreRestaurantIsActive(source.data()!) || !restaurant) unavailable();
    }
    let scan: Query = kind === "catalog" ? db.collection("dish_catalog") : db.collection("dish_search_index").where("source", "==", "biteScore").where("restaurantSourceDocumentId", "==", restaurantId).where("publicVisible", "==", true);
    scan = scan.orderBy(FieldPath.documentId()).limit(batchSize);
    if (session.after !== null) scan = scan.startAfter(session.after);
    const page = await tx.get(scan);
    let top = session.top;
    const rawDishes = kind === "similar" && page.docs.length ? await tx.getAll(...page.docs.map((doc) => {
      const sourceId = readBiteScoreCatalogRestaurantId(doc.data().sourceDocumentId);
      return db.doc(sourceId ? `bitescore_dishes/${sourceId}` : "bitescore_dishes/__invalid_suggestion__");
    })) : [];
    for (const [i, doc] of page.docs.entries()) {
      let candidate: Candidate | null = null;
      if (kind === "catalog") candidate = customerBiteScoreCatalogCandidate(doc.id, doc.data(), query);
      else {
        const dto = readCustomerBiteScorePublicProjection({id: doc.id, path: doc.ref.path, data: doc.data()}, "dish");
        const latest = rawDishes[i].data();
        if (dto && latest && latest.restaurantId === restaurantId && latest.isActive !== false && latest.active !== false && !latest.mergedIntoDishId && dto.restaurantSourceDocumentId === restaurantId) {
          if (latest.name !== dto.displayName) unavailable();
          const score = customerBiteScoreSimilarDishScore(query, String(dto.displayName));
          if (score >= 0.60) candidate = {id: String(dto.sourceDocumentId), name: String(dto.displayName).toLowerCase(), score, value: {...dto, restaurant}};
        }
      }
      if (candidate) top = accept(top, candidate, kind);
    }
    if (Buffer.byteLength(JSON.stringify(top)) > 256 * 1024) throw new HttpsError("resource-exhausted", "Suggestion data is too large.");
    const next: Session = {...session, step: session.step + 1, after: page.docs[page.docs.length - 1]?.id ?? session.after, top, ready: page.docs.length < batchSize};
    await validateReady(db, tx, next, query, restaurantId);
    tx.set(ref, next);
    if (!saved.exists) {
      const a = admission.data(); const inWindow = a && now - a.windowAtMs < 60_000;
      tx.set(activeRef, {sessionId, generation, expiresAt: next.expiresAt});
      tx.set(admissionRef, {windowAtMs: inWindow ? a.windowAtMs : now, starts: (inWindow ? a.starts : 0) + 1, expiresAt: next.expiresAt});
    }
    return next;
  });
  return {schemaVersion: 1, kind, state: result.ready ? "ready" : "preparing", items: result.ready ? result.top.map((v) => v.value) : [], nextCursor: result.ready ? null : context.cursorCodec.encode({...binding, purpose: "forward", sortTuple: [sessionId, result.step], lifetimeMs}), retryAfterMs: result.ready ? 0 : 100};
}
