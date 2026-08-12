import {createHash} from "node:crypto";
import type {Firestore} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

import {OpaqueCursorCodec, type CursorSortValue} from "./opaque_cursor.js";
import {
  pageProtocolVersion,
  parsePagedRequest,
  type PagedRequest,
} from "./pagination_protocol.js";
import {createQueryFingerprint} from "./query_fingerprint.js";
import {
  createFirestoreRatingAdminPagingDatabase,
  decodeRatingAdminCursorKey,
  type RatingAdminDocument,
  type RatingAdminPagingDatabase,
} from "./rating_admin_paging.js";
import {
  ratingDestructiveProgressCategoryForJob,
} from "./rating_destructive_callable_contract.js";
import {
  parseRatingDestructiveJobDocument,
  ratingDestructiveJobCollection,
  type RatingDestructiveJobDocument,
  type RatingDestructiveJobPhase,
} from "./rating_destructive_job_contract.js";

export const ratingDestructiveAdminPageSize = 25;
export const ratingDestructiveAdminCursorSecretName =
  "SEARCH_PAGINATION_CURSOR_KEY" as const;

const pagingSource = "ratingAdminDestructiveOperations";
const pagingMode = "all";
const pagingCriteria = Object.freeze({scope: "all" as const});
const pagingFingerprintCriteria = Object.freeze({
  scope: pagingCriteria.scope,
  collectionPath: ratingDestructiveJobCollection,
  order: Object.freeze([
    Object.freeze(["updatedAt", "desc"]),
    Object.freeze(["__name__", "desc"]),
  ]),
});

export const ratingDestructiveAdminQueryFingerprint =
  createQueryFingerprint(pagingFingerprintCriteria);

export type RatingDestructiveSafeCategory =
  | "starting"
  | "moving_data"
  | "rebuilding"
  | "cleaning_up"
  | "finalizing"
  | "waiting_retry"
  | "needs_attention"
  | "complete";

const phaseCategories = Object.freeze({
  claimed: "starting",
  move_dishes: "moving_data",
  move_reviews: "moving_data",
  rebuild_moved_dish_aggregates: "rebuilding",
  move_claim_requests: "moving_data",
  move_dish_proposals: "moving_data",
  move_restaurant_reports: "moving_data",
  move_dish_reports: "moving_data",
  move_review_reports: "moving_data",
  move_review_feedback_votes: "moving_data",
  resolve_duplicate_reports: "cleaning_up",
  finalize_restaurants: "finalizing",
  process_dishes: "cleaning_up",
  process_orphan_reviews: "cleaning_up",
  delete_restaurant_reports: "cleaning_up",
  delete_duplicate_reports: "cleaning_up",
  reconcile_milestone_users: "cleaning_up",
  finalize_restaurant: "finalizing",
  validate: "starting",
  rebuild_target_aggregate: "rebuilding",
  fold_target_aggregate: "rebuilding",
  rebuild_source_aggregate: "rebuilding",
  fold_source_aggregate: "rebuilding",
  finalize_dishes: "finalizing",
  process_reviews: "cleaning_up",
  reverse_contribution_points: "cleaning_up",
  delete_dish_reports: "cleaning_up",
  delete_aggregate: "cleaning_up",
  delete_dish: "cleaning_up",
  complete: "complete",
} as const satisfies Readonly<
  Record<RatingDestructiveJobPhase, RatingDestructiveSafeCategory>
>);

export function ratingDestructivePhaseCategory(
  phase: RatingDestructiveJobPhase,
): RatingDestructiveSafeCategory {
  return phaseCategories[phase];
}

export type RatingDestructiveStatusPagingDatabase = Pick<
  RatingAdminPagingDatabase,
  "queryDocuments" | "countDocuments" | "getDocuments"
>;

export function createFirestoreRatingDestructiveStatusPagingDatabase(
  firestore: Firestore,
): RatingDestructiveStatusPagingDatabase {
  return createFirestoreRatingAdminPagingDatabase(firestore);
}

export type RatingDestructiveStatusPagingContext = Readonly<{
  adminUid: string;
  cursorSecret: unknown;
  database: RatingDestructiveStatusPagingDatabase;
  now?: () => number;
  nonceSource?: (size: number) => Uint8Array;
}>;

type ParsedContext = Readonly<{
  request: PagedRequest;
  codec: OpaqueCursorCodec;
  callerBinding: string;
  nowMs: number;
}>;

type DecodedAnchor = Readonly<{
  updatedAtMs: number;
  operationId: string;
  targetPageNumber: number;
}>;

type EntityNames = ReadonlyMap<string, string | null>;

function callableError(
  code: "invalid-argument" | "failed-precondition" | "permission-denied",
  message: string,
): never {
  throw new HttpsError(code, message);
}

function isExactDocumentId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 1_500 &&
    value.trim() === value &&
    !value.includes("/");
}

function adminCallerBinding(uid: string): string {
  return createHash("sha256")
    .update(JSON.stringify(["ratingAdminDestructiveOperations", uid]), "utf8")
    .digest("hex");
}

function hasExactCriteria(value: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(value).length === 1 && value.scope === pagingCriteria.scope;
}

function parseContext(
  rawRequest: unknown,
  context: RatingDestructiveStatusPagingContext,
): ParsedContext {
  let request: PagedRequest;
  try {
    request = parsePagedRequest(rawRequest, ratingDestructiveAdminPageSize);
  } catch {
    callableError("invalid-argument", "The operations page request is invalid.");
  }
  if (
    request.pageSize !== ratingDestructiveAdminPageSize ||
    request.requestExactCount !== true ||
    !hasExactCriteria(request.criteria)
  ) {
    callableError("invalid-argument", "The operations page request is invalid.");
  }
  if (!isExactDocumentId(context.adminUid)) {
    callableError("permission-denied", "Admin access is required.");
  }
  const nowMs = context.now?.() ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    callableError("failed-precondition", "Operations paging is unavailable.");
  }
  return Object.freeze({
    request,
    codec: new OpaqueCursorCodec({
      key: decodeRatingAdminCursorKey(context.cursorSecret),
      clock: () => nowMs,
      nonceSource: context.nonceSource,
    }),
    callerBinding: adminCallerBinding(context.adminUid),
    nowMs,
  });
}

function parseAnchor(tuple: readonly CursorSortValue[]): DecodedAnchor {
  if (
    tuple.length !== 3 ||
    typeof tuple[0] !== "number" ||
    !Number.isSafeInteger(tuple[0]) ||
    tuple[0] < 0 ||
    !isExactDocumentId(tuple[1]) ||
    typeof tuple[2] !== "number" ||
    !Number.isSafeInteger(tuple[2]) ||
    tuple[2] < 1
  ) {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }
  return Object.freeze({
    updatedAtMs: tuple[0],
    operationId: tuple[1],
    targetPageNumber: tuple[2],
  });
}

function decodeAnchor(parsed: ParsedContext): DecodedAnchor | null {
  const cursor = parsed.request.cursor;
  if (cursor === undefined) {
    return null;
  }
  try {
    const decoded = parsed.codec.decode(cursor, {
      queryFingerprint: ratingDestructiveAdminQueryFingerprint,
      source: pagingSource,
      searchMode: pagingMode,
      pageSize: ratingDestructiveAdminPageSize,
      callerBinding: parsed.callerBinding,
      purposes: [parsed.request.direction === "backward"
        ? "backward"
        : "forward"],
    });
    return parseAnchor(decoded.sortTuple);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    return callableError(
      "invalid-argument",
      "The page cursor is invalid or expired.",
    );
  }
}

function parseStrictJob(document: RatingAdminDocument): RatingDestructiveJobDocument {
  try {
    const job = parseRatingDestructiveJobDocument({
      id: document.id,
      data: document.data,
    });
    if (job === null || job.jobId !== document.id) {
      callableError("failed-precondition", "Stored operation state is invalid.");
    }
    return job;
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    return callableError(
      "failed-precondition",
      "Stored operation state is invalid.",
    );
  }
}

function nameFromDocument(document: RatingAdminDocument): string | null {
  const value = document.data.name ?? document.data.restaurantName;
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized.length >= 1 && Array.from(normalized).length <= 100
    ? normalized
    : null;
}

async function namesForRole(
  database: RatingDestructiveStatusPagingDatabase,
  collectionPath: "bitescore_restaurants" | "bitescore_dishes",
  ids: readonly (string | null)[],
): Promise<EntityNames> {
  const unique = [...new Set(ids.filter(
    (id): id is string => id !== null && isExactDocumentId(id),
  ))];
  if (unique.length > ratingDestructiveAdminPageSize) {
    callableError("failed-precondition", "Operations enrichment is unbounded.");
  }
  if (unique.length === 0) {
    return new Map();
  }
  const allowed = new Set(unique);
  const documents = await database.getDocuments(
    unique.map((id) => `${collectionPath}/${id}`),
  );
  const names = new Map<string, string | null>();
  for (const document of documents) {
    if (allowed.has(document.id) && isExactDocumentId(document.id)) {
      names.set(document.id, nameFromDocument(document));
    }
  }
  return names;
}

function timestampMs(value: Date): number {
  const result = value.getTime();
  if (!Number.isSafeInteger(result) || result < 0) {
    callableError("failed-precondition", "Stored operation state is invalid.");
  }
  return result;
}

function encodeCursor(
  parsed: ParsedContext,
  job: RatingDestructiveJobDocument,
  purpose: "forward" | "backward",
  targetPageNumber: number,
): string {
  return parsed.codec.encode({
    queryFingerprint: ratingDestructiveAdminQueryFingerprint,
    source: pagingSource,
    searchMode: pagingMode,
    pageSize: ratingDestructiveAdminPageSize,
    purpose,
    sortTuple: [timestampMs(job.updatedAt), job.jobId, targetPageNumber],
    callerBinding: parsed.callerBinding,
  });
}

function projectJob(
  job: RatingDestructiveJobDocument,
  names: Readonly<{
    sourceRestaurants: EntityNames;
    targetRestaurants: EntityNames;
    sourceDishes: EntityNames;
    targetDishes: EntityNames;
  }>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    operationId: job.jobId,
    operation: job.operation,
    status: job.status,
    progressCategory: ratingDestructiveProgressCategoryForJob(job),
    phaseCategory: ratingDestructivePhaseCategory(job.phase),
    processedCount: job.processedCount,
    phaseProcessedCount: job.phaseProcessedCount,
    createdAtMs: timestampMs(job.createdAt),
    updatedAtMs: timestampMs(job.updatedAt),
    sourceRestaurantId: job.sourceRestaurantId,
    sourceRestaurantName: job.sourceRestaurantId === null
      ? null
      : names.sourceRestaurants.get(job.sourceRestaurantId) ?? null,
    targetRestaurantId: job.targetRestaurantId,
    targetRestaurantName: job.targetRestaurantId === null
      ? null
      : names.targetRestaurants.get(job.targetRestaurantId) ?? null,
    sourceDishId: job.sourceDishId,
    sourceDishName: job.sourceDishId === null
      ? null
      : names.sourceDishes.get(job.sourceDishId) ?? null,
    targetDishId: job.targetDishId,
    targetDishName: job.targetDishId === null
      ? null
      : names.targetDishes.get(job.targetDishId) ?? null,
    complete: job.status === "complete",
    retryable: job.status === "retryable",
    manualReviewRequired: job.status === "manual_review_required",
    messageCategory: "current_status",
  });
}

async function projectPage(
  jobs: readonly RatingDestructiveJobDocument[],
  database: RatingDestructiveStatusPagingDatabase,
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const [
    sourceRestaurants,
    targetRestaurants,
    sourceDishes,
    targetDishes,
  ] = await Promise.all([
    namesForRole(
      database,
      "bitescore_restaurants",
      jobs.map((job) => job.sourceRestaurantId),
    ),
    namesForRole(
      database,
      "bitescore_restaurants",
      jobs.map((job) => job.targetRestaurantId),
    ),
    namesForRole(
      database,
      "bitescore_dishes",
      jobs.map((job) => job.sourceDishId),
    ),
    namesForRole(
      database,
      "bitescore_dishes",
      jobs.map((job) => job.targetDishId),
    ),
  ]);
  const names = Object.freeze({
    sourceRestaurants,
    targetRestaurants,
    sourceDishes,
    targetDishes,
  });
  return Object.freeze(jobs.map((job) => projectJob(job, names)));
}

export async function listRatingAdminDestructiveOperationsPageHandler(
  rawRequest: unknown,
  context: RatingDestructiveStatusPagingContext,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseContext(rawRequest, context);
  const anchor = decodeAnchor(parsed);
  const totalValue = await context.database.countDocuments({
    collectionPath: ratingDestructiveJobCollection,
    filters: [],
  });
  if (!Number.isSafeInteger(totalValue) || totalValue < 0) {
    callableError("failed-precondition", "Operations paging is unavailable.");
  }
  const totalPages = Math.max(
    1,
    Math.ceil(totalValue / ratingDestructiveAdminPageSize),
  );
  const currentPageNumber = parsed.request.direction === "last"
    ? totalPages
    : anchor?.targetPageNumber ?? 1;
  if (
    currentPageNumber < 1 ||
    currentPageNumber > totalPages ||
    (parsed.request.direction === "forward" && currentPageNumber === 1) ||
    (parsed.request.direction === "backward" && currentPageNumber === totalPages)
  ) {
    callableError("invalid-argument", "The page cursor is invalid or expired.");
  }

  const exactLastPageSize = parsed.request.direction === "last" && totalValue > 0
    ? totalValue % ratingDestructiveAdminPageSize ||
      ratingDestructiveAdminPageSize
    : null;
  const limit = totalValue === 0
    ? 0
    : exactLastPageSize ??
      (parsed.request.direction === "backward"
        ? ratingDestructiveAdminPageSize
        : ratingDestructiveAdminPageSize + 1);
  const rawDocuments = limit === 0
    ? []
    : await context.database.queryDocuments({
        collectionPath: ratingDestructiveJobCollection,
        filters: [],
        orders: [
          {field: "updatedAt", direction: "desc"},
          {field: "__name__", direction: "desc"},
        ],
        ...(anchor === null
          ? {}
          : {
              cursor: {
                kind: parsed.request.direction === "backward"
                  ? "endBefore" as const
                  : "startAfter" as const,
                values: [
                  new Date(anchor.updatedAtMs),
                  anchor.operationId,
                ],
              },
            }),
        limit,
        ...(parsed.request.direction === "backward" ||
          parsed.request.direction === "last"
          ? {limitToLast: true}
          : {}),
      });
  if (rawDocuments.length > ratingDestructiveAdminPageSize + 1) {
    callableError("failed-precondition", "Operations paging is unbounded.");
  }
  const parsedJobs = rawDocuments.map(parseStrictJob);
  const selected = parsed.request.direction === "backward" ||
      parsed.request.direction === "last"
    ? parsedJobs.slice(-ratingDestructiveAdminPageSize)
    : parsedJobs.slice(0, ratingDestructiveAdminPageSize);
  const items = await projectPage(selected, context.database);
  const hasPrevious = currentPageNumber > 1;
  const hasNext = currentPageNumber < totalPages;
  const first = selected[0];
  const last = selected[selected.length - 1];
  const nextCursor = hasNext && last !== undefined
    ? encodeCursor(parsed, last, "forward", currentPageNumber + 1)
    : undefined;
  const previousCursor = hasPrevious && first !== undefined
    ? encodeCursor(parsed, first, "backward", currentPageNumber - 1)
    : undefined;

  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    items,
    pageSize: ratingDestructiveAdminPageSize,
    hasNext,
    hasPrevious,
    ...(nextCursor === undefined ? {} : {nextCursor}),
    ...(previousCursor === undefined ? {} : {previousCursor}),
    currentPageNumber,
    total: Object.freeze({state: "exact" as const, value: totalValue}),
    queryFingerprint: ratingDestructiveAdminQueryFingerprint,
    snapshotTimestampMs: parsed.nowMs,
    capabilities: Object.freeze({
      first: hasPrevious,
      previous: hasPrevious,
      numberedVisitedPages: true,
      next: hasNext,
      last: hasNext,
    }),
  });
}
