import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import {
  dishProposalGroupCollection,
  dishProposalJobPath,
  dishProposalSupporterCollection,
  type DishProposalGroupDocument,
  type DishProposalJobDocument,
} from "./dish_proposal_private_contract.js";
import {
  parseDishProposalGroupDocument,
} from "./dish_proposal_private_maintenance.js";
import {
  parseDishProposalJobDocument,
} from "./dish_proposal_resolution_jobs.js";
import type {
  DishProposalStoredDocument,
} from "./dish_proposal_private_store.js";
import { OpaqueCursorCodec, type CursorSortValue } from "./opaque_cursor.js";
import {
  pageProtocolVersion,
  parsePagedRequest,
  type PagedRequest,
} from "./pagination_protocol.js";
import { createQueryFingerprint } from "./query_fingerprint.js";
import type {
  RatingAdminDocument,
  RatingAdminPagingDatabase,
} from "./rating_admin_paging.js";

export const ratingAdminDishSuggestionsPageSize = 25;
export const ratingAdminDishSuggestionsEntityKind = "dishSuggestions" as const;

export type RatingAdminDishSuggestionResolutionState =
  | "idle"
  | "applying"
  | "rejecting"
  | "retryable"
  | "manual_review_required"
  | "complete";

export type RatingAdminDishSummary = Readonly<{
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  isActive: boolean;
  mergedIntoDishId: string | null;
}>;

export type RatingAdminRestaurantSummary = Readonly<{
  id: string;
  name: string;
}>;

export type RatingAdminDishSuggestionQueueItem = Readonly<{
  groupId: string;
  fingerprint: string;
  membershipGeneration: number;
  resolutionSequence: number;
  proposalType: "rename" | "merge";
  restaurantId: string;
  sourceDishId: string;
  mergeTargetDishId: string | null;
  proposedDisplayName: string | null;
  hasPendingMembers: boolean;
  oldestTrustedProposalTimeMillis: number | null;
  dueAtMillis: number | null;
  dueNow: boolean;
  enoughSupporters: boolean;
  autoEligible: boolean;
  resolutionState: RatingAdminDishSuggestionResolutionState;
  supporterCount: number;
  sourceDish: RatingAdminDishSummary | null;
  mergeTargetDish: RatingAdminDishSummary | null;
  restaurant: RatingAdminRestaurantSummary | null;
}>;

export type RatingAdminDishSuggestionsHandlerContext = Readonly<{
  adminUid: string;
  cursorSecret: unknown;
  database: RatingAdminPagingDatabase;
  now?: () => number;
  nonceSource?: (size: number) => Uint8Array;
}>;

const cursorSource = "ratingAdminDishSuggestions";
const cursorSearchMode = ratingAdminDishSuggestionsEntityKind;
const clientRequestIdPattern =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function callableError(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireExactCriteria(
  value: Readonly<Record<string, unknown>>,
): void {
  if (
    Object.keys(value).length !== 1 ||
    !hasOwn(value, "entityKind") ||
    value.entityKind !== ratingAdminDishSuggestionsEntityKind
  ) {
    callableError("The Dish Suggestions page criteria are invalid.");
  }
}

function requireDocumentSegment(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    Buffer.byteLength(value, "utf8") > 1_500 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    callableError("The Dish Suggestions page identity is invalid.");
  }
  return value;
}

function decodeCursorKey(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new HttpsError(
      "failed-precondition",
      "Rating Admin pagination is not configured.",
    );
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    throw new HttpsError(
      "failed-precondition",
      "Rating Admin pagination is not configured.",
    );
  }
  return bytes;
}

function callerBinding(adminUid: string): string {
  return createHash("sha256")
    .update(JSON.stringify(["ratingAdmin", requireDocumentSegment(adminUid)]))
    .digest("hex");
}

function parseRequest(
  rawRequest: unknown,
): PagedRequest {
  let request: PagedRequest;
  try {
    request = parsePagedRequest(
      rawRequest,
      ratingAdminDishSuggestionsPageSize,
    );
  } catch {
    callableError("The Dish Suggestions page request is invalid.");
  }
  if (
    request.pageSize !== ratingAdminDishSuggestionsPageSize ||
    !clientRequestIdPattern.test(request.clientRequestId)
  ) {
    callableError("The Dish Suggestions page request is invalid.");
  }
  requireExactCriteria(request.criteria);
  return request;
}

function toStoredDocument(
  document: RatingAdminDocument,
): DishProposalStoredDocument {
  return {
    id: document.id,
    data: document.data,
    createTime: null,
  };
}

function mapById(
  documents: readonly RatingAdminDocument[],
): ReadonlyMap<string, RatingAdminDocument> {
  return new Map(documents.map((document) => [document.id, document]));
}

function optionalDocumentSegment(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    Buffer.byteLength(value, "utf8") > 1_500 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

function boundedString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximumLength
    ? trimmed
    : null;
}

function dishSummary(
  document: RatingAdminDocument | undefined,
): RatingAdminDishSummary | null {
  if (document === undefined) {
    return null;
  }
  const storedId = optionalDocumentSegment(document.data.id);
  const restaurantId = optionalDocumentSegment(document.data.restaurantId);
  const restaurantName = boundedString(document.data.restaurantName, 200);
  const name = boundedString(document.data.name, 200);
  const mergedIntoDishId = optionalDocumentSegment(
    document.data.mergedIntoDishId,
  );
  if (
    storedId !== document.id ||
    restaurantId === null ||
    restaurantId === undefined ||
    restaurantName === null ||
    name === null ||
    mergedIntoDishId === undefined ||
    (document.data.isActive !== undefined &&
      typeof document.data.isActive !== "boolean")
  ) {
    return null;
  }
  return Object.freeze({
    id: document.id,
    restaurantId,
    restaurantName,
    name,
    isActive: document.data.isActive !== false,
    mergedIntoDishId,
  });
}

function restaurantSummary(
  document: RatingAdminDocument | undefined,
): RatingAdminRestaurantSummary | null {
  if (document === undefined) {
    return null;
  }
  const name = boundedString(document.data.name, 200) ??
    boundedString(document.data.restaurantName, 200);
  return name === null
    ? null
    : Object.freeze({id: document.id, name});
}

function resolutionState(
  group: DishProposalGroupDocument,
  job: DishProposalJobDocument | null,
): RatingAdminDishSuggestionResolutionState {
  if (group.activeJobId === null) {
    if (!group.hasPendingMembers) {
      throw new Error("A terminal proposal group remained query-visible.");
    }
    if (job !== null) {
      throw new Error("An idle proposal group unexpectedly resolved a job.");
    }
    return "idle";
  }
  if (
    job === null ||
    job.jobId !== group.activeJobId ||
    job.groupId !== group.groupId ||
    job.resolutionType !== group.activeResolutionType ||
    job.proposalType !== group.proposalType ||
    job.restaurantId !== group.restaurantId ||
    job.sourceDishId !== group.sourceDishId ||
    job.mergeTargetDishId !== group.mergeTargetDishId ||
    job.normalizedProposedName !== group.normalizedProposedName ||
    job.resolutionSequence !== group.resolutionSequence ||
    job.cycleCutoffGeneration !== group.cycleCutoffGeneration ||
    job.cycleCutoffAt.getTime() !== group.cycleCutoffAt?.getTime()
  ) {
    throw new Error("An active proposal group has invalid job state.");
  }
  switch (job.status) {
    case "active":
      return job.resolutionType === "apply" ? "applying" : "rejecting";
    case "retryable":
      return "retryable";
    case "manual_review_required":
      return "manual_review_required";
    case "complete":
      return "complete";
  }
}

function cursorMillis(group: DishProposalGroupDocument): number | null {
  return group.oldestTrustedServerCreateTime?.getTime() ?? null;
}

function parseCursorTuple(value: readonly CursorSortValue[]): Readonly<{
  oldestMillis: number | null;
  groupId: string;
  pageNumber: number;
}> {
  if (value.length !== 3) {
    callableError("The Dish Suggestions page cursor is invalid or expired.");
  }
  const oldestMillis = value[0];
  const pageNumber = value[2];
  if (
    (oldestMillis !== null &&
      (typeof oldestMillis !== "number" ||
        !Number.isSafeInteger(oldestMillis) ||
        oldestMillis < 0)) ||
    typeof value[1] !== "string" ||
    typeof pageNumber !== "number" ||
    !Number.isSafeInteger(pageNumber) ||
    pageNumber < 1
  ) {
    callableError("The Dish Suggestions page cursor is invalid or expired.");
  }
  return {
    oldestMillis,
    groupId: requireDocumentSegment(value[1]),
    pageNumber,
  };
}

async function enrichGroups(
  groups: readonly DishProposalGroupDocument[],
  database: RatingAdminPagingDatabase,
  nowMs: number,
): Promise<readonly RatingAdminDishSuggestionQueueItem[]> {
  const activeJobIds = groups
    .map((group) => group.activeJobId)
    .filter((jobId): jobId is string =>
      jobId !== null && optionalDocumentSegment(jobId) === jobId
    );
  const sourceDishIds = groups
    .map((group) => group.sourceDishId)
    .filter((dishId) => optionalDocumentSegment(dishId) === dishId);
  const mergeTargetDishIds = groups
    .map((group) => group.mergeTargetDishId)
    .filter((dishId): dishId is string =>
      dishId !== null && optionalDocumentSegment(dishId) === dishId
    );
  const restaurantIds = groups
    .map((group) => group.restaurantId)
    .filter((restaurantId) =>
      optionalDocumentSegment(restaurantId) === restaurantId
    );
  const unique = (values: readonly string[]): readonly string[] =>
    [...new Set(values)];
  const [jobs, dishes, restaurants, supporterCounts] = await Promise.all([
    database.getDocuments(unique(activeJobIds).map(dishProposalJobPath)),
    database.getDocuments(
      unique([...sourceDishIds, ...mergeTargetDishIds])
        .map((dishId) => `bitescore_dishes/${dishId}`),
    ),
    database.getDocuments(
      unique(restaurantIds)
        .map((restaurantId) => `bitescore_restaurants/${restaurantId}`),
    ),
    Promise.all(groups.map((group) => database.countDocuments({
      collectionPath: dishProposalSupporterCollection,
      filters: [{
        field: "groupId",
        operation: "==",
        value: group.groupId,
      }],
    }))),
  ]);
  const jobsById = mapById(jobs);
  const dishesById = mapById(dishes);
  const restaurantsById = mapById(restaurants);
  return Object.freeze(groups.map((group, index) => {
    const jobDocument = group.activeJobId === null
      ? undefined
      : jobsById.get(group.activeJobId);
    const job = jobDocument === undefined
      ? null
      : parseDishProposalJobDocument(toStoredDocument(jobDocument));
    return Object.freeze({
      groupId: group.groupId,
      fingerprint: group.fingerprint,
      membershipGeneration: group.lastMembershipGeneration,
      resolutionSequence: group.resolutionSequence,
      proposalType: group.proposalType,
      restaurantId: group.restaurantId,
      sourceDishId: group.sourceDishId,
      mergeTargetDishId: group.mergeTargetDishId,
      proposedDisplayName: (() => {
        if (
          group.proposalType !== "rename" ||
          group.normalizedProposedName === null ||
          group.normalizedProposedName.trim().length === 0
        ) {
          return null;
        }
        return group.normalizedProposedName;
      })(),
      hasPendingMembers: group.hasPendingMembers,
      oldestTrustedProposalTimeMillis:
        group.oldestTrustedServerCreateTime?.getTime() ?? null,
      dueAtMillis: group.dueAt?.getTime() ?? null,
      dueNow: group.dueAt !== null && group.dueAt.getTime() <= nowMs,
      enoughSupporters: group.enoughSupporters,
      autoEligible: group.autoEligible,
      resolutionState: resolutionState(group, job),
      supporterCount: supporterCounts[index],
      sourceDish: dishSummary(dishesById.get(group.sourceDishId)),
      mergeTargetDish: group.mergeTargetDishId === null
        ? null
        : dishSummary(dishesById.get(group.mergeTargetDishId)),
      restaurant: restaurantSummary(restaurantsById.get(group.restaurantId)),
    });
  }));
}

export async function listRatingAdminDishSuggestionsPageHandler(
  rawRequest: unknown,
  context: RatingAdminDishSuggestionsHandlerContext,
): Promise<Readonly<Record<string, unknown>>> {
  const request = parseRequest(rawRequest);
  const nowMs = context.now?.() ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("Dish Suggestions paging clock is invalid.");
  }
  const queryFingerprint = createQueryFingerprint({
    entityKind: ratingAdminDishSuggestionsEntityKind,
  });
  const codec = new OpaqueCursorCodec({
    key: decodeCursorKey(context.cursorSecret),
    clock: context.now,
    nonceSource: context.nonceSource,
  });
  const binding = callerBinding(context.adminUid);
  let cursor: ReturnType<typeof parseCursorTuple> | null = null;
  let currentPageNumber = 1;
  if (request.cursor !== undefined) {
    try {
      const decoded = codec.decode(request.cursor, {
        queryFingerprint,
        source: cursorSource,
        searchMode: cursorSearchMode,
        pageSize: ratingAdminDishSuggestionsPageSize,
        callerBinding: binding,
        purposes: [request.direction === "backward" ? "backward" : "forward"],
      });
      cursor = parseCursorTuple(decoded.sortTuple);
      currentPageNumber = cursor.pageNumber;
    } catch {
      callableError("The Dish Suggestions page cursor is invalid or expired.");
    }
  }

  const totalValue = await context.database.countDocuments({
    collectionPath: dishProposalGroupCollection,
    filters: [{
      field: "resolutionIdentitiesValid",
      operation: "==",
      value: true,
    }],
  });
  if (!Number.isSafeInteger(totalValue) || totalValue < 0) {
    throw new Error("Dish Suggestions group count is invalid.");
  }
  const totalPages = Math.max(
    1,
    Math.ceil(totalValue / ratingAdminDishSuggestionsPageSize),
  );
  let serveLastPage = request.direction === "last";
  if (!serveLastPage && cursor !== null && currentPageNumber > totalPages) {
    throw new HttpsError(
      "out-of-range",
      "The Dish Suggestions page is no longer available.",
    );
  }
  if (serveLastPage) {
    currentPageNumber = totalPages;
    cursor = null;
  }
  const exactLastPageSize = serveLastPage
    ? Math.max(
        1,
        totalValue % ratingAdminDishSuggestionsPageSize ||
          ratingAdminDishSuggestionsPageSize,
      )
    : null;
  const cursorValues = cursor === null
    ? undefined
    : [
        cursor.oldestMillis === null ? null : new Date(cursor.oldestMillis),
        cursor.groupId,
      ];
  const rawDocuments = await context.database.queryDocuments({
    collectionPath: dishProposalGroupCollection,
    filters: [{
      field: "resolutionIdentitiesValid",
      operation: "==",
      value: true,
    }],
    orders: [
      {field: "oldestTrustedServerCreateTime", direction: "asc"},
      {field: "__name__", direction: "asc"},
    ],
    ...(cursorValues === undefined
      ? {}
      : {
          cursor: {
            kind: request.direction === "backward"
              ? "endBefore" as const
              : "startAfter" as const,
            values: cursorValues,
          },
        }),
    limit: exactLastPageSize ?? ratingAdminDishSuggestionsPageSize + 1,
    ...(request.direction === "backward" || serveLastPage
      ? {limitToLast: true}
      : {}),
  });
  const selectedDocuments = request.direction === "backward" ||
      serveLastPage
    ? rawDocuments.slice(
        Math.max(0, rawDocuments.length - ratingAdminDishSuggestionsPageSize),
      )
    : rawDocuments.slice(0, ratingAdminDishSuggestionsPageSize);
  if (
    cursor !== null &&
    currentPageNumber > 1 &&
    selectedDocuments.length === 0
  ) {
    throw new HttpsError(
      "out-of-range",
      "The Dish Suggestions page is no longer available.",
    );
  }
  const groups = selectedDocuments.map((document) => {
    const group = parseDishProposalGroupDocument(toStoredDocument(document));
    if (group === null) {
      throw new Error("Stored private dish-proposal group is missing.");
    }
    if (
      optionalDocumentSegment(group.restaurantId) !== group.restaurantId ||
      optionalDocumentSegment(group.sourceDishId) !== group.sourceDishId ||
      (group.mergeTargetDishId !== null &&
        optionalDocumentSegment(group.mergeTargetDishId) !==
          group.mergeTargetDishId) ||
      (group.activeJobId !== null &&
        optionalDocumentSegment(group.activeJobId) !== group.activeJobId)
    ) {
      throw new Error("Stored private dish-proposal group identity is unsafe.");
    }
    return group;
  });
  const first = groups[0];
  const last = groups[groups.length - 1];
  const hasNext = last !== undefined &&
    currentPageNumber < totalPages &&
    !serveLastPage;
  const hasPrevious = first !== undefined && currentPageNumber > 1;
  const items = await enrichGroups(groups, context.database, nowMs);
  const nextCursor = hasNext && last !== undefined
    ? codec.encode({
        queryFingerprint,
        source: cursorSource,
        searchMode: cursorSearchMode,
        pageSize: ratingAdminDishSuggestionsPageSize,
        purpose: "forward",
        sortTuple: [cursorMillis(last), last.groupId, currentPageNumber + 1],
        callerBinding: binding,
      })
    : undefined;
  const previousCursor = hasPrevious && first !== undefined
    ? codec.encode({
        queryFingerprint,
        source: cursorSource,
        searchMode: cursorSearchMode,
        pageSize: ratingAdminDishSuggestionsPageSize,
        purpose: "backward",
        sortTuple: [cursorMillis(first), first.groupId, currentPageNumber - 1],
        callerBinding: binding,
      })
    : undefined;

  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    items,
    pageSize: ratingAdminDishSuggestionsPageSize,
    hasNext,
    hasPrevious,
    ...(nextCursor === undefined ? {} : {nextCursor}),
    ...(previousCursor === undefined ? {} : {previousCursor}),
    currentPageNumber,
    total: {state: "exact" as const, value: totalValue},
    queryFingerprint,
    snapshotTimestampMs: nowMs,
    capabilities: {
      first: currentPageNumber > 1,
      previous: hasPrevious,
      numberedVisitedPages: true,
      next: hasNext,
      last: currentPageNumber < totalPages,
    },
  });
}
