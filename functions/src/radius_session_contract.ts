import { pageProtocolVersion } from "./pagination_protocol.js";

export const radiusSessionIdleTimeoutMs = 15 * 60 * 1_000;
export const radiusSessionAbsoluteTimeoutMs = 60 * 60 * 1_000;

export interface RadiusRangeCursorState {
  readonly rangeId: string;
  readonly cursor?: string;
  readonly exhausted: boolean;
}

export interface RadiusSessionProgress {
  readonly completedRanges: number;
  readonly totalRanges: number;
  readonly candidatesExamined: number;
  readonly resultsMaterialized: number;
}

export interface RadiusPageAnchor {
  readonly pageNumber: number;
  readonly cursor: string;
}

export interface RadiusSessionContract {
  readonly protocolVersion: typeof pageProtocolVersion;
  readonly sessionId: string;
  readonly queryFingerprint: string;
  readonly callerBinding: string;
  readonly source: string;
  readonly searchMode: string;
  readonly rangeCursors: readonly RadiusRangeCursorState[];
  readonly createdAtMs: number;
  readonly lastUsedAtMs: number;
  readonly idleExpiresAtMs: number;
  readonly absoluteExpiresAtMs: number;
  readonly state: "preparing" | "ready" | "failed";
  readonly progress: Readonly<RadiusSessionProgress>;
  readonly pageAnchors: readonly RadiusPageAnchor[];
  readonly exactTotal?: number;
}

export class RadiusSessionContractError extends Error {
  readonly code = "radius_session_contract_error";

  constructor() {
    super("The radius-search session contract is invalid.");
    this.name = "RadiusSessionContractError";
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
    throw new RadiusSessionContractError();
  }
  return value;
}

function requireKeys(
  data: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !hasOwn(data, key)) ||
    Object.keys(data).some((key) => !allowed.has(key))
  ) {
    throw new RadiusSessionContractError();
  }
}

function requireString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new RadiusSessionContractError();
  }
  return value;
}

function requireFingerprint(value: unknown): string {
  const result = requireString(value, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    throw new RadiusSessionContractError();
  }
  return result;
}

function requireInteger(value: unknown, minimum = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new RadiusSessionContractError();
  }
  return value;
}

function parseRangeCursor(value: unknown): RadiusRangeCursorState {
  const data = requireRecord(value);
  requireKeys(data, ["rangeId", "exhausted"], ["cursor"]);
  if (typeof data.exhausted !== "boolean") {
    throw new RadiusSessionContractError();
  }
  const cursor = hasOwn(data, "cursor")
    ? requireString(data.cursor, 8192)
    : undefined;
  if (data.exhausted && cursor !== undefined) {
    throw new RadiusSessionContractError();
  }
  return Object.freeze({
    rangeId: requireString(data.rangeId, 128),
    ...(cursor === undefined ? {} : { cursor }),
    exhausted: data.exhausted,
  });
}

function parseProgress(value: unknown): Readonly<RadiusSessionProgress> {
  const data = requireRecord(value);
  requireKeys(data, [
    "completedRanges",
    "totalRanges",
    "candidatesExamined",
    "resultsMaterialized",
  ]);
  const completedRanges = requireInteger(data.completedRanges);
  const totalRanges = requireInteger(data.totalRanges, 1);
  if (completedRanges > totalRanges) {
    throw new RadiusSessionContractError();
  }
  return Object.freeze({
    completedRanges,
    totalRanges,
    candidatesExamined: requireInteger(data.candidatesExamined),
    resultsMaterialized: requireInteger(data.resultsMaterialized),
  });
}

function parsePageAnchor(value: unknown): RadiusPageAnchor {
  const data = requireRecord(value);
  requireKeys(data, ["pageNumber", "cursor"]);
  return Object.freeze({
    pageNumber: requireInteger(data.pageNumber, 1),
    cursor: requireString(data.cursor, 8192),
  });
}

export function parseRadiusSessionContract(value: unknown): RadiusSessionContract {
  const data = requireRecord(value);
  requireKeys(
    data,
    [
      "protocolVersion",
      "sessionId",
      "queryFingerprint",
      "callerBinding",
      "source",
      "searchMode",
      "rangeCursors",
      "createdAtMs",
      "lastUsedAtMs",
      "idleExpiresAtMs",
      "absoluteExpiresAtMs",
      "state",
      "progress",
      "pageAnchors",
    ],
    ["exactTotal"],
  );
  if (
    data.protocolVersion !== pageProtocolVersion ||
    (data.state !== "preparing" && data.state !== "ready" && data.state !== "failed") ||
    !Array.isArray(data.rangeCursors) ||
    !Array.isArray(data.pageAnchors)
  ) {
    throw new RadiusSessionContractError();
  }
  const createdAtMs = requireInteger(data.createdAtMs);
  const lastUsedAtMs = requireInteger(data.lastUsedAtMs);
  const idleExpiresAtMs = requireInteger(data.idleExpiresAtMs);
  const absoluteExpiresAtMs = requireInteger(data.absoluteExpiresAtMs);
  if (
    lastUsedAtMs < createdAtMs ||
    idleExpiresAtMs !== lastUsedAtMs + radiusSessionIdleTimeoutMs ||
    absoluteExpiresAtMs !== createdAtMs + radiusSessionAbsoluteTimeoutMs ||
    idleExpiresAtMs > absoluteExpiresAtMs
  ) {
    throw new RadiusSessionContractError();
  }
  const rangeCursors = Object.freeze(data.rangeCursors.map(parseRangeCursor));
  if (new Set(rangeCursors.map((entry) => entry.rangeId)).size !== rangeCursors.length) {
    throw new RadiusSessionContractError();
  }
  const progress = parseProgress(data.progress);
  if (progress.totalRanges !== rangeCursors.length) {
    throw new RadiusSessionContractError();
  }
  const pageAnchors = Object.freeze(data.pageAnchors.map(parsePageAnchor));
  const pageNumbers = pageAnchors.map((anchor) => anchor.pageNumber);
  if (
    new Set(pageNumbers).size !== pageNumbers.length ||
    pageNumbers.some((page, index) => index > 0 && page <= pageNumbers[index - 1])
  ) {
    throw new RadiusSessionContractError();
  }
  const hasExactTotal = hasOwn(data, "exactTotal");
  const exactTotal = hasExactTotal ? requireInteger(data.exactTotal) : undefined;
  if ((data.state === "ready") !== hasExactTotal) {
    throw new RadiusSessionContractError();
  }
  if (data.state === "ready" && progress.completedRanges !== progress.totalRanges) {
    throw new RadiusSessionContractError();
  }
  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    sessionId: requireString(data.sessionId, 128),
    queryFingerprint: requireFingerprint(data.queryFingerprint),
    callerBinding: requireFingerprint(data.callerBinding),
    source: requireString(data.source, 100),
    searchMode: requireString(data.searchMode, 100),
    rangeCursors,
    createdAtMs,
    lastUsedAtMs,
    idleExpiresAtMs,
    absoluteExpiresAtMs,
    state: data.state,
    progress,
    pageAnchors,
    ...(exactTotal === undefined ? {} : { exactTotal }),
  });
}

export function radiusSessionExpiryState(
  session: RadiusSessionContract,
  nowMs: number,
): "active" | "idle-expired" | "absolute-expired" {
  const now = requireInteger(nowMs);
  if (now >= session.absoluteExpiresAtMs) {
    return "absolute-expired";
  }
  if (now >= session.idleExpiresAtMs) {
    return "idle-expired";
  }
  return "active";
}

export function canNavigateToRadiusPage(
  session: RadiusSessionContract,
  pageNumber: number,
): boolean {
  const requestedPage = requireInteger(pageNumber, 1);
  return session.pageAnchors.some((anchor) => anchor.pageNumber === requestedPage);
}
