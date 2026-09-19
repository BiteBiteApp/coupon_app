import {randomBytes} from "node:crypto";
import type {Firestore} from "firebase-admin/firestore";
import {createFirestoreCustomerBiteSaverSearchDatabase,
  type CustomerBiteSaverSearchDatabase as Database, type CustomerBiteSaverStoredDocument as Document,
  type CustomerBiteSaverTransaction as Transaction} from "./customer_bitesaver_search_store.js";
import {customerBiteSaverMenuKinds, customerPublicMenuEntry} from "./customer_bitesaver_search_session.js";
import {biteScoreMenuSource, type CustomerBiteScoreReadContext} from "./customer_bitescore_reads.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {biteScoreRecord, biteScoreRequestString, customerBiteScoreDigest as digest,
  customerBiteScoreAdmissionCollection, customerBiteScoreIdleLifetimeMs, customerBiteScoreLeaseLifetimeMs,
  customerBiteScoreSessionLifetimeMs, customerBiteScoreSessionCollection, customerBiteScoreResultCollection,
  CustomerBiteScoreSearchError, customerBiteScoreUtf16Key} from "./customer_bitescore_search_contract.js";

type Data = Readonly<Record<string, unknown>>;
type Kind = typeof customerBiteSaverMenuKinds[number];
type Source = Awaited<ReturnType<typeof biteScoreMenuSource>>;
type SourceReader = (restaurantId: string) => Promise<Source>;
type Context = CustomerBiteScoreReadContext & {nowMs?: number};
const version = "bitestar.customer-bitescore-menu-search.v1";
export const customerBiteScoreMenuGenerationCollection = "private_bitescore_menu_generations";
export const customerBiteScoreMenuCategoryOrder = Object.freeze({
  biteScore: ["Breakfast", "Anytime", "Lunch", "Dinner", "Appetizers", "Sides", "Drinks", "Desserts", "Specials", "Extras"],
  biteSaver: ["Breakfast", "Anytime", "Lunch", "Dinner", "Lunch Specials", "Appetizers", "Sides", "Drinks", "Desserts", "Kids", "Extras"],
});
const fields = ["kindRank", "categoryRank", "categoryKey", "sortOrder", "titleKey", "idKey0", "idKey1", "__name__"] as const;
type Session = {version: string; sessionId: string; actor: string; instanceId: string; queryGeneration: number;
  queryFingerprint: string; restaurantId: string; sourceFingerprint: string; root: string; style: string;
  state: "preparing" | "ready" | "failed"; attempt: number; phase: number; after: string | null; generation: number;
  scannedCount: number; leaseId: string | null; leaseUntilMs: number; absoluteExpiresAtMs: number; idleExpiresAtMs: number; expiresAt: Date};

function fail(message = "The menu changed or expired. Refresh to continue."): never {
  throw new CustomerBiteScoreSearchError("failed-precondition", message);
}
function id(value: unknown): string {
  const parsed = readBiteScoreCatalogRestaurantId(value);
  if (parsed === null || parsed !== value) fail("Invalid menu identity.");
  return parsed;
}
function rootPath(value: string): string {
  const parts = value.split("/");
  if (parts.length !== 2 || !["restaurant_accounts", "restaurant_menus"].includes(parts[0])) fail("Invalid menu source.");
  id(parts[1]);
  return value;
}
function generationPath(root: string): string {
  return `${customerBiteScoreMenuGenerationCollection}/${digest(version, rootPath(root))}`;
}
function readGeneration(raw: Data | null | undefined): number {
  if (raw == null) return 0;
  if (raw.version !== version || !Number.isSafeInteger(raw.generation) || (raw.generation as number) < 0) fail("Menu generation is unavailable.");
  return raw.generation as number;
}

/** Root/kind are supplied only by trusted trigger composition, never customers. */
export async function reconcileCustomerBiteScoreMenuGeneration(db: Database, root: string, kind: Kind, documentId: string): Promise<void> {
  rootPath(root); id(documentId);
  if (!customerBiteSaverMenuKinds.includes(kind)) fail("Invalid menu collection.");
  const sourcePath = `${root}/${kind}/${documentId}`;
  const accountingPath = `${customerBiteScoreMenuGenerationCollection}/entry_${digest(version, sourcePath)}`;
  await db.runTransaction(async (tx) => {
    const [source, prior, generation] = await tx.getDocuments([sourcePath, accountingPath, generationPath(root)]);
    // Fixed field order and relevant presentation fields make duplicate or
    // reordered events no-ops even when Firestore maps reorder their keys.
    const sourceFields = source === null ? null : Object.fromEntries(["imageUrl", "sortOrder", "name", "category",
      "description", "price", "title", "body"].map((key) => [key, source.data[key] ?? null]));
    const fingerprint = sourceFields === null ? null : digest(version, sourceFields);
    if ((prior?.data.fingerprint ?? null) === fingerprint) return;
    const next = readGeneration(generation?.data) + 1;
    if (!Number.isSafeInteger(next)) fail("Menu generation is exhausted.");
    tx.setDocument(generationPath(root), {version, generation: next});
    if (fingerprint === null) tx.deleteDocument(accountingPath);
    else tx.setDocument(accountingPath, {version, fingerprint});
  });
}
function time(context: Context): number {
  const value = context.nowMs ?? Date.now();
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}
function actor(context: Context): string {
  if (!context.actorId || context.actorId.length > 2000) fail();
  return digest(version, "actor", context.actorId);
}
function path(sessionId: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sessionId)) fail();
  return `${customerBiteScoreSessionCollection}/${sessionId}`;
}
function instancePath(actorId: string, instance: string): string { return `${customerBiteScoreAdmissionCollection}/menu_instance_${digest(actorId, instance)}`; }
function admissionPath(actorId: string): string { return `${customerBiteScoreAdmissionCollection}/menu_actor_${actorId}`; }
function fingerprint(restaurantId: string, source: Source): string { return digest(version, restaurantId, source.root, source.style, source.fingerprint); }
function readSession(document: Document | null): Session {
  if (!document) fail();
  const s = document.data as unknown as Session;
  if (s.version !== version || document.path !== path(s.sessionId) || !["preparing", "ready", "failed"].includes(s.state) ||
      !Number.isSafeInteger(s.attempt) || s.attempt < 0 || s.attempt > 2 || !Number.isSafeInteger(s.phase) || s.phase < 0 || s.phase > 3 ||
      !Number.isSafeInteger(s.generation) || s.generation < 0 || !Number.isSafeInteger(s.queryGeneration) ||
      !Number.isSafeInteger(s.scannedCount) || s.scannedCount < 0 || !Number.isSafeInteger(s.absoluteExpiresAtMs) ||
      !Number.isSafeInteger(s.idleExpiresAtMs) || typeof s.instanceId !== "string" || (s.after !== null && typeof s.after !== "string")) fail();
  id(s.restaurantId); rootPath(s.root);
  return s;
}
async function current(tx: Transaction, sessionId: string, queryFingerprint: string, context: Context, source: Source): Promise<Session> {
  const s = readSession(await tx.getDocument(path(sessionId)));
  if (s.actor !== actor(context) || s.queryFingerprint !== queryFingerprint ||
      s.queryFingerprint !== fingerprint(s.restaurantId, source) || time(context) >= Math.min(s.absoluteExpiresAtMs, s.idleExpiresAtMs)) fail();
  const instance = await tx.getDocument(instancePath(s.actor, s.instanceId));
  if (instance?.data.sessionId !== s.sessionId || instance.data.queryGeneration !== s.queryGeneration) fail();
  return s;
}
function response(s: Session): Data {
  return {restaurantId: s.restaurantId, state: s.state === "ready" ? "available" : s.state,
    menuStyle: s.style, sessionId: s.sessionId, queryFingerprint: s.queryFingerprint,
    scannedCount: s.scannedCount, entries: [], nextCursor: null, retryAfterMs: s.state === "preparing" ? 150 : 0};
}
async function start(db: Database, request: Data, restaurantId: string, source: Source, context: Context): Promise<Session> {
  if (!Number.isSafeInteger(request.queryGeneration) || (request.queryGeneration as number) < 0 || request.cursor != null) fail();
  const instanceId = biteScoreRequestString(request.clientInstanceId, 128);
  const requestId = biteScoreRequestString(request.clientRequestId, 128);
  if (!instanceId || !requestId || !source.root) fail();
  const actorId = actor(context);
  const queryGeneration = request.queryGeneration as number;
  const queryFingerprint = fingerprint(restaurantId, source);
  const sessionId = digest(version, actorId, instanceId, requestId);
  const now = time(context);
  return db.runTransaction(async (tx) => {
    const [previous, instance, admission, generation] = await tx.getDocuments([path(sessionId), instancePath(actorId, instanceId),
      admissionPath(actorId), generationPath(source.root!)]);
    if (previous) {
      const s = readSession(previous);
      if (s.queryFingerprint !== queryFingerprint || s.queryGeneration !== queryGeneration || instance?.data.sessionId !== sessionId ||
          now >= Math.min(s.absoluteExpiresAtMs, s.idleExpiresAtMs)) fail();
      return s;
    }
    if (instance && (!Number.isSafeInteger(instance.data.queryGeneration) || (instance.data.queryGeneration as number) >= queryGeneration)) fail();
    const a = admission?.data ?? {};
    const sameWindow = typeof a.windowAtMs === "number" && now - a.windowAtMs < 60_000;
    const starts = sameWindow && typeof a.starts === "number" ? a.starts : 0;
    const pending = Array.isArray(a.pending) ? a.pending.filter(biteScoreRecord).filter((v) =>
      typeof v.expiresAtMs === "number" && v.expiresAtMs > now && v.instanceId !== instanceId) : [];
    if (starts >= 12 || pending.length >= 4) throw new CustomerBiteScoreSearchError("resource-exhausted", "Please wait before opening another menu.");
    const s: Session = {version, sessionId, actor: actorId, instanceId, queryGeneration, queryFingerprint, restaurantId,
      sourceFingerprint: source.fingerprint, root: source.root!, style: source.style,
      state: "preparing", attempt: 0, phase: 0, after: null, generation: readGeneration(generation?.data), scannedCount: 0,
      leaseId: null, leaseUntilMs: 0, absoluteExpiresAtMs: now + customerBiteScoreSessionLifetimeMs,
      idleExpiresAtMs: now + customerBiteScoreIdleLifetimeMs, expiresAt: new Date(now + customerBiteScoreSessionLifetimeMs)};
    tx.createDocument(path(sessionId), s);
    tx.setDocument(instancePath(actorId, instanceId), {version, sessionId, queryGeneration, expiresAt: s.expiresAt});
    tx.setDocument(admissionPath(actorId), {version, starts: starts + 1, windowAtMs: sameWindow ? a.windowAtMs : now,
      pending: [...pending, {sessionId, instanceId, expiresAtMs: s.idleExpiresAtMs}], expiresAt: s.expiresAt});
    return s;
  });
}
function resultPath(s: Session, kind: Kind, documentId: string): string {
  return `${customerBiteScoreResultCollection}/${digest(version, s.sessionId, s.attempt, kind, documentId)}`;
}
function entry(s: Session, source: Source, kind: Kind, document: Document) {
  return customerPublicMenuEntry({key: `bscm_${digest(version, s.actor, s.sourceFingerprint, kind, document.id)}`,
    kind, document, privateSourceIdentities: source.privateIds});
}
function ranked(s: Session, source: Source, kind: Kind, document: Document): Data | null {
  const safe = entry(s, source, kind, document);
  if (!safe) return null;
  const categoryOrder = source.style === "biteScore" ? customerBiteScoreMenuCategoryOrder.biteScore : customerBiteScoreMenuCategoryOrder.biteSaver;
  const position = safe.kind === "item" ? categoryOrder.indexOf(safe.category) : 0;
  const key = customerBiteScoreUtf16Key(document.id);
  return {version, sessionId: s.sessionId, attempt: s.attempt, sourcePath: document.path, sourceId: document.id, kind,
    fingerprint: digest(safe), kindRank: customerBiteSaverMenuKinds.indexOf(kind), categoryRank: position < 0 ? categoryOrder.length : position,
    categoryKey: customerBiteScoreUtf16Key(safe.kind === "item" && position < 0 ? safe.category : ""),
    sortOrder: safe.sortOrder, titleKey: customerBiteScoreUtf16Key(safe.kind === "item" ? safe.name : safe.kind === "section" ? safe.title : ""),
    idKey0: key.subarray(0, 1500), idKey1: key.subarray(1500), expiresAt: s.expiresAt};
}
async function advance(db: Database, session: Session, source: Source, context: Context): Promise<Session> {
  const now = time(context);
  const leaseId = randomBytes(16).toString("hex");
  const claim = await db.runTransaction(async (tx) => {
    const s = await current(tx, session.sessionId, session.queryFingerprint, context, source);
    if (s.state !== "preparing" || s.leaseUntilMs > now) return {session: s, claimed: false};
    const admission = await tx.getDocument(admissionPath(s.actor));
    const next = {...s, leaseId, leaseUntilMs: now + customerBiteScoreLeaseLifetimeMs,
      idleExpiresAtMs: Math.min(s.absoluteExpiresAtMs, now + customerBiteScoreIdleLifetimeMs)};
    tx.setDocument(path(s.sessionId), next);
    if (admission && Array.isArray(admission.data.pending)) tx.setDocument(admission.path, {...admission.data,
      pending: admission.data.pending.filter(biteScoreRecord).map((v) => v.sessionId === s.sessionId ? {...v, expiresAtMs: next.idleExpiresAtMs} : v)});
    return {session: next, claimed: true};
  });
  if (!claim.claimed) return claim.session;
  const s = claim.session;
  try {
    const kind = customerBiteSaverMenuKinds[s.phase];
    if (!kind) fail();
    const documents = await db.queryDocuments({collectionPath: `${s.root}/${kind}`, filters: [],
      orders: [{field: "__name__", direction: "asc"}], limit: 25, ...(s.after === null ? {} : {startAfter: [s.after]})});
    if (documents.length > 25) fail();
    const results = documents.map((document) => ({id: document.id, value: ranked(s, source, kind, document)}));
    return await db.runTransaction(async (tx) => {
      const live = await current(tx, s.sessionId, s.queryFingerprint, context, source);
      if (live.leaseId !== leaseId || live.attempt !== s.attempt) fail();
      const phase = documents.length < 25 ? s.phase + 1 : s.phase;
      const complete = phase === customerBiteSaverMenuKinds.length;
      const generation = complete ? readGeneration((await tx.getDocument(generationPath(s.root)))?.data) : s.generation;
      const admission = complete ? await tx.getDocument(admissionPath(s.actor)) : null;
      const next: Session = {...live, phase, after: phase !== s.phase ? null : documents[documents.length - 1]?.id ?? live.after,
        scannedCount: live.scannedCount + documents.length, state: complete ? "ready" : "preparing", leaseId: null, leaseUntilMs: 0};
      if (generation !== s.generation) {
        next.state = s.attempt >= 2 ? "failed" : "preparing";
        next.attempt = Math.min(2, s.attempt + 1); next.phase = 0; next.after = null; next.scannedCount = 0; next.generation = generation;
      } else for (const result of results) if (result.value) tx.setDocument(resultPath(s, kind, result.id), result.value);
      tx.setDocument(path(s.sessionId), next);
      if (next.state !== "preparing" && admission) tx.setDocument(admission.path, {...admission.data,
        pending: Array.isArray(admission.data.pending) ? admission.data.pending.filter(biteScoreRecord).filter((v) => v.sessionId !== s.sessionId) : []});
      return next;
    });
  } catch (error) {
    await db.runTransaction(async (tx) => {
      const current = await tx.getDocument(path(s.sessionId));
      if (current?.data.leaseId === leaseId) tx.setDocument(current.path, {...current.data, leaseId: null, leaseUntilMs: 0});
    });
    throw error;
  }
}

/** One preparation batch or one globally ordered customer page per request. */
export async function pageCustomerBiteScoreMenuWithDatabase(db: Database, raw: unknown, context: Context, readSource: SourceReader): Promise<Data> {
  if (!biteScoreRecord(raw) || raw.schemaVersion !== 1) fail("Invalid menu request.");
  const restaurantId = id(raw.restaurantId);
  const source = await readSource(restaurantId);
  if (source.root === null) {
    if (raw.sessionId != null || raw.cursor != null) fail();
    return {restaurantId, state: "absent", menuStyle: source.style, entries: [], nextCursor: null};
  }
  let s: Session;
  if (raw.sessionId == null) s = await start(db, raw, restaurantId, source, context);
  else {
    if (typeof raw.sessionId !== "string" || typeof raw.queryFingerprint !== "string") fail();
    s = await db.runTransaction((tx) => current(tx, raw.sessionId as string, raw.queryFingerprint as string, context, source));
  }
  if (s.restaurantId !== restaurantId) fail();
  if (s.state === "preparing") {
    if (raw.cursor != null) fail();
    s = await advance(db, s, source, context);
  }
  if (s.state !== "ready") return response(s);
  const binding = {source: "customerBiteScoreMenu", searchMode: "menu", queryFingerprint: s.queryFingerprint, pageSize: 25, callerBinding: s.actor};
  let after: readonly unknown[] | undefined;
  if (raw.cursor != null) {
    const decoded = context.cursorCodec.decode(raw.cursor, {...binding, purposes: ["forward"]});
    if (decoded.sessionId !== s.sessionId || decoded.sortTuple[0] !== s.attempt || decoded.sortTuple.length !== 2 ||
        typeof decoded.sortTuple[1] !== "string" || !/^[a-f0-9]{64}$/u.test(decoded.sortTuple[1])) fail();
    const last = await db.getDocument(`${customerBiteScoreResultCollection}/${decoded.sortTuple[1]}`);
    if (!last || last.data.version !== version || last.data.sessionId !== s.sessionId || last.data.attempt !== s.attempt) fail();
    after = fields.map((field) => field === "__name__" ? last.id : last.data[field]);
  }
  const documents = await db.queryDocuments({collectionPath: customerBiteScoreResultCollection,
    filters: [{field: "sessionId", operation: "==", value: s.sessionId}, {field: "attempt", operation: "==", value: s.attempt}],
    orders: fields.map((field) => ({field, direction: "asc"})), limit: 26, ...(after === undefined ? {} : {startAfter: after})});
  if (documents.length > 26) fail();
  const selected = documents.slice(0, 25);
  for (const d of selected) if (d.data.version !== version || d.data.sessionId !== s.sessionId || d.data.attempt !== s.attempt ||
    typeof d.data.sourceId !== "string" || !customerBiteSaverMenuKinds.includes(d.data.kind as Kind) ||
    d.data.sourcePath !== `${s.root}/${d.data.kind}/${d.data.sourceId}` || d.path !== resultPath(s, d.data.kind as Kind, d.data.sourceId)) fail();
  const sources = await db.getDocuments(selected.map((v) => v.data.sourcePath as string));
  const entries = selected.flatMap((document, index) => {
    const current = sources[index];
    if (!current) return [];
    const safe = entry(s, source, document.data.kind as Kind, current);
    return safe && digest(safe) === document.data.fingerprint ? [safe] : [];
  });
  const latestSource = await readSource(restaurantId);
  await db.runTransaction(async (tx) => {
    const live = await current(tx, s.sessionId, s.queryFingerprint, context, latestSource);
    tx.setDocument(path(s.sessionId), {...live, idleExpiresAtMs: Math.min(live.absoluteExpiresAtMs, time(context) + customerBiteScoreIdleLifetimeMs)});
  });
  const last = selected[selected.length - 1];
  return {...response(s), entries, nextCursor: documents.length > 25 && last ? context.cursorCodec.encode({...binding,
    purpose: "forward", sessionId: s.sessionId, sortTuple: [s.attempt, last.id],
    lifetimeMs: Math.min(customerBiteScoreIdleLifetimeMs, s.absoluteExpiresAtMs - time(context))}) : null};
}

export async function pageCustomerBiteScoreMenuHandler(db: Firestore, raw: unknown, context: Context): Promise<Data> {
  return pageCustomerBiteScoreMenuWithDatabase(createFirestoreCustomerBiteSaverSearchDatabase(db), raw, context,
    (restaurantId) => biteScoreMenuSource(db, restaurantId));
}
