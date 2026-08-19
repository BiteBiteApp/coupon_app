import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import {
  type AdminRestaurantSource,
  type ResolvedAdminRestaurantSearchCenter,
  type ValidatedAdminRestaurantSearchRequest,
  validateAdminRestaurantSearchRequest,
} from "./admin_restaurant_search_helpers.js";
import { OpaqueCursorCodec } from "./opaque_cursor.js";
import {
  adminDirectoryDefaultPageSize,
  pageProtocolVersion,
  parsePagedRequest,
  type PagedRequest,
} from "./pagination_protocol.js";
import { readBiteScoreCatalogRestaurantId } from "./restaurant_invite_helpers.js";

export const adminLinkRestaurantPageSize = adminDirectoryDefaultPageSize;
export const adminLinkRestaurantPagingSchemaVersion = 1;
export const adminLinkRestaurantOrderingVersion = 1;
export const adminLinkRestaurantPagingPurpose =
  "adminLinkRestaurantWorkspace" as const;
export const adminLinkRestaurantCursorSource =
  "adminLinkRestaurants" as const;
export const adminLinkRestaurantSearchMode = "nearbyRadius" as const;

type CriteriaCenter =
  | Readonly<{ mode: "typed"; locationQuery: string }>
  | Readonly<{
    mode: "coordinates";
    latitudeMicros: number;
    longitudeMicros: number;
  }>;

export type AdminLinkRestaurantPageCriteria = Readonly<{
  center: CriteriaCenter;
  resolvedCenter: ResolvedAdminRestaurantSearchCenter | null;
  request: ValidatedAdminRestaurantSearchRequest;
  searchInstanceId: string;
  fingerprintBase: Readonly<Record<string, unknown>>;
}>;

export type AdminLinkRestaurantParsedContext = Readonly<{
  request: PagedRequest;
  criteria: AdminLinkRestaurantPageCriteria;
  codec: OpaqueCursorCodec;
  callerBinding: string;
  nowMs: number;
}>;

export type AdminLinkRestaurantPageContext = Readonly<{
  adminUid: string;
  cursorSecret: unknown;
  now?: () => number;
  nonceSource?: (size: number) => Uint8Array;
}>;

function invalidRequest(message = "The restaurant page request is invalid."): never {
  throw new HttpsError("invalid-argument", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalidRequest();
  }
}

function boundedString(value: unknown, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    invalidRequest();
  }
  return value;
}

function finiteCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalidRequest();
  }
  return value;
}

function parseCenter(value: unknown): CriteriaCenter {
  if (!isRecord(value)) {
    invalidRequest();
  }
  if (value.mode === "typed") {
    exactKeys(value, ["mode", "locationQuery"]);
    const validated = validateAdminRestaurantSearchRequest({
      locationQuery: value.locationQuery,
      radiusMiles: 1,
      resultLimit: adminLinkRestaurantPageSize,
    });
    if (validated.center.mode !== "typed") {
      invalidRequest();
    }
    return Object.freeze({
      mode: "typed" as const,
      locationQuery: validated.center.locationQuery,
    });
  }
  if (value.mode === "coordinates") {
    exactKeys(value, ["mode", "latitudeMicros", "longitudeMicros"]);
    if (
      !Number.isSafeInteger(value.latitudeMicros) ||
      !Number.isSafeInteger(value.longitudeMicros)
    ) {
      invalidRequest();
    }
    const latitude = (value.latitudeMicros as number) / 1_000_000;
    const longitude = (value.longitudeMicros as number) / 1_000_000;
    const validated = validateAdminRestaurantSearchRequest({
      latitude,
      longitude,
      radiusMiles: 1,
      resultLimit: adminLinkRestaurantPageSize,
    });
    if (validated.center.mode !== "coordinates") {
      invalidRequest();
    }
    return Object.freeze({
      mode: "coordinates" as const,
      latitudeMicros: Math.round(
        validated.center.coordinates.latitude * 1_000_000,
      ),
      longitudeMicros: Math.round(
        validated.center.coordinates.longitude * 1_000_000,
      ),
    });
  }
  invalidRequest();
}

function parseResolvedCenter(
  value: unknown,
): ResolvedAdminRestaurantSearchCenter | null {
  if (value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    invalidRequest();
  }
  exactKeys(value, ["latitudeMicros", "longitudeMicros", "displayName"]);
  if (
    !Number.isSafeInteger(value.latitudeMicros) ||
    !Number.isSafeInteger(value.longitudeMicros)
  ) {
    invalidRequest();
  }
  return Object.freeze({
    latitude: finiteCoordinate(
      (value.latitudeMicros as number) / 1_000_000,
      -90,
      90,
    ),
    longitude: finiteCoordinate(
      (value.longitudeMicros as number) / 1_000_000,
      -180,
      180,
    ),
    displayName: boundedString(value.displayName, 500),
  });
}

function parseSources(value: unknown): AdminRestaurantSource[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    invalidRequest();
  }
  const sources = value.map((entry): AdminRestaurantSource => {
    if (entry !== "biteScore" && entry !== "biteSaver") {
      invalidRequest();
    }
    return entry;
  });
  if (new Set(sources).size !== sources.length) {
    invalidRequest();
  }
  const expected = ["biteScore", "biteSaver"].filter((source) =>
    sources.includes(source as AdminRestaurantSource)
  );
  if (sources.some((source, index) => source !== expected[index])) {
    invalidRequest("Restaurant sources must use canonical ordering.");
  }
  return sources;
}

export function parseAdminLinkRestaurantCriteria(
  value: Readonly<Record<string, unknown>>,
): AdminLinkRestaurantPageCriteria {
  exactKeys(
    value,
    [
      "schemaVersion",
      "orderingVersion",
      "purpose",
      "center",
      "radiusMicromiles",
      "restaurantName",
      "sources",
      "biteScoreStatus",
      "futureFilters",
      "searchInstanceId",
    ],
    ["resolvedCenter"],
  );
  if (
    value.schemaVersion !== adminLinkRestaurantPagingSchemaVersion ||
    value.orderingVersion !== adminLinkRestaurantOrderingVersion ||
    value.purpose !== adminLinkRestaurantPagingPurpose ||
    !isRecord(value.futureFilters) ||
    Object.keys(value.futureFilters).length !== 0
  ) {
    invalidRequest();
  }
  const center = parseCenter(value.center);
  const resolvedCenter = parseResolvedCenter(value.resolvedCenter);
  const sources = parseSources(value.sources);
  if (
    !Number.isSafeInteger(value.radiusMicromiles) ||
    (value.radiusMicromiles as number) < 1 ||
    (value.radiusMicromiles as number) > 50_000_000
  ) {
    invalidRequest();
  }
  const restaurantName = value.restaurantName;
  if (restaurantName !== null && typeof restaurantName !== "string") {
    invalidRequest();
  }
  if (
    value.biteScoreStatus !== "active" &&
    value.biteScoreStatus !== "inactive" &&
    value.biteScoreStatus !== "all"
  ) {
    invalidRequest();
  }
  if (!sources.includes("biteScore") && value.biteScoreStatus !== "active") {
    invalidRequest();
  }
  const rawSearchRequest: Record<string, unknown> = {
    ...(center.mode === "typed"
      ? { locationQuery: center.locationQuery }
      : {
          latitude: center.latitudeMicros / 1_000_000,
          longitude: center.longitudeMicros / 1_000_000,
        }),
    radiusMiles: (value.radiusMicromiles as number) / 1_000_000,
    restaurantName,
    sources,
    ...(sources.includes("biteScore")
      ? { biteScoreStatus: value.biteScoreStatus }
      : {}),
    resultLimit: adminLinkRestaurantPageSize,
  };
  const request = validateAdminRestaurantSearchRequest(rawSearchRequest);
  const searchInstanceId = boundedString(value.searchInstanceId, 128);
  if (!/^[A-Za-z0-9._:-]+$/u.test(searchInstanceId)) {
    invalidRequest("The restaurant search instance is invalid.");
  }
  return Object.freeze({
    center,
    resolvedCenter,
    request,
    searchInstanceId,
    fingerprintBase: Object.freeze({
      protocolVersion: pageProtocolVersion,
      schemaVersion: adminLinkRestaurantPagingSchemaVersion,
      orderingVersion: adminLinkRestaurantOrderingVersion,
      purpose: adminLinkRestaurantPagingPurpose,
      center,
      radiusMicromiles: Math.round(request.radiusMiles * 1_000_000),
      normalizedRestaurantName: request.normalizedRestaurantName,
      sources: request.sources,
      biteScoreStatus: request.biteScoreStatus,
      pageSize: adminLinkRestaurantPageSize,
      futureFilters: Object.freeze({}),
      searchInstanceId,
    }),
  });
}

export function adminLinkRestaurantFingerprintCriteria(
  criteria: AdminLinkRestaurantPageCriteria,
  center: ResolvedAdminRestaurantSearchCenter,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...criteria.fingerprintBase,
    resolvedCenter: Object.freeze({
      latitudeMicros: Math.round(center.latitude * 1_000_000),
      longitudeMicros: Math.round(center.longitude * 1_000_000),
    }),
  });
}

export function decodeAdminLinkRestaurantCursorKey(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new HttpsError(
      "failed-precondition",
      "Admin Link pagination is not configured.",
    );
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    throw new HttpsError(
      "failed-precondition",
      "Admin Link pagination is not configured.",
    );
  }
  return bytes;
}

export function createAdminLinkRestaurantParsedContext(
  rawRequest: unknown,
  context: AdminLinkRestaurantPageContext,
): AdminLinkRestaurantParsedContext {
  let request: PagedRequest;
  try {
    request = parsePagedRequest(rawRequest, adminLinkRestaurantPageSize);
  } catch (_error) {
    invalidRequest();
  }
  if (
    request.pageSize !== adminLinkRestaurantPageSize ||
    request.requestExactCount ||
    (request.direction !== "first" && request.direction !== "forward")
  ) {
    invalidRequest();
  }
  const adminUid = readBiteScoreCatalogRestaurantId(context.adminUid);
  if (adminUid === null) {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  const criteria = parseAdminLinkRestaurantCriteria(request.criteria);
  const nowMs = context.now?.() ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("The Admin Link pagination clock is invalid.");
  }
  return Object.freeze({
    request,
    criteria,
    codec: new OpaqueCursorCodec({
      key: decodeAdminLinkRestaurantCursorKey(context.cursorSecret),
      clock: context.now,
      nonceSource: context.nonceSource,
    }),
    callerBinding: createHash("sha256")
      .update(JSON.stringify(["adminLinkRestaurants", adminUid]), "utf8")
      .digest("hex"),
    nowMs,
  });
}
