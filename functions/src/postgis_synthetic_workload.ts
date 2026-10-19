import {createHash} from "node:crypto";
import type {Firestore} from "firebase-admin/firestore";
import {canonicalRestaurantGeohash} from "./restaurant_geo_helpers.js";
import {reconcileBiteSaverRestaurantIndex, reconcileBiteScoreRestaurantIndex, reconcileBiteScoreDishIndex,
  handleBiteSaverCouponOfferWrite, type SearchIndexDatabase} from "./search_index_maintenance.js";
import type {CustomerBiteSaverIdentityKeyV1} from "./customer_bitesaver_public_identity.js";

export type PostgisSyntheticWorkload = Readonly<{
  version: 1; planId: string; offset: number; count: number; nowMs: number;
  operation: "seed" | "edit-offer" | "delete-offer" | "hide-parent" | "delete-parent";
  distribution: "mixed-national-v1";
  maxParentsPerInvocation: number; maxInvocations: number;
  maxSourceOperations: number; maxSourceBytes: number;
}>;
type Document = Record<string, unknown>;
type Row = {path: string; data: Document};
const runPattern = /^bs-postgis-[a-z0-9-]{1,60}$/u;
function need(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}

/** Fixed synthetic scenarios, separate namespace roots, deterministic content.
 * Restricted histories are client-owned input: historyOfferOrdinals describes
 * the synthetic usage scenario without writing authentication/customer history.
 */
export function postgisSyntheticParent(runId: string, index: number, nowMs: number) {
  need(runPattern.test(runId) && Number.isSafeInteger(index) && index >= 0 && index < 100_000 &&
    Number.isSafeInteger(nowMs) && nowMs > 0, "Invalid synthetic parent identity.");
  const saverId = `${runId}-saver-${index}`, scoreId = `${runId}-score-${index}`;
  const scenario = index % 20;
  const historyCohort = index % 1000 >= 100 && index % 1000 < 200;
  const national = !historyCohort && index % 4 === 3;
  // Dense Miami, sparse Florida and a deterministic nationwide grid are
  // independent from catalog size. No scraped/public restaurant data.
  const latitude = historyCohort ? 25.77 : national ? 25 + (index * 37 % 2400) / 100 : 25.77 + (scenario === 18 ? 1 : index % 70 * 0.0001);
  const longitude = historyCohort ? -80.19 : national ? -124 + (index * 53 % 5700) / 100 : -80.19 + index % 3 * 0.0001;
  const point = {latitude, longitude}, now = new Date(nowMs);
  const childCount = index % 1000 === 999 ? 100 : scenario === 0 ? 0 : scenario === 1 ? 10 : scenario % 3 + 1;
  const hidden = scenario === 2, expired = scenario === 3, scheduled = scenario === 4;
  const common = {streetAddress: `${index + 1} Synthetic Avenue`, city: national ? "Synthetic National" : "Miami",
    state: national ? ["CA", "TX", "NY", "WA"][Math.floor(index / 4) % 4] : "FL", zipCode: national ? "00000" : "33101",
    ...point, geohash: canonicalRestaurantGeohash(point), createdAt: now, updatedAt: now};
  const rows: Row[] = [
    {path: `restaurant_accounts/${saverId}`, data: {...common, restaurantName: `Synthetic Workload Diner ${String(index).padStart(7, "0")}`,
      approvalStatus: "approved", couponPostingEnabled: true, subscriptionStatus: "active", couponApplicationSubmitted: true,
      offerCatalogUpdatedAt: now, adminHidden: hidden}},
    {path: `bitescore_restaurants/${scoreId}`, data: {...common, name: `Synthetic Workload Catalog ${String(index).padStart(7, "0")}`,
      location: point, isActive: true, isClaimed: false, adminHidden: hidden}},
  ];
  const couponIds: string[] = [], dishIds: string[] = [], historyOfferOrdinals: number[] = [];
  for (let child = 0; child < childCount; child++) {
    const couponId = `workload-coupon-${index}-${child}`, dishId = `${runId}-dish-${index}-${child}`;
    couponIds.push(couponId);dishIds.push(dishId);
    const restricted = historyCohort || scenario % 2 === 1 || index % 20 >= 10;
    if (restricted && (historyCohort || index % 20 >= 10)) historyOfferOrdinals.push(child);
    rows.push({path: `restaurant_accounts/${saverId}/coupons/${couponId}`, data: {id: couponId,
      title: child % 2 ? "Synthetic Hoagie offer" : "Synthetic noodle offer", restaurant: `Synthetic Workload Diner ${index}`,
      details: "Synthetic qualification fixture; no redemption value", isActive: true,
      usageRule: restricted ? "Once per customer" : "Unlimited", isProximityOnly: false,
      startTime: new Date(nowMs + (scheduled ? 86_400_000 : -86_400_000)),
      endTime: new Date(nowMs + (expired ? -1000 : 86_400_000 * 2)), createdAt: now, updatedAt: now}});
    rows.push({path: `bitescore_dishes/${dishId}`, data: {id: dishId, restaurantId: scoreId,
      name: child % 2 ? "Synthetic Hoagie" : "Synthetic Hamburger", category: "Sandwiches",
      subcategory: child % 2 ? "Sub Sandwich" : "Hamburger", categoryTags: ["Sandwiches"], isActive: true, createdAt: now, updatedAt: now}});
    rows.push({path: `dish_rating_aggregates/${dishId}`, data: {dishId, restaurantId: scoreId, ratingCount: 3,
      overallBiteScore: 80 + child % 4, tastinessScoreAverage: 8, qualityScoreAverage: 8,
      valueScoreAverage: 8, overallImpressionAverage: 8, updatedAt: now}});
  }
  // Conservative logical SDK work allowance including five transaction attempts.
  // This is a reservation upper, not a claim about provider billing or throughput.
  const nativeCalls = 2 + couponIds.length + dishIds.length;
  const reads = nativeCalls * 12 * 5 + rows.length + 4;
  const writes = nativeCalls * 8 * 5 + rows.length + 4;
  const bytes = Buffer.byteLength(JSON.stringify(rows)) + nativeCalls * 8192 * 5;
  return {saverId, scoreId, couponIds, dishIds, rows, historyOfferOrdinals,
    scenario: {hidden, expired, scheduled, noOffer: childCount === 0, national, sparse: scenario === 18, historyCohort},
    estimate: {reads, writes, deletes: rows.length + nativeCalls * 5,
      operations: reads + writes + rows.length + nativeCalls * 5, bytes}};
}

export function validatePostgisSyntheticWorkload(runId: string, plan: PostgisSyntheticWorkload): string {
  need(runPattern.test(runId) && plan && Object.keys(plan).sort().join(",") ===
    "count,distribution,maxInvocations,maxParentsPerInvocation,maxSourceBytes,maxSourceOperations,nowMs,offset,operation,planId,version",
  "Invalid exact synthetic workload plan.");
  need(plan.version === 1 && /^[a-z0-9-]{1,64}$/u.test(plan.planId) && plan.distribution === "mixed-national-v1" &&
    ["seed", "edit-offer", "delete-offer", "hide-parent", "delete-parent"].includes(plan.operation), "Invalid synthetic workload scenario.");
  for (const key of ["offset", "count", "nowMs", "maxParentsPerInvocation", "maxInvocations", "maxSourceOperations", "maxSourceBytes"] as const) {
    need(Number.isSafeInteger(plan[key]), "Synthetic workload limits must be exact integers.");
  }
  need(plan.offset >= 0 && plan.count > 0 && plan.offset + plan.count <= 100_000 && plan.nowMs > 0 &&
    plan.maxParentsPerInvocation > 0 && plan.maxParentsPerInvocation <= 2500 && plan.maxInvocations > 0 && plan.maxInvocations <= 32 &&
    plan.count <= plan.maxParentsPerInvocation * plan.maxInvocations && plan.maxSourceOperations > 0 && plan.maxSourceOperations <= 3_000_000 &&
    plan.maxSourceBytes > 0 && plan.maxSourceBytes <= 2 * 1024 ** 3, "Synthetic workload exceeds bounded capacity.");
  return createHash("sha256").update(JSON.stringify([runId, ...Object.keys(plan).sort().map(key => [key, plan[key as keyof typeof plan]])])).digest("hex");
}

export function postgisSyntheticWorkloadBudget(runId: string, plan: PostgisSyntheticWorkload) {
  const planDigest = validatePostgisSyntheticWorkload(runId, plan);
  const totals = {reads: 0, writes: 0, deletes: 0, operations: 0, bytes: 0};
  const datasetCounts = {pairs: plan.count, saverParents: plan.count, scoreParents: plan.count,
    totalParentRoots: plan.count * 2, offers: 0, dishes: 0, aggregates: 0, rawDocuments: 0};
  let invocations = 1, inBatch = 0, operations = 0, bytes = 0;
  for (let index = plan.offset; index < plan.offset + plan.count; index++) {
    const parent = postgisSyntheticParent(runId, index, plan.nowMs), estimate = parent.estimate;
    datasetCounts.offers += parent.couponIds.length;datasetCounts.dishes += parent.dishIds.length;
    datasetCounts.aggregates += parent.dishIds.length;datasetCounts.rawDocuments += parent.rows.length;
    need(estimate.operations <= plan.maxSourceOperations && estimate.bytes <= plan.maxSourceBytes, "One parent exceeds the reservation.");
    if (inBatch === plan.maxParentsPerInvocation || operations + estimate.operations > plan.maxSourceOperations || bytes + estimate.bytes > plan.maxSourceBytes) {
      invocations++;inBatch = 0;operations = 0;bytes = 0;
    }
    inBatch++;operations += estimate.operations;bytes += estimate.bytes;
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += estimate[key];
  }
  need(invocations <= plan.maxInvocations && totals.reads <= 200_000_000 && totals.writes <= 40_000_000 &&
    totals.deletes <= 30_000_000 && totals.bytes <= 100 * 1024 ** 3, "Synthetic plan exceeds total source budget.");
  // The controller enforces these same per-invocation ceilings. Reserving all
  // invocations covers interruption/replay instead of assuming perfect progress.
  const reservationCounts = {reads: Math.ceil(plan.maxSourceOperations * 3 / 5),
    writes: Math.ceil(plan.maxSourceOperations * 2 / 5) + plan.maxParentsPerInvocation,
    deletes: Math.ceil(plan.maxSourceOperations * 7 / 100) + plan.maxParentsPerInvocation};
  need(reservationCounts.reads * plan.maxInvocations <= 200_000_000 && reservationCounts.writes * plan.maxInvocations <= 40_000_000 &&
    reservationCounts.deletes * plan.maxInvocations <= 30_000_000, "Synthetic retries exceed the cumulative operation ceiling.");
  return {planDigest, minimumInvocationsByWorkBounds: invocations, maximumReservedActiveSeconds: plan.maxInvocations * 600,
    reservationCounts, datasetCounts, totals, units: {count: "Saver/Score parent pairs", bytes: "conservative transfer/work allowance; not measured stored bytes"},
    timingQualified: false as const};
}

/** Resume only this exact immutable plan. Checkpoint a parent before writing it;
 * a crash replays at most that parent's deterministic native writes. A different
 * seed/edit cannot overtake an incomplete plan and resurrect an older value.
 * Caller supplies the signed invocation/reservation identity; duplicate IDs do
 * not grant another execution. No SQL data or source DTOs are fabricated.
 */
export async function runPostgisSyntheticWorkload(database: Firestore, maintenance: SearchIndexDatabase,
  identityKey: CustomerBiteSaverIdentityKeyV1, runId: string, plan: PostgisSyntheticWorkload,
  options: {invocationId: string; deadlineMs: number; now?: () => number; authorize?: () => void}) {
  const planDigest = validatePostgisSyntheticWorkload(runId, plan), clock = options.now ?? Date.now;
  const invocationStartedMs = clock();
  need(/^[a-zA-Z0-9_-]{1,100}$/u.test(options.invocationId) && Number.isSafeInteger(options.deadlineMs) &&
    Number.isSafeInteger(invocationStartedMs) && options.deadlineMs > invocationStartedMs &&
    options.deadlineMs <= invocationStartedMs + 540_000, "Invalid bounded workload invocation.");
  const authorize = () => {need(clock() < options.deadlineMs, "Synthetic invocation deadline reached; resume checkpoint.");options.authorize?.();};
  authorize();
  const marker = database.doc(`private_postgis_fixture_batches/${planDigest}`);
  const pending = await database.collection("private_postgis_fixture_batches").where("complete", "==", false).limit(2).get();
  need(pending.size <= 1 && pending.docs.every(doc => doc.id === planDigest), "A different synthetic batch is incomplete.");
  const owner = database.doc("private_postgis_fixture_control/owner");
  const state = await database.runTransaction(async transaction => {
    authorize();
    const [ownerSnapshot, markerSnapshot] = await transaction.getAll(owner, marker), lease = ownerSnapshot.data();
    if (lease) {
      need(typeof lease.planDigest === "string" && /^[a-f0-9]{64}$/u.test(lease.planDigest) &&
        Number.isSafeInteger(lease.activeUntilMs), "Invalid synthetic writer lease.");
      need(lease.activeUntilMs <= clock(), "Another synthetic invocation owns the writer lease.");
      if (lease.planDigest !== planDigest) {
        const previous = await transaction.get(database.doc(`private_postgis_fixture_batches/${lease.planDigest}`));
        need(previous.get("complete") === true, "A different synthetic batch is incomplete.");
      }
    }
    const value = markerSnapshot.data() ?? {runId, planDigest, plan, complete: false, next: plan.offset, invocationIds: [], reserved: {operations: 0, bytes: 0}};
    need(value.runId === runId && value.planDigest === planDigest && validatePostgisSyntheticWorkload(runId, value.plan) === planDigest &&
      Number.isSafeInteger(value.next) && value.next >= plan.offset && value.next <= plan.offset + plan.count &&
      Array.isArray(value.invocationIds) && (!value.complete || value.next === plan.offset + plan.count), "Invalid synthetic checkpoint.");
    if (value.complete) return value;
    need(!value.invocationIds.includes(options.invocationId), "Invocation was already attempted; reconcile or use the next signed reservation.");
    need(value.invocationIds.length < plan.maxInvocations, "Synthetic invocation allowance exhausted.");
    value.invocationIds.push(options.invocationId);
    transaction.set(marker, value);
    transaction.set(owner, {runId, planDigest, invocationId: options.invocationId, activeUntilMs: invocationStartedMs + 600_000});
    return value;
  });
  if (state.complete) return {ready: true, phase: "complete", next: state.next, planDigest, completed: 0};
  try {
  let completed = 0, operations = 0, bytes = 0;
  while (state.next < plan.offset + plan.count && completed < plan.maxParentsPerInvocation && clock() < options.deadlineMs) {
    authorize();
    const parent = postgisSyntheticParent(runId, state.next, plan.nowMs), estimate = parent.estimate;
    if (operations + estimate.operations > plan.maxSourceOperations || bytes + estimate.bytes > plan.maxSourceBytes) break;
    operations += estimate.operations;bytes += estimate.bytes;
    // Attempt liabilities survive interrupted/replayed parent work.
    state.reserved.operations += estimate.operations;state.reserved.bytes += estimate.bytes;
    need(state.reserved.operations <= plan.maxSourceOperations * plan.maxInvocations &&
      state.reserved.bytes <= plan.maxSourceBytes * plan.maxInvocations, "Synthetic cumulative allowance exhausted.");
    authorize();await marker.set(state);
    const now = new Date(plan.nowMs);
    if (plan.operation === "seed") {
      for (const row of parent.rows) {authorize();await database.doc(row.path).set(row.data);}
    } else {
      need(plan.operation === "delete-parent" || (await database.doc(`restaurant_accounts/${parent.saverId}`).get()).exists, "Synthetic mutation parent is missing.");
      if (plan.operation === "delete-parent") {
        for (const row of parent.rows) {authorize();await database.doc(row.path).delete();}
      } else if (plan.operation === "hide-parent") {
        await database.doc(`restaurant_accounts/${parent.saverId}`).update({adminHidden: true, updatedAt: now});
        await database.doc(`bitescore_restaurants/${parent.scoreId}`).update({adminHidden: true, updatedAt: now});
      } else if (parent.couponIds.length) {
        const coupon = database.doc(`restaurant_accounts/${parent.saverId}/coupons/${parent.couponIds[0]}`);
        if (plan.operation === "delete-offer") await coupon.delete();
        else await coupon.update({title: "Synthetic edited same-ID offer", updatedAt: now});
      }
    }
    authorize();await reconcileBiteSaverRestaurantIndex(maintenance, parent.saverId, now, identityKey);
    authorize();await reconcileBiteScoreRestaurantIndex(maintenance, parent.scoreId, now);
    for (const couponId of parent.couponIds) {authorize();await handleBiteSaverCouponOfferWrite(maintenance,
      {restaurantAccountId: parent.saverId, couponId, now, identityKeyV1: identityKey});}
    for (const dishId of parent.dishIds) {authorize();await reconcileBiteScoreDishIndex(maintenance, dishId, now);}
    state.next++;completed++;state.complete = state.next === plan.offset + plan.count;
    authorize();await marker.set(state);
  }
  return {ready: state.complete === true, phase: state.complete ? "complete" : "incomplete", next: state.next,
    planDigest, completed, reservedThisInvocation: {operations, bytes}};
  } finally {
    // Hard process loss retains the lease through the full platform lifetime;
    // ordinary completion/error releases only this invocation's own identity.
    if (clock() < options.deadlineMs) {
      options.authorize?.();
      await database.runTransaction(async transaction => {
        const held = (await transaction.get(owner)).data();
        if (held?.planDigest === planDigest && held?.invocationId === options.invocationId) {
          transaction.set(owner, {...held, activeUntilMs: 0});
        }
      });
    }
  }
}
