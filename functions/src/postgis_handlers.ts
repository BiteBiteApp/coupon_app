import {
  CustomerBiteSaverContractError, privateCustomerBiteSaverResultCollection,
  privateCustomerBiteSaverSearchSessionCollection,
} from "./customer_bitesaver_search_contract.js";
import {
  startCustomerBiteSaverSearchHandler, getCustomerBiteSaverSearchStatusHandler,
  getCustomerBiteSaverSearchPageHandler, getCustomerBiteSaverOfferPageHandler,
  continueCustomerBiteSaverGuestOfferCheckHandler,
  type CustomerBiteSaverSessionContext,
} from "./customer_bitesaver_search_session.js";
import {
  startCustomerBiteScoreSearchHandler, advanceCustomerBiteScoreSearchHandler,
  getCustomerBiteScoreSearchPageHandler, type CustomerBiteScoreSearchContext,
} from "./customer_bitescore_search.js";
import {
  customerBiteScoreSessionCollection, customerBiteScoreResultCollection,
  customerBiteScoreAdmissionCollection,
} from "./customer_bitescore_search_contract.js";
import type {
  CustomerBiteSaverSearchDatabase, CustomerBiteSaverQuery,
  CustomerBiteSaverStoredDocument,
} from "./customer_bitesaver_search_store.js";
import {buildPostgisSearchBinding, postgisSearchBindingPath,
  readPostgisSearchBinding} from "./postgis_search_binding.js";

export interface PostgisMembershipProvider {
  /** Pins only a complete published revision; repeated pinId is idempotent. */
  pinRevision(input: Readonly<{pinId: string; expiresAtMs: number}>): Promise<Readonly<{revision: string}>>;
  /** Exact native ordering and bounded complete membership, or a retryable error. */
  queryResults(input: Readonly<{
    space: "saver" | "score";
    session: Readonly<Record<string, unknown>>;
    revision: string;
    query: CustomerBiteSaverQuery;
  }>): Promise<readonly CustomerBiteSaverStoredDocument[]>;
}

/** Source-only factory. It does not export or register any deployed Function. */
export function createPostgisSearchHandlers(options: Readonly<{
  database: CustomerBiteSaverSearchDatabase;
  provider: PostgisMembershipProvider;
}>) {
  const {database, provider} = options;
  const millis = (value: unknown): number => {
    if (value instanceof Date) return value.getTime();
    if (value !== null && typeof value === "object" && "toMillis" in value &&
        typeof value.toMillis === "function") return value.toMillis();
    return typeof value === "number" ? value : NaN;
  };
  async function finishAdmission(space: "saver" | "score", sessionId: string, nowMs: number): Promise<void> {
    const sessionCollection = space === "saver" ? privateCustomerBiteSaverSearchSessionCollection :
      customerBiteScoreSessionCollection;
    const markerPath = postgisSearchBindingPath(sessionId);
    const sessionPath = `${sessionCollection}/${sessionId}`;
    const [session, marker] = await database.getDocuments([sessionPath, markerPath]);
    const binding = readPostgisSearchBinding(marker, sessionId);
    if (session === null || binding === null || !Number.isSafeInteger(nowMs) ||
        nowMs >= binding.expiresAtMs || nowMs >= millis(space === "saver" ?
          session.data.logicalExpiresAt : session.data.idleExpiresAtMs)) {
      throw new CustomerBiteSaverContractError("failed-precondition", "The candidate search admission expired.");
    }
    if (binding.state === "ready") {
      if (session.data.state !== "ready") {
        throw new CustomerBiteSaverContractError("failed-precondition", "Candidate search publication is inconsistent.");
      }
      return;
    }
    if (session.data.state !== "preparing") {
      throw new CustomerBiteSaverContractError("failed-precondition", "Invalid candidate search admission.");
    }
    // Native admission already enforced the caller's start/concurrency limits.
    // A failed or interrupted pin leaves a recoverable preparing session and
    // retries always use its original fixed expiry and pin ID.
    const pin = await provider.pinRevision({pinId: binding.pinId, expiresAtMs: binding.expiresAtMs});
    await database.runTransaction(async transaction => {
      const [current, storedMarker] = await transaction.getDocuments([sessionPath, markerPath]);
      const stored = readPostgisSearchBinding(storedMarker, sessionId);
      if (current === null || stored === null || stored.pinId !== binding.pinId ||
          stored.expiresAtMs !== binding.expiresAtMs ||
          !["preparing", "ready"].includes(current.data.state as string)) {
        throw new CustomerBiteSaverContractError("failed-precondition", "Candidate search admission changed.");
      }
      if (stored.state === "ready") {
        if (current.data.state !== "ready") {
          throw new CustomerBiteSaverContractError("failed-precondition", "Candidate search publication is inconsistent.");
        }
        return;
      }
      const admissionPath = space === "score" ?
        `${customerBiteScoreAdmissionCollection}/actor_${current.data.actor}` : null;
      const admission = admissionPath === null ? null : await transaction.getDocument(admissionPath);
      transaction.setDocument(sessionPath, {...current.data, state: "ready",
        ...(space === "saver" ? {phase: "ready"} : {})});
      transaction.setDocument(markerPath, buildPostgisSearchBinding(sessionId,
        {...pin, pinId: stored.pinId, expiresAtMs: stored.expiresAtMs}, stored.expiresAtMs));
      if (admission !== null && Array.isArray(admission.data.pending)) {
        transaction.setDocument(admission.path, {...admission.data, pending:
          admission.data.pending.filter((entry: {sessionId?: unknown}) => entry.sessionId !== sessionId)});
      }
    });
  }
  const candidateDatabase: CustomerBiteSaverSearchDatabase = {
    getDocument: path => database.getDocument(path),
    getDocuments: paths => database.getDocuments(paths),
    commitWrites: writes => database.commitWrites(writes),
    runTransaction: operation => database.runTransaction(operation),
    async queryDocuments(query) {
      const space = query.collectionPath === privateCustomerBiteSaverResultCollection ? "saver" :
        query.collectionPath === customerBiteScoreResultCollection ? "score" : null;
      if (space === null) return database.queryDocuments(query);
      const filters = query.filters.filter(filter => filter.field === "sessionId" && filter.operation === "==");
      const sessionId = filters[0]?.value;
      if (filters.length !== 1 || typeof sessionId !== "string" ||
          !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 101) {
        throw new CustomerBiteSaverContractError("failed-precondition", "Invalid candidate membership query.");
      }
      const sessionCollection = space === "saver" ? privateCustomerBiteSaverSearchSessionCollection :
        customerBiteScoreSessionCollection;
      const [session, marker] = await database.getDocuments([
        `${sessionCollection}/${sessionId}`, postgisSearchBindingPath(sessionId),
      ]);
      const binding = readPostgisSearchBinding(marker, sessionId);
      if (session === null || binding === null || binding.state !== "ready") {
        throw new CustomerBiteSaverContractError("failed-precondition", "The candidate search revision is unavailable.");
      }
      const results = await provider.queryResults({space, session: session.data, revision: binding.revision, query});
      if (results.length > query.limit || new Set(results.map(result => result.id)).size !== results.length ||
          results.some(result => result.path !== `${query.collectionPath}/${result.id}` ||
            result.data.sessionId !== sessionId || result.id.includes("/"))) {
        throw new CustomerBiteSaverContractError("failed-precondition", "Invalid candidate search results.");
      }
      // Cache only requested membership rows. Existing delivered-identity,
      // Menu, offer, and redemption handlers continue reading native authority.
      if (results.length > 0) await database.commitWrites(results.map(result => ({
        type: "set" as const, path: result.path, data: result.data,
      })));
      return results;
    },
  };
  const saverContext = (context: CustomerBiteSaverSessionContext): CustomerBiteSaverSessionContext =>
    ({...context, database: candidateDatabase, searchBackend: "postgis"});
  const scoreContext = (context: CustomerBiteScoreSearchContext): CustomerBiteScoreSearchContext =>
    ({...context, searchBackend: "postgis"});
  return Object.freeze({
    async startCustomerBiteSaverSearchV2(input: unknown, context: CustomerBiteSaverSessionContext) {
      const started = await startCustomerBiteSaverSearchHandler(input, saverContext(context));
      await finishAdmission("saver", started.sessionId, context.now?.() ?? Date.now());
      return startCustomerBiteSaverSearchHandler(input, saverContext(context));
    },
    async getCustomerBiteSaverSearchStatusV2(input: unknown, context: CustomerBiteSaverSessionContext) {
      const status = await getCustomerBiteSaverSearchStatusHandler(input, saverContext(context));
      if (status.state !== "preparing") return status;
      await finishAdmission("saver", (input as {sessionId: string}).sessionId, context.now?.() ?? Date.now());
      return getCustomerBiteSaverSearchStatusHandler(input, saverContext(context));
    },
    getCustomerBiteSaverSearchPageV2: (input: unknown, context: CustomerBiteSaverSessionContext) =>
      getCustomerBiteSaverSearchPageHandler(input, saverContext(context)),
    getCustomerBiteSaverOfferPageV2: (input: unknown, context: CustomerBiteSaverSessionContext) =>
      getCustomerBiteSaverOfferPageHandler(input, saverContext(context)),
    continueCustomerBiteSaverGuestOfferCheckV2: (input: unknown, context: CustomerBiteSaverSessionContext) =>
      continueCustomerBiteSaverGuestOfferCheckHandler(input, saverContext(context)),
    async startCustomerBiteScoreSearchV2(input: unknown, context: CustomerBiteScoreSearchContext) {
      const started = await startCustomerBiteScoreSearchHandler(candidateDatabase, input, scoreContext(context));
      await finishAdmission("score", started.sessionId, context.nowMs ?? Date.now());
      return startCustomerBiteScoreSearchHandler(candidateDatabase, input, scoreContext(context));
    },
    async advanceCustomerBiteScoreSearchV2(input: unknown, context: CustomerBiteScoreSearchContext) {
      const status = await getCustomerBiteScoreSearchPageHandler(candidateDatabase, input, scoreContext(context));
      if (status.state === "preparing") {
        await finishAdmission("score", status.sessionId, context.nowMs ?? Date.now());
      }
      return advanceCustomerBiteScoreSearchHandler(candidateDatabase, input, scoreContext(context));
    },
    getCustomerBiteScoreSearchPageV2: (input: unknown, context: CustomerBiteScoreSearchContext) =>
      getCustomerBiteScoreSearchPageHandler(candidateDatabase, input, scoreContext(context)),
  });
}
