import {createHash} from "node:crypto";
import {
  createDishReviewAggregateAccumulator,
  finalizeDishReviewAggregate,
  parseDishReviewAggregateCandidate,
  restoreDishReviewAggregateAccumulator,
  type DishReviewAggregateAccumulator,
  type DishReviewAggregateCandidate,
} from "./dish_review_aggregate_accumulator.js";
import {
  ratingDishOperationLockPath,
  ratingRestaurantOperationLockPath,
} from "./rating_destructive_job_contract.js";
import {dishMergeReviewLockPath} from "./dish_proposal_private_contract.js";
import {reviewMilestoneReconciliationLockPath} from "./review_milestone_reconciliation_lock.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {customerBiteScoreUtf16Key} from "./customer_bitescore_search_contract.js";
import type {
  RatingDestructivePrivateDatabase,
  RatingDestructivePrivateTransaction,
  RatingDestructiveStoredDocument,
} from "./rating_destructive_job_store.js";

// This record is deliberately absent/off until the coordinated post-wipe rollout.
// epoch identifies that new-data cutover, not an event or a migration version.
export const biteScoreReviewAggregationRuntimePath =
  "private_bitescore_runtime/aggregation";
export const biteScoreReviewAggregateCollection =
  "private_bitescore_review_aggregates";
export const biteScoreReviewAggregateBatchSize = 25;

type Data = Readonly<Record<string, unknown>>;
type Database = RatingDestructivePrivateDatabase;
type Transaction = RatingDestructivePrivateTransaction;
type Document = RatingDestructiveStoredDocument;
type Candidate = DishReviewAggregateCandidate;

export class BiteScoreReviewAggregateError extends Error {
  constructor(
    public readonly code: "invalid-argument" | "permission-denied" |
      "failed-precondition" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "BiteScoreReviewAggregateError";
  }
}

function fail(code: BiteScoreReviewAggregateError["code"], message: string): never {
  throw new BiteScoreReviewAggregateError(code, message);
}

function id(value: unknown): string {
  const exact = readBiteScoreCatalogRestaurantId(value);
  if (exact === null) {
    fail("invalid-argument", "An exact document identity is required.");
  }
  return exact;
}

function hash(value: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function customerBiteScoreReviewDocumentId(dishId: string, userId: string): string {
  return `bsreview_${hash([id(dishId), id(userId)])}`;
}

function reviewOrderFields(reviewId: string) {
  const key = customerBiteScoreUtf16Key(reviewId);
  return {aggregateReviewOrder0: key.subarray(0, 1500), aggregateReviewOrder1: key.subarray(1500)};
}

function equalBytes(left: unknown, right: Buffer): boolean {
  return left instanceof Uint8Array && Buffer.from(left).equals(right);
}

export function biteScoreReviewAggregateStatePath(dishId: string): string {
  return `${biteScoreReviewAggregateCollection}/${hash([id(dishId)])}`;
}

function contributionPath(dishId: string, userId: string): string {
  return `${biteScoreReviewAggregateStatePath(dishId)}/contributions/${hash([id(userId)])}`;
}

function generation(data: Data): number {
  const value = data.aggregateWriteGeneration ?? 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("failed-precondition", "Dish aggregate generation is invalid.");
  }
  return value as number;
}

async function runtime(transaction: Transaction): Promise<string | null> {
  const data = (await transaction.getDocument(
    biteScoreReviewAggregationRuntimePath,
  ))?.data;
  if (data?.enabled !== true) return null;
  if (data.version !== 1 || typeof data.epoch !== "string" ||
      data.epoch.length < 1 || data.epoch.length > 128) {
    fail("failed-precondition", "Trusted review initialization is invalid.");
  }
  return data.epoch;
}

type State = Readonly<{
  version: 1;
  epoch: string;
  dishId: string;
  restaurantId: string;
  aggregateWriteGeneration: number;
  serial: number;
  status: "ready" | "rebuilding" | "retired";
  phase: "scan" | "cleanup";
  cursor: string | null;
  sums: DishReviewAggregateAccumulator;
  updatedAt: Date;
}>;

function stateFrom(document: Document | null, epoch: string): State | null {
  if (document === null || document.data.epoch !== epoch) return null;
  const d = document.data;
  if (d.version !== 1 || !Number.isSafeInteger(d.serial) ||
      (d.serial as number) < 0 ||
      !["ready", "rebuilding", "retired"].includes(d.status as string) ||
      !["scan", "cleanup"].includes(d.phase as string) ||
      (d.cursor !== null && typeof d.cursor !== "string")) {
    fail("failed-precondition", "Trusted review accounting is invalid.");
  }
  return {
    version: 1, epoch, dishId: id(d.dishId),
    restaurantId: id(d.restaurantId),
    aggregateWriteGeneration: generation(d), serial: d.serial as number,
    status: d.status as State["status"], phase: d.phase as State["phase"],
    cursor: d.cursor as string | null,
    sums: restoreDishReviewAggregateAccumulator(d.sums),
    updatedAt: d.updatedAt as Date,
  };
}

function newState(
  epoch: string, dishId: string, dish: Data, now: Date,
): State {
  return {
    version: 1, epoch, dishId, restaurantId: id(dish.restaurantId),
    aggregateWriteGeneration: generation(dish), serial: 0,
    status: "ready", phase: "scan", cursor: null,
    sums: createDishReviewAggregateAccumulator(dishId), updatedAt: now,
  };
}

function rebuild(state: State, dish: Data, now: Date): State {
  if (!Number.isSafeInteger(state.serial + 1)) {
    fail("failed-precondition", "Trusted accounting generation exhausted.");
  }
  return {
    ...newState(state.epoch, state.dishId, dish, now),
    serial: state.serial + 1, status: "rebuilding",
  };
}

function candidate(document: Document | null, dishId: string): Candidate | null {
  if (document === null) return null;
  const parsed = parseDishReviewAggregateCandidate(document);
  if (parsed === null || parsed.dishId !== dishId ||
      parsed.dishId !== document.data.dishId ||
      parsed.restaurantId !== document.data.restaurantId ||
      parsed.userId !== document.data.userId) return null;
  id(parsed.userId);
  return parsed;
}

function previousContribution(document: Document | null, state: State): Candidate | null {
  if (document?.data.epoch !== state.epoch ||
      document?.data.serial !== state.serial) return null;
  const value = document.data.candidate as Candidate | undefined;
  if (value === undefined || value.dishId !== state.dishId) {
    fail("failed-precondition", "Trusted review contribution is invalid.");
  }
  return value;
}

function fresher(left: Candidate, right: Candidate): Candidate {
  if (left.freshnessSeconds !== right.freshnessSeconds) {
    return left.freshnessSeconds > right.freshnessSeconds ? left : right;
  }
  if (left.freshnessNanoseconds !== right.freshnessNanoseconds) {
    return left.freshnessNanoseconds > right.freshnessNanoseconds ? left : right;
  }
  return left.sourceDocumentId > right.sourceDocumentId ? left : right;
}

export function replaceBiteScoreReviewContribution(
  initial: DishReviewAggregateAccumulator,
  previous: Candidate | null,
  next: Candidate | null,
): DishReviewAggregateAccumulator {
  const sums = {...restoreDishReviewAggregateAccumulator(initial)};
  for (const [entry, sign] of [[previous, -1], [next, 1]] as const) {
    if (entry === null) continue;
    if (entry.dishId !== sums.dishId) {
      fail("failed-precondition", "Review belongs to another dish.");
    }
    sums.committedRatingCount += sign;
    sums.overallBiteScoreSum += sign * entry.overallBiteScore;
    sums.overallImpressionSum += sign * entry.overallImpression;
    for (const component of ["tastinessScore", "qualityScore", "valueScore"] as const) {
      if (entry[component] !== null) {
        sums[`${component}Sum`] += sign * entry[component]!;
        sums[`${component}Count`] += sign;
      }
    }
  }
  if (sums.committedRatingCount === 0) {
    return createDishReviewAggregateAccumulator(sums.dishId);
  }
  return restoreDishReviewAggregateAccumulator(sums);
}

function storeContribution(
  transaction: Transaction, state: State, userId: string,
  next: Candidate | null,
): void {
  const path = contributionPath(state.dishId, userId);
  if (next === null) transaction.deleteDocument(path);
  else transaction.setDocument(path, {
    epoch: state.epoch, serial: state.serial, candidate: next,
  });
}

function publish(transaction: Transaction, state: State, now: Date): void {
  transaction.setDocument(biteScoreReviewAggregateStatePath(state.dishId), {
    ...state, updatedAt: now,
  });
  transaction.setDocument(`dish_rating_aggregates/${state.dishId}`, {
    ...finalizeDishReviewAggregate(state.sums, state.restaurantId),
    aggregateWriteGeneration: state.aggregateWriteGeneration,
    updatedAt: now,
  });
}

async function locks(transaction: Transaction, dishId: string, restaurantId: string) {
  const [dish, restaurant, proposal] = await Promise.all([
    transaction.getDocument(ratingDishOperationLockPath(dishId)),
    transaction.getDocument(ratingRestaurantOperationLockPath(restaurantId)),
    transaction.getDocument(dishMergeReviewLockPath(dishId)),
  ]);
  return {
    blocked: dish !== null || restaurant !== null ||
      proposal?.data.blocksClientReviews === true ||
      proposal?.data.blocksClientAggregates === true,
    retired: dish?.data.permanent === true || restaurant?.data.permanent === true ||
      proposal?.data.state === "merged_source",
  };
}

async function latest(
  transaction: Transaction, dishId: string, userId: string,
): Promise<Document | null> {
  return (await transaction.queryDocuments({
    collectionPath: "dish_reviews",
    where: [
      {field: "dishId", operator: "==", value: dishId},
      {field: "userId", operator: "==", value: userId},
    ],
    orderBy: [
      {field: "updatedAt", direction: "desc"},
      {field: "aggregateReviewOrder0", direction: "desc"},
      {field: "aggregateReviewOrder1", direction: "desc"},
    ], limit: 1,
  }))[0] ?? null;
}

function scope(data: Data | null | undefined): {dishId: string; userId: string} | null {
  if (data === null || data === undefined) return null;
  try { return {dishId: id(data.dishId), userId: id(data.userId)}; }
  catch { return null; }
}

/** Event snapshots identify affected scopes only; authoritative contributions
 * always come from current transaction reads, including on delayed deletions. */
export async function reconcileBiteScoreReviewAggregateEvent(
  database: Database,
  value: {reviewId: string; before?: Data | null; after?: Data | null; now: Date},
): Promise<void> {
  const reviewId = id(value.reviewId);
  const scopes = await database.runTransaction(async (transaction) => {
    if (await runtime(transaction) === null) return [];
    const current = await transaction.getDocument(`dish_reviews/${reviewId}`);
    const unique = new Map<string, {dishId: string; userId: string}>();
    for (const data of [value.before, value.after, current?.data]) {
      const s = scope(data);
      if (s !== null) unique.set(JSON.stringify(s), s);
    }
    if (current !== null) {
      const keys = reviewOrderFields(reviewId);
      if (!equalBytes(current.data.aggregateReviewOrder0, keys.aggregateReviewOrder0) ||
          !equalBytes(current.data.aggregateReviewOrder1, keys.aggregateReviewOrder1)) {
        transaction.setDocument(`dish_reviews/${reviewId}`, keys, {merge: true});
      }
    }
    return [...unique.values()];
  });
  // At most three scopes. Each is independent and repeat-safe.
  for (const s of scopes) {
    await reconcileScope(database, s.dishId, s.userId, value.now);
  }
}

async function reconcileScope(
  database: Database, dishId: string, userId: string, now: Date,
): Promise<void> {
  await database.runTransaction(async (transaction) => {
    const epoch = await runtime(transaction);
    if (epoch === null) return;
    const [dishDocument, stateDocument, aggregate] = await Promise.all([
      transaction.getDocument(`bitescore_dishes/${dishId}`),
      transaction.getDocument(biteScoreReviewAggregateStatePath(dishId)),
      transaction.getDocument(`dish_rating_aggregates/${dishId}`),
    ]);
    const existing = stateFrom(stateDocument, epoch);
    if (dishDocument === null) {
      if (existing !== null) transaction.setDocument(
        biteScoreReviewAggregateStatePath(dishId), {...existing, status: "retired", updatedAt: now},
      );
      return;
    }
    const dish = dishDocument.data;
    const lock = await locks(transaction, dishId, id(dish.restaurantId));
    if (lock.retired) {
      if (existing !== null) transaction.setDocument(
        biteScoreReviewAggregateStatePath(dishId), {...existing, status: "retired", updatedAt: now},
      );
      return;
    }
    if (existing === null && generation(dish) === 0 &&
        (aggregate?.data.ratingCount ?? 0) !== 0) {
      fail("failed-precondition", "Initialize trusted accounting with new post-wipe content.");
    }
    let state = existing ?? newState(epoch, dishId, dish, now);
    if ((existing === null && generation(dish) > 0) || lock.blocked ||
        state.aggregateWriteGeneration !== generation(dish) ||
        state.restaurantId !== dish.restaurantId || state.status !== "ready") {
      state = rebuild(state, dish, now);
      transaction.setDocument(biteScoreReviewAggregateStatePath(dishId), state);
      return;
    }
    const [winner, contribution] = await Promise.all([
      latest(transaction, dishId, userId),
      transaction.getDocument(contributionPath(dishId, userId)),
    ]);
    const next = candidate(winner, dishId);
    const previous = previousContribution(contribution, state);
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    state = {...state, sums: replaceBiteScoreReviewContribution(state.sums, previous, next)};
    storeContribution(transaction, state, userId, next);
    publish(transaction, state, now);
  });
}

/** Call from dish-write maintenance as generations/parent associations change. */
export async function reconcileBiteScoreReviewAggregateDish(
  database: Database, dishIdValue: string, now: Date,
): Promise<void> {
  const dishId = id(dishIdValue);
  await database.runTransaction(async (transaction) => {
    const epoch = await runtime(transaction);
    if (epoch === null) return;
    const [document, stateDocument] = await Promise.all([
      transaction.getDocument(`bitescore_dishes/${dishId}`),
      transaction.getDocument(biteScoreReviewAggregateStatePath(dishId)),
    ]);
    const state = stateFrom(stateDocument, epoch);
    if (state === null) {
      // A newly imported, unrated merge target has no contribution state yet.
      // Its operation generation proves this is ordinary operation maintenance.
      if (document !== null && generation(document.data) > 0) {
        transaction.setDocument(biteScoreReviewAggregateStatePath(dishId),
          rebuild(newState(epoch, dishId, document.data, now), document.data, now));
      }
      return;
    }
    if (document === null) {
      transaction.setDocument(biteScoreReviewAggregateStatePath(dishId), {
        ...state, status: "retired", updatedAt: now,
      });
    } else if (state.aggregateWriteGeneration !== generation(document.data) ||
        state.restaurantId !== document.data.restaurantId) {
      transaction.setDocument(biteScoreReviewAggregateStatePath(dishId),
        rebuild(state, document.data, now));
    }
  });
}

/** One bounded rebase page after an existing merge/delete/proposal operation.
 * This is operation maintenance, never a backfill for pre-cutover fake data. */
export async function continueBiteScoreReviewAggregateRebuild(
  database: Database, dishIdValue: string, now: Date,
): Promise<boolean> {
  const dishId = id(dishIdValue);
  return database.runTransaction(async (transaction) => {
    const epoch = await runtime(transaction);
    if (epoch === null) return false;
    const [stateDocument, dishDocument] = await Promise.all([
      transaction.getDocument(biteScoreReviewAggregateStatePath(dishId)),
      transaction.getDocument(`bitescore_dishes/${dishId}`),
    ]);
    const state = stateFrom(stateDocument, epoch);
    if (state === null || state.status !== "rebuilding") return false;
    if (dishDocument === null) {
      transaction.setDocument(biteScoreReviewAggregateStatePath(dishId), {...state, status: "retired"});
      return false;
    }
    const dish = dishDocument.data;
    const lock = await locks(transaction, dishId, id(dish.restaurantId));
    if (lock.retired) {
      transaction.setDocument(biteScoreReviewAggregateStatePath(dishId), {...state, status: "retired"});
      return false;
    }
    if (lock.blocked) {
      // Rotate waiting operations behind other work; ten locked dishes must
      // not starve every unrelated pending aggregate indefinitely.
      transaction.setDocument(biteScoreReviewAggregateStatePath(dishId), {
        ...state, updatedAt: now,
      });
      return false;
    }
    if (state.aggregateWriteGeneration !== generation(dish) ||
        state.restaurantId !== dish.restaurantId) {
      transaction.setDocument(biteScoreReviewAggregateStatePath(dishId), rebuild(state, dish, now));
      return true;
    }
    if (state.phase === "cleanup") {
      const obsolete = await transaction.queryDocuments({
        collectionPath: `${biteScoreReviewAggregateStatePath(dishId)}/contributions`,
        where: [{field: "serial", operator: "<", value: state.serial}],
        limit: biteScoreReviewAggregateBatchSize,
      });
      for (const document of obsolete) transaction.deleteDocument(
        `${biteScoreReviewAggregateStatePath(dishId)}/contributions/${document.id}`,
      );
      if (obsolete.length < biteScoreReviewAggregateBatchSize) {
        publish(transaction, {...state, status: "ready", cursor: null}, now);
      }
      return true;
    }
    const page = await transaction.queryDocuments({
      collectionPath: "dish_reviews",
      where: [{field: "dishId", operator: "==", value: dishId}],
      orderBy: [{field: "__name__", direction: "asc"}],
      startAfter: state.cursor === null ? null : [state.cursor],
      limit: biteScoreReviewAggregateBatchSize,
    });
    const winners = new Map<string, Candidate>();
    for (const document of page) {
      const parsed = candidate(document, dishId);
      if (parsed === null) continue;
      const prior = winners.get(parsed.userId);
      winners.set(parsed.userId, prior === undefined ? parsed : fresher(prior, parsed));
    }
    const users = [...winners.keys()];
    const previous = await Promise.all(users.map((userId) =>
      transaction.getDocument(contributionPath(dishId, userId))));
    let sums = state.sums;
    for (let index = 0; index < users.length; index++) {
      const userId = users[index];
      const old = previousContribution(previous[index], state);
      const proposed = winners.get(userId)!;
      const winner = old === null ? proposed : fresher(old, proposed);
      sums = replaceBiteScoreReviewContribution(sums, old, winner);
      storeContribution(transaction, state, userId, winner);
    }
    transaction.setDocument(biteScoreReviewAggregateStatePath(dishId), {
      ...state, sums, updatedAt: now,
      cursor: page[page.length - 1]?.id ?? state.cursor,
      phase: page.length < biteScoreReviewAggregateBatchSize ? "cleanup" : "scan",
    });
    return true;
  });
}

/** Scheduled bounded continuation; no request walks an entire dish history. */
export async function continueBiteScoreReviewAggregates(
  database: Database, now: Date,
): Promise<number> {
  const pending = await database.runTransaction(async (transaction) => {
    if (await runtime(transaction) === null) return [];
    return transaction.queryDocuments({
      collectionPath: biteScoreReviewAggregateCollection,
      where: [{field: "status", operator: "==", value: "rebuilding"}],
      orderBy: [{field: "updatedAt", direction: "asc"}], limit: 10,
    });
  });
  for (const document of pending) {
    await continueBiteScoreReviewAggregateRebuild(database, id(document.data.dishId), now);
  }
  // Deleted/merged source dishes no longer need durable contribution state.
  // Delete it in the same fixed-size maintenance pattern, never a recursive scan.
  const retired = await database.runTransaction(async (transaction) => {
    if (await runtime(transaction) === null) return [];
    return transaction.queryDocuments({
      collectionPath: biteScoreReviewAggregateCollection,
      where: [{field: "status", operator: "==", value: "retired"}],
      orderBy: [{field: "updatedAt", direction: "asc"}], limit: 10,
    });
  });
  for (const document of retired) {
    await database.runTransaction(async (transaction) => {
      const epoch = await runtime(transaction);
      if (epoch === null) return;
      const path = biteScoreReviewAggregateStatePath(id(document.data.dishId));
      const state = stateFrom(await transaction.getDocument(path), epoch);
      if (state?.status !== "retired") return;
      const page = await transaction.queryDocuments({
        collectionPath: `${path}/contributions`, limit: biteScoreReviewAggregateBatchSize,
      });
      for (const contribution of page) transaction.deleteDocument(`${path}/contributions/${contribution.id}`);
      if (page.length < biteScoreReviewAggregateBatchSize) transaction.deleteDocument(path);
      else transaction.setDocument(path, {...state, updatedAt: now});
    });
  }
  return pending.length;
}

export type BiteScoreReviewSaveRequest = Readonly<{
  schemaVersion: 1;
  expectedUserId: string;
  dishId: string;
  restaurantId: string;
  headline: string;
  notes: string;
  overallImpression: number;
  tastinessScore: number;
  qualityScore: number;
  valueScore: number;
}>;

function parseSave(value: unknown): BiteScoreReviewSaveRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-argument", "Review request is invalid.");
  }
  const v = value as Record<string, unknown>;
  const keys = ["schemaVersion", "expectedUserId", "dishId", "restaurantId", "headline", "notes",
    "overallImpression", "tastinessScore", "qualityScore", "valueScore"].sort();
  if (JSON.stringify(Object.keys(v).sort()) !== JSON.stringify(keys) || v.schemaVersion !== 1) {
    fail("invalid-argument", "Review request is invalid.");
  }
  id(v.expectedUserId); id(v.dishId); id(v.restaurantId);
  for (const key of ["overallImpression", "tastinessScore", "qualityScore", "valueScore"]) {
    if (typeof v[key] !== "number" || !Number.isFinite(v[key]) || v[key] < 1 || v[key] > 10) {
      fail("invalid-argument", "Review scores must be between 1 and 10.");
    }
  }
  if (typeof v.headline !== "string" || typeof v.notes !== "string" ||
      Buffer.byteLength(JSON.stringify(v), "utf8") > 200_000) {
    fail("invalid-argument", "Review text is invalid or oversized.");
  }
  return v as BiteScoreReviewSaveRequest;
}

export function computeTrustedBiteScore(value: Pick<BiteScoreReviewSaveRequest,
  "overallImpression" | "tastinessScore" | "qualityScore" | "valueScore">): number {
  return Math.min(100, Math.max(1, (
    value.overallImpression * 0.5 + value.tastinessScore * 0.2 +
    value.qualityScore * 0.2 + value.valueScore * 0.1
  ) / (0.5 + 0.2 + 0.2 + 0.1) * 10));
}

/** Trusted ordinary create/edit, contribution replacement and aggregate are
 * atomic. Triggers subsequently observe exactly the same accounted winner. */
export async function saveCustomerBiteScoreReview(
  database: Database,
  actor: {uid: string; emailVerified: boolean},
  request: unknown,
  now: Date,
): Promise<Readonly<Record<string, unknown>>> {
  const userId = id(actor.uid);
  if (!actor.emailVerified) fail("permission-denied", "Verify your email before reviewing.");
  const input = parseSave(request);
  if (input.expectedUserId !== userId) fail("permission-denied", "Your account changed. Please try again.");
  return database.runTransaction(async (transaction) => {
    const epoch = await runtime(transaction);
    if (epoch === null) fail("failed-precondition", "Trusted BiteScore reviews are not enabled.");
    const [dishDocument, restaurant, stateDocument, aggregate, milestoneLock] = await Promise.all([
      transaction.getDocument(`bitescore_dishes/${input.dishId}`),
      transaction.getDocument(`bitescore_restaurants/${input.restaurantId}`),
      transaction.getDocument(biteScoreReviewAggregateStatePath(input.dishId)),
      transaction.getDocument(`dish_rating_aggregates/${input.dishId}`),
      transaction.getDocument(reviewMilestoneReconciliationLockPath(userId)),
    ]);
    const dish = dishDocument?.data;
    if (dish === undefined || dish.id !== input.dishId ||
        dish.restaurantId !== input.restaurantId || dish.isActive === false ||
        (dish.mergedIntoDishId !== undefined && dish.mergedIntoDishId !== null && dish.mergedIntoDishId !== "") ||
        restaurant === null || restaurant.data.isActive === false || restaurant.data.active === false) {
      fail("failed-precondition", "This dish is unavailable.");
    }
    const lock = await locks(transaction, input.dishId, input.restaurantId);
    if (lock.blocked || milestoneLock?.data.state === "active") {
      fail("unavailable", "This review is temporarily locked. Try again shortly.");
    }
    let state = stateFrom(stateDocument, epoch);
    if (state === null && (aggregate?.data.ratingCount ?? 0) !== 0) {
      fail("failed-precondition", "Initialize trusted accounting with new post-wipe content.");
    }
    state ??= newState(epoch, input.dishId, dish, now);
    if (state.status !== "ready" || state.aggregateWriteGeneration !== generation(dish) ||
        state.restaurantId !== input.restaurantId) {
      fail("unavailable", "Review scores are being reconciled. Try again shortly.");
    }
    const [existing, contribution] = await Promise.all([
      latest(transaction, input.dishId, userId),
      transaction.getDocument(contributionPath(input.dishId, userId)),
    ]);
    const reviewId = existing?.id ?? customerBiteScoreReviewDocumentId(input.dishId, userId);
    const createdAt = existing?.data.createdAt ?? now;
    const priorCandidate = candidate(existing, input.dishId);
    const updatedAt = new Date(Math.max(now.getTime(), priorCandidate === null ? 0 :
      priorCandidate.freshnessSeconds * 1000 + Math.ceil(priorCandidate.freshnessNanoseconds / 1e6)));
    const review = {
      id: reviewId, dishId: input.dishId, restaurantId: input.restaurantId,
      userId, headline: input.headline.trim() || null, notes: input.notes.trim() || null,
      overallImpression: input.overallImpression, tastinessScore: input.tastinessScore,
      qualityScore: input.qualityScore, valueScore: input.valueScore,
      overallBiteScore: computeTrustedBiteScore(input), createdAt, updatedAt,
    };
    const next = candidate({id: reviewId, data: review, createTime: now}, input.dishId)!;
    const previous = previousContribution(contribution, state);
    const nextState = {...state,
      sums: replaceBiteScoreReviewContribution(state.sums, previous, next)};
    transaction.setDocument(`dish_reviews/${reviewId}`, {
      ...review, ...reviewOrderFields(reviewId),
    }, {merge: true});
    storeContribution(transaction, state, userId, next);
    publish(transaction, nextState, now);
    const created = createdAt instanceof Date ? createdAt :
      (createdAt as {toDate?: () => Date})?.toDate?.();
    const {createdAt: _createdAt, updatedAt: _updatedAt, ...publicReview} = review;
    return {
      schemaVersion: 1,
      review: {...publicReview, createdAtMillis: created?.getTime() ?? now.getTime(),
        updatedAtMillis: updatedAt.getTime()},
    };
  });
}
