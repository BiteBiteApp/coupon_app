import {createServer, type IncomingMessage, type Server} from "node:http";
import type {Auth} from "firebase-admin/auth";
import type {Firestore} from "firebase-admin/firestore";
import {type CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import {onDocumentCreated, onDocumentWritten} from "firebase-functions/v2/firestore";
import {customerBiteSaverCallableIdentity, customerBiteScoreCallableContext} from "./customer_search_callable_context.js";
import {CustomerBiteSaverContractError} from "./customer_bitesaver_search_contract.js";
import {getCustomerBiteSaverFavoriteStatesHandler, getCustomerBiteSaverMenuPageHandler,
  validateCustomerBiteSaverOfferRedemptionStartHandler} from "./customer_bitesaver_search_session.js";
import {CustomerBiteScoreSearchError} from "./customer_bitescore_search_contract.js";
import {createFirestoreCustomerBiteSaverSearchDatabase} from "./customer_bitesaver_search_store.js";
import type {CustomerBiteSaverIdentityKeyV1} from "./customer_bitesaver_public_identity.js";
import {OpaqueCursorError} from "./opaque_cursor.js";
import {createPostgisSearchHandlers} from "./postgis_handlers.js";
import {PostgisMembership} from "./postgis_membership.js";
import {createLocalPostgisPool, PostgisCandidateError, PostgisReadModel} from "./postgis_store.js";
import {createFirestorePostgisSource} from "./postgis_source_firestore.js";
import {createFirestorePostgisBindingPruner} from "./postgis_search_binding.js";
import {createFirestoreSearchIndexDatabase, handleBiteSaverRestaurantWrite, handleBiteScoreRestaurantWrite,
  handleBiteSaverCouponOfferWrite, handleBiteSaverDailySpecialOfferWrite, reconcileBiteScoreDishIndex,
  processSearchIndexJob} from "./search_index_maintenance.js";
import {readSearchIndexEventSnapshotData} from "./search_index_event_snapshot.js";
import {requireQualifiedPostgisRuntime} from "./postgis_runtime.js";

export const postgisStagingCallableNames = Object.freeze([
  "startCustomerBiteSaverSearchV2", "getCustomerBiteSaverSearchStatusV2",
  "getCustomerBiteSaverSearchPageV2", "getCustomerBiteSaverOfferPageV2",
  "continueCustomerBiteSaverGuestOfferCheckV2", "startCustomerBiteScoreSearchV2",
  "advanceCustomerBiteScoreSearchV2", "getCustomerBiteScoreSearchPageV2",
  "getCustomerBiteSaverFavoriteStates", "getCustomerBiteSaverMenuPage",
  "validateCustomerBiteSaverOfferRedemptionStart",
] as const);
export type PostgisStagingCallableName = typeof postgisStagingCallableNames[number];
type LocalConfiguration = Readonly<{
  database: Firestore;
  auth: Auth;
  projectId: string;
  allowedProjectIds: readonly string[];
  epoch: string;
  sql: {host: string; port: number; database: string; user: string};
  discoveryKey: Uint8Array;
  identityKeyV1: CustomerBiteSaverIdentityKeyV1;
  scoreCursorRootKey: Uint8Array;
  /** Explicit local-only experiment; omitted is the reproducible serial path. */
  guestRestaurantWindow?: boolean;
}>;

function requireLocalConfiguration(options: LocalConfiguration): void {
  if (!/^demo-bs-postgis-[a-z0-9-]+$/u.test(options.projectId) ||
      options.projectId === "coupon-app-29446" || options.allowedProjectIds.length !== 1 ||
      options.allowedProjectIds[0] !== options.projectId ||
      (options.database as unknown as {projectId: string}).projectId !== options.projectId ||
      options.auth.app.options.projectId !== options.projectId ||
      !/^127\.0\.0\.1:\d{4,5}$/u.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") ||
      !/^127\.0\.0\.1:\d{4,5}$/u.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "") ||
      [options.discoveryKey, options.identityKeyV1, options.scoreCursorRootKey].some(key => key.byteLength !== 32)) {
    throw new Error("The PostGIS local runtime requires one explicit demo project, loopback emulators and synthetic keys.");
  }
  requireQualifiedPostgisRuntime();
}

function callableError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof CustomerBiteSaverContractError || error instanceof CustomerBiteScoreSearchError ||
      error instanceof PostgisCandidateError) return new HttpsError(error.code, error.message);
  if (error instanceof OpaqueCursorError) return new HttpsError("invalid-argument", "Invalid or expired search cursor.");
  return new HttpsError("internal", "Search is temporarily unavailable.");
}

/** Inert on import. No production index import/export, credential lookup or deployment.
 * The same source-enabled maintenance adapter must handle every staging projection writer.
 */
export function createLocalPostgisStagingRuntime(options: LocalConfiguration) {
  requireLocalConfiguration(options);
  const sourceConfig = {projectId: options.projectId, allowedProjectIds: options.allowedProjectIds, epoch: options.epoch};
  const source = createFirestorePostgisSource(options.database, sourceConfig);
  const maintenanceDatabase = createFirestoreSearchIndexDatabase(options.database, {postgisSource: sourceConfig});
  const authority = createFirestoreCustomerBiteSaverSearchDatabase(options.database);
  const pool = createLocalPostgisPool(options.sql), model = new PostgisReadModel(pool, source);
  const provider = new PostgisMembership(model, authority, options.discoveryKey, options.identityKeyV1);
  const handlers = createPostgisSearchHandlers({database: authority, provider});
  const pruneBindings = createFirestorePostgisBindingPruner(options.database, sourceConfig);
  const names: ReadonlySet<string> = new Set(postgisStagingCallableNames);
  async function invoke(name: string, request: CallableRequest<unknown>): Promise<unknown> {
    requireLocalConfiguration(options);
    if (!names.has(name)) throw new HttpsError("not-found", "Unknown candidate callable.");
    try {
      if (name.includes("BiteSaver")) {
        const context = {database: authority, discoveryKey: options.discoveryKey,
          identityKeyV1: options.identityKeyV1, identity: customerBiteSaverCallableIdentity(request),
          guestRestaurantWindow: options.guestRestaurantWindow === true};
        if (name === "getCustomerBiteSaverFavoriteStates") return await getCustomerBiteSaverFavoriteStatesHandler(request.data, context);
        if (name === "getCustomerBiteSaverMenuPage") return await getCustomerBiteSaverMenuPageHandler(request.data, context);
        if (name === "validateCustomerBiteSaverOfferRedemptionStart") return await validateCustomerBiteSaverOfferRedemptionStartHandler(request.data, context);
        const handler = handlers[name as Exclude<PostgisStagingCallableName,
          "startCustomerBiteScoreSearchV2" | "advanceCustomerBiteScoreSearchV2" | "getCustomerBiteScoreSearchPageV2" |
          "getCustomerBiteSaverFavoriteStates" | "getCustomerBiteSaverMenuPage" | "validateCustomerBiteSaverOfferRedemptionStart">];
        return await handler(request.data, context);
      }
      const handler = handlers[name as "startCustomerBiteScoreSearchV2" | "advanceCustomerBiteScoreSearchV2" | "getCustomerBiteScoreSearchPageV2"];
      return await handler(request.data, customerBiteScoreCallableContext(request, options.scoreCursorRootKey));
    } catch (error) { throw callableError(error); }
  }
  return Object.freeze({projectId: options.projectId, auth: options.auth, source, maintenanceDatabase,
    authority, pool, model, provider, invoke,
    async initialize() { requireLocalConfiguration(options); await source.initialize(); await model.initializeLocalSchema(); },
    async close() { await model.close(); },
    /** Explicit bounded lifecycle pass; no timer, scheduler or cloud invocation. */
    async maintainLifecycle(nowMs = Date.now()) {
      requireLocalConfiguration(options);
      const bindings = await pruneBindings(nowMs, 100);
      const sql = await model.garbageCollect(nowMs);
      return {bindings, sql};
    },
    /** Callable SDK supplies verified auth. These exports are deliberately never installed in index.ts. */
    registerCallables() {
      requireLocalConfiguration(options);
      return Object.fromEntries(postgisStagingCallableNames.map(name => [name,
        onCall({timeoutSeconds: 60, minInstances: 0, maxInstances: 4, concurrency: 1}, request => invoke(name, request))]));
    },
    /** Search-only trigger composition. Existing bounded parent fanout and job
     * continuation logic is reused. No unrelated media/moderation work activates.
     */
    registerSourceTriggers() {
      requireLocalConfiguration(options);
      const trigger = {retry: true, maxInstances: 4, concurrency: 1, timeoutSeconds: 60};
      return Object.freeze({
        maintainPostgisBiteSaverRestaurant: onDocumentWritten({...trigger,
          document: "restaurant_accounts/{restaurantAccountId}"}, async event => {
          requireLocalConfiguration(options);
          await handleBiteSaverRestaurantWrite(maintenanceDatabase, {
            restaurantAccountId: event.params.restaurantAccountId,
            before: readSearchIndexEventSnapshotData(event.data?.before),
            after: readSearchIndexEventSnapshotData(event.data?.after), sourceEventId: event.id,
            now: new Date(), identityKeyV1: options.identityKeyV1});
        }),
        maintainPostgisBiteScoreRestaurant: onDocumentWritten({...trigger,
          document: "bitescore_restaurants/{restaurantId}"}, async event => {
          requireLocalConfiguration(options);
          await handleBiteScoreRestaurantWrite(maintenanceDatabase, {restaurantId: event.params.restaurantId,
            before: readSearchIndexEventSnapshotData(event.data?.before),
            after: readSearchIndexEventSnapshotData(event.data?.after), sourceEventId: event.id, now: new Date()});
        }),
        maintainPostgisBiteScoreDish: onDocumentWritten({...trigger, document: "bitescore_dishes/{dishId}"}, async event => {
          requireLocalConfiguration(options);
          await reconcileBiteScoreDishIndex(maintenanceDatabase, event.params.dishId, new Date());
        }),
        maintainPostgisBiteScoreDishAggregate: onDocumentWritten({...trigger, document: "dish_rating_aggregates/{dishId}"}, async event => {
          requireLocalConfiguration(options);
          await reconcileBiteScoreDishIndex(maintenanceDatabase, event.params.dishId, new Date());
        }),
        maintainPostgisBiteSaverCoupon: onDocumentWritten({...trigger,
          document: "restaurant_accounts/{restaurantAccountId}/coupons/{couponId}"}, async event => {
          requireLocalConfiguration(options);
          await handleBiteSaverCouponOfferWrite(maintenanceDatabase, {restaurantAccountId: event.params.restaurantAccountId,
            couponId: event.params.couponId, now: new Date(), identityKeyV1: options.identityKeyV1});
        }),
        maintainPostgisBiteSaverDailySpecial: onDocumentWritten({...trigger,
          document: "restaurant_accounts/{restaurantAccountId}/daily_specials/{dailySpecialId}"}, async event => {
          requireLocalConfiguration(options);
          await handleBiteSaverDailySpecialOfferWrite(maintenanceDatabase, {restaurantAccountId: event.params.restaurantAccountId,
            dailySpecialId: event.params.dailySpecialId, now: new Date()});
        }),
        processPostgisSearchIndexJob: onDocumentCreated({...trigger,
          document: "private_search_index_jobs/{jobId}"}, async event => {
          requireLocalConfiguration(options);
          await processSearchIndexJob(maintenanceDatabase, event.params.jobId, new Date(), options.identityKeyV1);
        }),
      });
    },
  });
}

type LocalRuntime = ReturnType<typeof createLocalPostgisStagingRuntime>;
async function readData(request: IncomingMessage): Promise<unknown> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 512 * 1024) throw new HttpsError("resource-exhausted", "Request exceeds the local test bound.");
    chunks.push(Buffer.from(chunk));
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpsError("invalid-argument", "Invalid callable request."); }
  if (body === null || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !("data" in body)) throw new HttpsError("invalid-argument", "Invalid callable request.");
  return body.data;
}

/** Local HTTP transport for actual Flutter/API qualification. Auth emulator tokens
 * are verified by Admin SDK; no client-supplied UID or bypass header is trusted.
 * This implements callable JSON transport, not hosted Functions infrastructure.
 */
export async function startLocalPostgisHttpHost(runtime: LocalRuntime, options: {port?: number} = {}) {
  if (!Number.isInteger(options.port ?? 0) || (options.port !== undefined && options.port !== 0 &&
      (options.port < 1024 || options.port > 65535))) throw new Error("Invalid local host port.");
  let inFlight = 0;
  const server: Server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    let admitted = false;
    try {
      if (request.socket.remoteAddress !== "127.0.0.1" || request.method !== "POST" || request.headers.origin ||
          !/^application\/json(?:;|$)/u.test(request.headers["content-type"] ?? "")) {
        throw new HttpsError("permission-denied", "Only local JSON test requests are accepted.");
      }
      if (inFlight >= 4) throw new HttpsError("resource-exhausted", "The local candidate is busy. Retry the request.");
      inFlight++; admitted = true;
      const name = (request.url ?? "").slice(1);
      if (!postgisStagingCallableNames.includes(name as PostgisStagingCallableName)) throw new HttpsError("not-found", "Unknown candidate callable.");
      let auth: CallableRequest<unknown>["auth"];
      const authorization = request.headers.authorization;
      if (authorization !== undefined) {
        if (!/^Bearer [^\s]+$/u.test(authorization)) throw new HttpsError("unauthenticated", "Invalid authentication.");
        try {
          const token = await runtime.auth.verifyIdToken(authorization.slice(7));
          auth = {uid: token.uid, token, rawToken: authorization.slice(7)};
        } catch { throw new HttpsError("unauthenticated", "Invalid authentication."); }
      }
      const data = await readData(request);
      const result = await runtime.invoke(name, {data, auth, rawRequest: request,
        acceptsStreaming: false} as CallableRequest<unknown>);
      response.end(JSON.stringify({result}));
    } catch (error) {
      const safe = callableError(error);
      response.statusCode = safe.httpErrorCode.status;
      response.end(JSON.stringify({error: {status: safe.httpErrorCode.canonicalName, message: safe.message}}));
    } finally { if (admitted) inFlight--; }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 5_000; server.keepAliveTimeout = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Local HTTP listener is unavailable.");
  return Object.freeze({url: `http://127.0.0.1:${address.port}`, async close() {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }});
}
