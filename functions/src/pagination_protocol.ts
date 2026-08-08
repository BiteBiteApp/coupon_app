import { createQueryFingerprint } from "./query_fingerprint.js";

export const pageProtocolVersion = "bitestar.page.v1" as const;
export const operationalQueueDefaultPageSize = 25;
export const adminDirectoryDefaultPageSize = 50;
export const customerDiscoveryDefaultPageSize = 25;
export const maximumPageSize = 100;

export const pageDirections = [
  "first",
  "forward",
  "backward",
  "last",
] as const;
export type PageDirection = (typeof pageDirections)[number];

export type PagedTotal =
  | Readonly<{ state: "exact"; value: number }>
  | Readonly<{ state: "unknown" }>;

export interface PageCapabilities {
  readonly first: boolean;
  readonly previous: boolean;
  readonly numberedVisitedPages: boolean;
  readonly next: boolean;
  readonly last: boolean;
}

export type PagePreparation = Readonly<{
  state: "preparing" | "ready" | "failed";
  completedUnits: number;
  totalUnits?: number;
  message?: string;
}>;

export interface PagedRequest {
  readonly protocolVersion: typeof pageProtocolVersion;
  readonly pageSize: number;
  readonly criteria: Readonly<Record<string, unknown>>;
  readonly cursor?: string;
  readonly direction: PageDirection;
  readonly requestExactCount: boolean;
  readonly clientRequestId: string;
}

export interface PagedResponse<T> {
  readonly protocolVersion: typeof pageProtocolVersion;
  readonly items: readonly T[];
  readonly pageSize: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly nextCursor?: string;
  readonly previousCursor?: string;
  readonly currentPageNumber?: number;
  readonly total?: PagedTotal;
  readonly queryFingerprint: string;
  readonly snapshotTimestampMs: number;
  readonly capabilities: Readonly<PageCapabilities>;
  readonly preparation?: PagePreparation;
}

export class PaginationProtocolError extends Error {
  readonly code = "pagination_protocol_error";

  constructor() {
    super("The page request or response is invalid.");
    this.name = "PaginationProtocolError";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new PaginationProtocolError();
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !hasOwn(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new PaginationProtocolError();
  }
}

function requireSafeInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new PaginationProtocolError();
  }
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new PaginationProtocolError();
  }
  return value;
}

function requireBoundedString(
  value: unknown,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new PaginationProtocolError();
  }
  return value;
}

function cloneCriteriaValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return requireSafeInteger(value, Number.MIN_SAFE_INTEGER);
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneCriteriaValue));
  }
  if (isPlainRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        value: cloneCriteriaValue(value[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return Object.freeze(copy);
  }
  throw new PaginationProtocolError();
}

export function requirePageSize(
  value: unknown,
  defaultPageSize: number,
): number {
  const defaultValue = requireSafeInteger(defaultPageSize, 1, maximumPageSize);
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return requireSafeInteger(value, 1, maximumPageSize);
}

export function parsePagedTotal(value: unknown): PagedTotal {
  const data = requireRecord(value);
  if (data.state === "exact") {
    requireExactKeys(data, ["state", "value"]);
    return Object.freeze({
      state: "exact" as const,
      value: requireSafeInteger(data.value, 0),
    });
  }
  if (data.state === "unknown") {
    requireExactKeys(data, ["state"]);
    return Object.freeze({ state: "unknown" as const });
  }
  throw new PaginationProtocolError();
}

function parseCapabilities(value: unknown): Readonly<PageCapabilities> {
  const data = requireRecord(value);
  requireExactKeys(data, [
    "first",
    "previous",
    "numberedVisitedPages",
    "next",
    "last",
  ]);
  return Object.freeze({
    first: requireBoolean(data.first),
    previous: requireBoolean(data.previous),
    numberedVisitedPages: requireBoolean(data.numberedVisitedPages),
    next: requireBoolean(data.next),
    last: requireBoolean(data.last),
  });
}

function parsePreparation(value: unknown): PagePreparation {
  const data = requireRecord(value);
  requireExactKeys(data, ["state", "completedUnits"], ["totalUnits", "message"]);
  if (
    data.state !== "preparing" &&
    data.state !== "ready" &&
    data.state !== "failed"
  ) {
    throw new PaginationProtocolError();
  }
  const completedUnits = requireSafeInteger(data.completedUnits, 0);
  const totalUnits = hasOwn(data, "totalUnits")
    ? requireSafeInteger(data.totalUnits, 0)
    : undefined;
  if (totalUnits !== undefined && completedUnits > totalUnits) {
    throw new PaginationProtocolError();
  }
  const message = hasOwn(data, "message")
    ? requireBoundedString(data.message, 500)
    : undefined;
  return Object.freeze({
    state: data.state,
    completedUnits,
    ...(totalUnits === undefined ? {} : { totalUnits }),
    ...(message === undefined ? {} : { message }),
  });
}

export function parsePagedRequest(
  value: unknown,
  defaultPageSize = adminDirectoryDefaultPageSize,
): PagedRequest {
  const data = requireRecord(value);
  requireExactKeys(
    data,
    [
      "protocolVersion",
      "criteria",
      "direction",
      "requestExactCount",
      "clientRequestId",
    ],
    ["pageSize", "cursor"],
  );
  if (data.protocolVersion !== pageProtocolVersion) {
    throw new PaginationProtocolError();
  }
  if (
    typeof data.direction !== "string" ||
    !pageDirections.includes(data.direction as PageDirection)
  ) {
    throw new PaginationProtocolError();
  }
  const direction = data.direction as PageDirection;
  const hasCursor = hasOwn(data, "cursor");
  const cursor = hasCursor ? requireBoundedString(data.cursor, 8192) : undefined;
  if (
    ((direction === "forward" || direction === "backward") && !hasCursor) ||
    ((direction === "first" || direction === "last") && hasCursor)
  ) {
    throw new PaginationProtocolError();
  }
  const criteriaSource = requireRecord(data.criteria);
  // Fingerprinting exercises the same supported-value contract and rejects
  // cycles, nonfinite values, and unsupported object types before cloning.
  let criteria: Readonly<Record<string, unknown>>;
  try {
    createQueryFingerprint(criteriaSource);
    criteria = cloneCriteriaValue(criteriaSource) as Readonly<
      Record<string, unknown>
    >;
  } catch {
    throw new PaginationProtocolError();
  }
  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    pageSize: requirePageSize(data.pageSize, defaultPageSize),
    criteria,
    ...(cursor === undefined ? {} : { cursor }),
    direction,
    requestExactCount: requireBoolean(data.requestExactCount),
    clientRequestId: requireBoundedString(data.clientRequestId, 128),
  });
}

export function parsePagedResponse<T>(
  value: unknown,
  parseItem: (value: unknown, index: number) => T,
): PagedResponse<T> {
  const data = requireRecord(value);
  requireExactKeys(
    data,
    [
      "protocolVersion",
      "items",
      "pageSize",
      "hasNext",
      "hasPrevious",
      "queryFingerprint",
      "snapshotTimestampMs",
      "capabilities",
    ],
    [
      "nextCursor",
      "previousCursor",
      "currentPageNumber",
      "total",
      "preparation",
    ],
  );
  if (data.protocolVersion !== pageProtocolVersion || !Array.isArray(data.items)) {
    throw new PaginationProtocolError();
  }
  const pageSize = requirePageSize(data.pageSize, adminDirectoryDefaultPageSize);
  if (data.items.length > pageSize) {
    throw new PaginationProtocolError();
  }
  const hasNext = requireBoolean(data.hasNext);
  const hasPrevious = requireBoolean(data.hasPrevious);
  const nextCursor = hasOwn(data, "nextCursor")
    ? requireBoundedString(data.nextCursor, 8192)
    : undefined;
  const previousCursor = hasOwn(data, "previousCursor")
    ? requireBoundedString(data.previousCursor, 8192)
    : undefined;
  if (hasNext !== (nextCursor !== undefined) || hasPrevious !== (previousCursor !== undefined)) {
    throw new PaginationProtocolError();
  }
  const capabilities = parseCapabilities(data.capabilities);
  if (capabilities.next !== hasNext || capabilities.previous !== hasPrevious) {
    throw new PaginationProtocolError();
  }
  const currentPageNumber = hasOwn(data, "currentPageNumber")
    ? requireSafeInteger(data.currentPageNumber, 1)
    : undefined;
  const total = hasOwn(data, "total")
    ? parsePagedTotal(data.total)
    : undefined;
  if (
    currentPageNumber !== undefined &&
    total?.state === "exact" &&
    total.value > 0 &&
    currentPageNumber > Math.ceil(total.value / pageSize)
  ) {
    throw new PaginationProtocolError();
  }
  const preparation = hasOwn(data, "preparation")
    ? parsePreparation(data.preparation)
    : undefined;
  if (preparation?.state === "preparing" && total?.state === "exact") {
    throw new PaginationProtocolError();
  }
  const queryFingerprint = requireBoundedString(data.queryFingerprint, 64);
  if (!/^[a-f0-9]{64}$/u.test(queryFingerprint)) {
    throw new PaginationProtocolError();
  }
  const items = Object.freeze(data.items.map(parseItem));
  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    items,
    pageSize,
    hasNext,
    hasPrevious,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(previousCursor === undefined ? {} : { previousCursor }),
    ...(currentPageNumber === undefined ? {} : { currentPageNumber }),
    ...(total === undefined ? {} : { total }),
    queryFingerprint,
    snapshotTimestampMs: requireSafeInteger(data.snapshotTimestampMs, 0),
    capabilities,
    ...(preparation === undefined ? {} : { preparation }),
  });
}

export function exactTotalPageCount(
  total: PagedTotal | undefined,
  pageSize: number,
): number | undefined {
  const size = requirePageSize(pageSize, adminDirectoryDefaultPageSize);
  if (total?.state !== "exact") {
    return undefined;
  }
  return Math.max(1, Math.ceil(total.value / size));
}
