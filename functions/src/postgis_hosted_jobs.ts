import {createHash} from "node:crypto";
import type {Firestore} from "firebase-admin/firestore";
import {canonicalRestaurantGeohash} from "./restaurant_geo_helpers.js";
import {reconcileBiteSaverRestaurantIndex, reconcileBiteScoreRestaurantIndex, reconcileBiteScoreDishIndex,
  handleBiteSaverCouponOfferWrite} from "./search_index_maintenance.js";
import type {CustomerBiteSaverIdentityKeyV1} from "./customer_bitesaver_public_identity.js";
import type {createHostedPostgisRuntime} from "./postgis_hosted_runtime.js";
import type {createFirestoreSearchIndexDatabase} from "./search_index_maintenance.js";
import {runPostgisSyntheticWorkload, type PostgisSyntheticWorkload} from "./postgis_synthetic_workload.js";

export type PostgisSyntheticBatch = Readonly<{offset: number; count: number; nowMs: number;
  operation: "seed" | "edit-offer" | "delete-offer" | "hide-parent"}>;
/** Fixed synthetic content only; never accepts arbitrary paths, account fields or
 * real imported restaurants. Each Saver participant and Score catalog ID differs.
 * The controlled Gate1 job is the sole writer; a pending batch blocks publication.
 */
export async function writePostgisSyntheticBatch(database: Firestore,
  maintenance: ReturnType<typeof createFirestoreSearchIndexDatabase>, identityKeyV1: CustomerBiteSaverIdentityKeyV1,
  runId: string, batch: PostgisSyntheticBatch): Promise<{batchId: string; completed: number}> {
  if (!/^bs-postgis-[a-z0-9-]{1,60}$/u.test(runId) ||
      Object.keys(batch).sort().join(",") !== "count,nowMs,offset,operation" ||
      !Number.isSafeInteger(batch.offset) || batch.offset < 0 || batch.offset > 100_000 ||
      !Number.isInteger(batch.count) || batch.count < 1 || batch.count > 25 ||
      !Number.isSafeInteger(batch.nowMs) || batch.nowMs < 1 ||
      !["seed", "edit-offer", "delete-offer", "hide-parent"].includes(batch.operation)) throw new Error("Invalid bounded synthetic fixture batch.");
  const batchId = createHash("sha256").update(JSON.stringify([runId, batch.offset, batch.count, batch.nowMs, batch.operation])).digest("hex");
  const marker = database.doc(`private_postgis_fixture_batches/${batchId}`);
  const old = await marker.get();
  if (old.get("complete") === true) return {batchId, completed: batch.count};
  const pending = await database.collection("private_postgis_fixture_batches").where("complete", "==", false).limit(2).get();
  if (pending.size > 1 || pending.docs.some(document => document.id !== batchId)) {
    throw new Error("A different synthetic batch is incomplete; resume it before admitting another mutation.");
  }
  await marker.set({runId, batch, complete: false});
  const now = new Date(batch.nowMs);
  for (let i = batch.offset; i < batch.offset + batch.count; i++) {
    const saverId = `${runId}-saver-${i}`, scoreId = `${runId}-score-${i}`, couponId = `fixture-coupon-${i}`, dishId = `${runId}-dish-${i}`;
    const saver = database.doc(`restaurant_accounts/${saverId}`), coupon = saver.collection("coupons").doc(couponId);
    if (batch.operation === "seed") {
      const point = {latitude: 25.77 + i % 70 * 0.0001, longitude: -80.19 + i % 3 * 0.0001};
      const common = {streetAddress: `${i + 1} Synthetic Avenue`, city: "Miami", state: "FL", zipCode: "33101",
        ...point, geohash: canonicalRestaurantGeohash(point), createdAt: now, updatedAt: now};
      await saver.set({...common, restaurantName: `Synthetic Staging Diner ${i}`, approvalStatus: "approved", couponPostingEnabled: true,
        subscriptionStatus: "active", couponApplicationSubmitted: true, offerCatalogUpdatedAt: now});
      await coupon.set({id: couponId, title: "Synthetic noodle offer", restaurant: `Synthetic Staging Diner ${i}`,
        details: "Synthetic fixture with no redemption value", isActive: true, usageRule: "Unlimited", isProximityOnly: false,
        startTime: new Date(batch.nowMs - 86_400_000), endTime: new Date(batch.nowMs + 86_400_000), createdAt: now, updatedAt: now});
      await database.doc(`bitescore_restaurants/${scoreId}`).set({...common, name: `Synthetic Staging Catalog ${i}`,
        location: point, isActive: true, isClaimed: false});
      await database.doc(`bitescore_dishes/${dishId}`).set({id: dishId, restaurantId: scoreId, name: "Synthetic Hamburger",
        category: "Sandwiches", subcategory: "Hamburger", categoryTags: ["Sandwiches"], isActive: true, createdAt: now, updatedAt: now});
      await database.doc(`dish_rating_aggregates/${dishId}`).set({dishId, restaurantId: scoreId, ratingCount: 3, overallBiteScore: 80,
        tastinessScoreAverage: 8, qualityScoreAverage: 8, valueScoreAverage: 8, overallImpressionAverage: 8, updatedAt: now});
    } else {
      if (!(await saver.get()).exists) throw new Error("Synthetic mutation parent is missing.");
      if (batch.operation === "edit-offer") await coupon.update({title: "Synthetic edited same-ID offer", updatedAt: now});
      else if (batch.operation === "delete-offer") await coupon.delete();
      else await saver.update({adminHidden: true, updatedAt: now});
    }
    // Native writers reconcile the exact known finite children, including replay
    // after a crash between a raw write and journal publication. No raw SQL DTOs.
    await reconcileBiteSaverRestaurantIndex(maintenance, saverId, now, identityKeyV1);
    await handleBiteSaverCouponOfferWrite(maintenance, {restaurantAccountId: saverId, couponId, now, identityKeyV1});
    if (batch.operation === "seed") {
      await reconcileBiteScoreRestaurantIndex(maintenance, scoreId, now);
      await reconcileBiteScoreDishIndex(maintenance, dishId, now);
    }
  }
  await marker.update({complete: true});
  return {batchId, completed: batch.count};
}
export async function requirePostgisSyntheticBatchesComplete(database: Firestore, runId: string): Promise<void> {
  const pending = await database.collection("private_postgis_fixture_batches").where("complete", "==", false).limit(1).get();
  if (!pending.empty || !/^bs-postgis-[a-z0-9-]{1,60}$/u.test(runId)) throw new Error("Synthetic fixture mutation is incomplete; reconcile before publication.");
}
export type HostedPostgisJob = Readonly<{id: string; action: "initialize" | "fixture" | "fixture-stream" | "enroll" | "catchup" | "lifecycle" | "snapshot" | "restore" | "prune";
  batch?: PostgisSyntheticBatch; workload?: PostgisSyntheticWorkload; bootstrapId?: string}>;
export async function runHostedPostgisNativeJob(runtime: ReturnType<typeof createHostedPostgisRuntime>,
  database: Firestore, identityKey: CustomerBiteSaverIdentityKeyV1, runId: string, job: HostedPostgisJob,
  workloadOptions?: Parameters<typeof runPostgisSyntheticWorkload>[5]): Promise<unknown> {
  if (job.action === "initialize") {await runtime.initializeDerived();return {initialized: true};}
  if (job.action === "fixture" && job.batch) return writePostgisSyntheticBatch(database, runtime.maintenanceDatabase, identityKey, runId, job.batch);
  if (job.action === "fixture-stream" && job.workload && workloadOptions) return runPostgisSyntheticWorkload(database,
    runtime.maintenanceDatabase, identityKey, runId, job.workload, workloadOptions);
  await requirePostgisSyntheticBatchesComplete(database, runId);
  if (job.action === "enroll" && job.bootstrapId) return runtime.source.advanceEnrollment(job.bootstrapId, 100);
  if (job.action === "catchup") return runtime.model.catchUp(75);
  if (job.action === "lifecycle") return runtime.maintainLifecycle();
  throw new Error("Unsupported native job action.");
}
