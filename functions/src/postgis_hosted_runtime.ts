import type {Auth} from "firebase-admin/auth";
import type {Firestore} from "firebase-admin/firestore";
import {type CallableRequest, HttpsError} from "firebase-functions/v2/https";
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
import {PostgisCandidateError, PostgisReadModel} from "./postgis_store.js";
import {createFirestorePostgisSource} from "./postgis_source_firestore.js";
import {createFirestorePostgisBindingPruner} from "./postgis_search_binding.js";
import {createFirestoreSearchIndexDatabase, handleBiteSaverRestaurantWrite, handleBiteScoreRestaurantWrite,
  handleBiteSaverCouponOfferWrite, handleBiteSaverDailySpecialOfferWrite, reconcileBiteScoreDishIndex,
  processSearchIndexJob} from "./search_index_maintenance.js";
import {readSearchIndexEventSnapshotData} from "./search_index_event_snapshot.js";
import {requireQualifiedPostgisRuntime} from "./postgis_runtime.js";

import type {PostgisPool} from "./postgis_store.js";
import {cloudSqlPostgisIdentity, requireCloudSqlPostgisPool, type CloudSqlPostgisConfiguration} from "./postgis_cloudsql.js";
import {requirePostgisExecutionPermit, type VerifiedPostgisExecutionPermit} from "./postgis_execution_approval.js";
import {postgisStagingCallableNames, type PostgisStagingCallableName} from "./postgis_staging_runtime.js";

export type HostedPostgisConfiguration = CloudSqlPostgisConfiguration & Readonly<{
  hosted: CloudSqlPostgisConfiguration["hosted"] & Readonly<{
    firestoreDatabase: "search-qualification"; epoch: string;
    allowedOrigins: readonly string[]; enforceAppCheck: boolean;
  }>;
}>;
export type HostedPostgisResources = Readonly<{
  database: Firestore; auth: Auth; pool: PostgisPool;
  discoveryKey: Uint8Array; identityKeyV1: CustomerBiteSaverIdentityKeyV1; scoreCursorRootKey: Uint8Array;
}>;
export function requireHostedPostgisConfiguration(configuration: HostedPostgisConfiguration,
  permit: VerifiedPostgisExecutionPermit): void {
  const identity = cloudSqlPostgisIdentity(configuration);
  requirePostgisExecutionPermit(permit, identity);
  if (configuration.hosted.firestoreDatabase !== "search-qualification" ||
      !/^[A-Za-z0-9_-]{1,100}$/u.test(configuration.hosted.epoch) ||
      !Array.isArray(configuration.hosted.allowedOrigins) || configuration.hosted.allowedOrigins.length > 8 ||
      configuration.hosted.allowedOrigins.some(origin => {
        try {const url = new URL(origin); return url.origin !== origin || url.protocol !== "https:" || url.username !== "" || url.password !== "";}
        catch {return true;}
      }) || typeof configuration.hosted.enforceAppCheck !== "boolean" ||
      process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("The hosted candidate requires approved isolated resources and exact browser origins.");
  }
}
function callableError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof CustomerBiteSaverContractError || error instanceof CustomerBiteScoreSearchError ||
      error instanceof PostgisCandidateError) return new HttpsError(error.code, error.message);
  if (error instanceof OpaqueCursorError) return new HttpsError("invalid-argument", "Invalid or expired search cursor.");
  return new HttpsError("internal", "Search is temporarily unavailable.");
}

/** Inert composition: no production export, automatic bootstrap, credentials or deployment. */
export function createHostedPostgisRuntime(configuration: HostedPostgisConfiguration,
  permit: VerifiedPostgisExecutionPermit, resources: HostedPostgisResources) {
  configuration = JSON.parse(JSON.stringify(configuration)) as HostedPostgisConfiguration;
  const options = {...resources, projectId: configuration.projectId, allowedProjectIds: configuration.allowedProjectIds,
    epoch: configuration.hosted.epoch};
  function requireHosted(): void {
    requireHostedPostgisConfiguration(configuration, permit);
    requireCloudSqlPostgisPool(resources.pool, cloudSqlPostgisIdentity(configuration));
    if ((resources.database as unknown as {projectId: string; databaseId: string}).projectId !== configuration.projectId ||
        resources.database.databaseId !== configuration.hosted.firestoreDatabase || resources.auth.app.options.projectId !== configuration.projectId ||
        [resources.discoveryKey, resources.identityKeyV1, resources.scoreCursorRootKey].some(key => key.byteLength !== 32)) {
      throw new Error("The hosted candidate resource identity does not match its approval.");
    }
    requireQualifiedPostgisRuntime();
  }
  requireHosted();
  const sourceConfig = {projectId: options.projectId, allowedProjectIds: options.allowedProjectIds, epoch: options.epoch};
  const source = createFirestorePostgisSource(options.database, sourceConfig);
  const maintenanceDatabase = createFirestoreSearchIndexDatabase(options.database, {postgisSource: sourceConfig});
  const authority = createFirestoreCustomerBiteSaverSearchDatabase(options.database);
  const pool = resources.pool, model = new PostgisReadModel(pool, source);
  const provider = new PostgisMembership(model, authority, options.discoveryKey, options.identityKeyV1);
  const handlers = createPostgisSearchHandlers({database: authority, provider});
  const pruneBindings = createFirestorePostgisBindingPruner(options.database, sourceConfig);
  const names: ReadonlySet<string> = new Set(postgisStagingCallableNames);
  async function invoke(name: string, request: CallableRequest<unknown>): Promise<unknown> {
    requireHosted();
    if (!names.has(name)) throw new HttpsError("not-found", "Unknown candidate callable.");
    try {
      if (name.includes("BiteSaver")) {
        const context = {database: authority, discoveryKey: options.discoveryKey,
          identityKeyV1: options.identityKeyV1, identity: customerBiteSaverCallableIdentity(request)};
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
    async initializeDerived() { requireHosted(); await source.initialize(); await model.initializeLocalSchema(); },
    async close() { await model.close(); },
    /** Explicit bounded lifecycle pass; no timer, scheduler or cloud invocation. */
    async maintainLifecycle(nowMs = Date.now()) {
      requireHosted();
      const bindings = await pruneBindings(nowMs, 100);
      const sql = await model.garbageCollect(nowMs);
      return {bindings, sql};
    },
    /** Search-only trigger composition. Existing bounded parent fanout and job
     * continuation logic is reused. No unrelated media/moderation work activates.
     */
    registerSourceTriggers() {
      requireHosted();
      const trigger = {database: configuration.hosted.firestoreDatabase, retry: true, maxInstances: 4, concurrency: 1, timeoutSeconds: 30};
      return Object.freeze({
        maintainPostgisBiteSaverRestaurant: onDocumentWritten({...trigger,
          document: "restaurant_accounts/{restaurantAccountId}"}, async event => {
          requireHosted();
          await handleBiteSaverRestaurantWrite(maintenanceDatabase, {
            restaurantAccountId: event.params.restaurantAccountId,
            before: readSearchIndexEventSnapshotData(event.data?.before),
            after: readSearchIndexEventSnapshotData(event.data?.after), sourceEventId: event.id,
            now: new Date(), identityKeyV1: options.identityKeyV1});
        }),
        maintainPostgisBiteScoreRestaurant: onDocumentWritten({...trigger,
          document: "bitescore_restaurants/{restaurantId}"}, async event => {
          requireHosted();
          await handleBiteScoreRestaurantWrite(maintenanceDatabase, {restaurantId: event.params.restaurantId,
            before: readSearchIndexEventSnapshotData(event.data?.before),
            after: readSearchIndexEventSnapshotData(event.data?.after), sourceEventId: event.id, now: new Date()});
        }),
        maintainPostgisBiteScoreDish: onDocumentWritten({...trigger, document: "bitescore_dishes/{dishId}"}, async event => {
          requireHosted();
          await reconcileBiteScoreDishIndex(maintenanceDatabase, event.params.dishId, new Date());
        }),
        maintainPostgisBiteScoreDishAggregate: onDocumentWritten({...trigger, document: "dish_rating_aggregates/{dishId}"}, async event => {
          requireHosted();
          await reconcileBiteScoreDishIndex(maintenanceDatabase, event.params.dishId, new Date());
        }),
        maintainPostgisBiteSaverCoupon: onDocumentWritten({...trigger,
          document: "restaurant_accounts/{restaurantAccountId}/coupons/{couponId}"}, async event => {
          requireHosted();
          await handleBiteSaverCouponOfferWrite(maintenanceDatabase, {restaurantAccountId: event.params.restaurantAccountId,
            couponId: event.params.couponId, now: new Date(), identityKeyV1: options.identityKeyV1});
        }),
        maintainPostgisBiteSaverDailySpecial: onDocumentWritten({...trigger,
          document: "restaurant_accounts/{restaurantAccountId}/daily_specials/{dailySpecialId}"}, async event => {
          requireHosted();
          await handleBiteSaverDailySpecialOfferWrite(maintenanceDatabase, {restaurantAccountId: event.params.restaurantAccountId,
            dailySpecialId: event.params.dailySpecialId, now: new Date()});
        }),
        processPostgisSearchIndexJob: onDocumentCreated({...trigger,
          document: "private_search_index_jobs/{jobId}"}, async event => {
          requireHosted();
          await processSearchIndexJob(maintenanceDatabase, event.params.jobId, new Date(), options.identityKeyV1);
        }),
      });
    },
  });
}
