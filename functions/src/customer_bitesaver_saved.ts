import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import {
  customerBiteSaverOfferProjectionVersion,
  customerBiteSaverRestaurantProjectionVersion,
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  CustomerBiteSaverContractError,
  privateCustomerBiteSaverActiveSessionCollection,
} from "./customer_bitesaver_search_contract.js";
import { customerBiteSaverDeterministicId } from
  "./customer_bitesaver_search_cursor.js";
import {
  customerBiteSaverOpaqueOfferId,
  customerBiteSaverOpaqueRestaurantId,
  type CustomerBiteSaverIdentityKeyV1,
} from "./customer_bitesaver_public_identity.js";
import {
  buildCustomerBiteSaverCouponRedemption,
  customerBiteSaverCouponFavoritePath,
  customerBiteSaverCouponRedemptionPath,
  customerBiteSaverRestaurantFavoritePath,
  parseCustomerBiteSaverCouponFavorite,
  parseCustomerBiteSaverCouponRedemption,
  parseCustomerBiteSaverRestaurantFavorite,
} from "./customer_bitesaver_customer_data_contract.js";
import {
  customerBiteSaverRedemptionTimerMilliseconds,
  customerBiteSaverUsageEvaluationCalendar,
  evaluateCustomerBiteSaverOfferAvailability,
  normalizeCustomerBiteSaverUsagePolicy,
  type CustomerBiteSaverNormalizedUsagePolicy,
  type CustomerBiteSaverUsageState,
} from "./customer_bitesaver_offer_availability.js";
import {
  decodeDartUtf16FirestoreBytesOrderKey,
  hasWellFormedCustomerBiteSaverUtf16,
} from "./customer_bitesaver_search_matcher.js";
import {
  buildBiteSaverCouponOfferIndex,
  buildBiteSaverRestaurantIndex,
} from "./search_index_builders.js";
import {
  biteSaverOfferIndexCollection,
  restaurantSearchIndexCollection,
} from "./search_index_contract.js";
import { createQueryFingerprint } from "./query_fingerprint.js";
import { validRestaurantCoordinates } from "./restaurant_geo_helpers.js";
import type { CustomerBiteSaverStoredDocument } from
  "./customer_bitesaver_search_store.js";
import {
  customerBiteSaverMenuCandidateBudget,
  customerBiteSaverMenuCandidateByteBudget,
  customerBiteSaverMenuCandidateBytes,
  customerBiteSaverMenuKinds,
  customerBiteSaverMenuPageSize,
  customerBiteSaverPublicMenuEntry,
  resolveCustomerBiteSaverSavedMenuSource,
  type CustomerBiteSaverMenuEntry,
  type CustomerBiteSaverMenuPageResult,
  type CustomerBiteSaverPublicOfferDto,
  type CustomerBiteSaverPublicRestaurantDto,
  type CustomerBiteSaverRedemptionStartResult,
  type CustomerBiteSaverRedemptionValidationResult,
  type CustomerBiteSaverSessionContext,
} from "./customer_bitesaver_search_session.js";

const savedPageSize = 25;
const savedCandidateBudget = 75;
const savedTokenLifetimeMilliseconds = 24 * 60 * 60 * 1_000;
const savedTokenPrefix = "bssv1.";
const publicRestaurantPattern = /^bsr_[A-Za-z0-9_-]{43}$/u;
const publicOfferPattern = /^bso_[A-Za-z0-9_-]{43}$/u;

type SavedSection = "restaurants" | "coupons";

type SavedAccess = Readonly<{
  userId: string;
  section: SavedSection;
  restaurantId: string;
  offerId: string | null;
  authoritativeAccountId: string;
  issuedAtMillis: number;
  expiresAtMillis: number;
}>;

type SavedCandidate = Readonly<{
  document: CustomerBiteSaverStoredDocument;
  createdAt: Readonly<{seconds: number; nanoseconds: number}>;
}>;

export type CustomerBiteSaverSavedEntry = Readonly<{
  favoriteKind: "bitesaverRestaurant" | "bitesaverCoupon";
  restaurantId: string | null;
  offerId: string | null;
  availability: "available" | "unavailable";
  restaurant: CustomerBiteSaverPublicRestaurantDto | null;
  offer: CustomerBiteSaverPublicOfferDto | null;
  accessToken: string | null;
}>;

export type CustomerBiteSaverSavedPageResult = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  section: SavedSection;
  entries: readonly CustomerBiteSaverSavedEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  partial: boolean;
}>;

function invalidArgument(message = "The Saved request is invalid."): never {
  throw new CustomerBiteSaverContractError("invalid-argument", message);
}

function requireSignedInUserId(
  identity: CustomerBiteSaverSessionContext["identity"],
): string {
  const userId = identity.authUid;
  if (
    userId === null ||
    identity.authIsAnonymous ||
    userId.length === 0 ||
    userId === "." ||
    userId === ".." ||
    /^__.*__$/u.test(userId) ||
    userId.includes("/") ||
    !hasWellFormedCustomerBiteSaverUtf16(userId) ||
    Buffer.byteLength(userId, "utf8") > 1_500
  ) {
    throw new CustomerBiteSaverContractError(
      "permission-denied",
      "Sign in to load Saved items.",
    );
  }
  return userId;
}

function identityKey(
  context: CustomerBiteSaverSessionContext,
): CustomerBiteSaverIdentityKeyV1 {
  const key = context.identityKeyV1;
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length &&
    keys.every((key, index) => key === sorted[index]);
}

function exactInternalId(value: unknown): string | null {
  return typeof value === "string" &&
      value.length > 0 &&
      value.length <= 1_500 &&
      value !== "." &&
      value !== ".." &&
      !/^__.*__$/u.test(value) &&
      !value.includes("/") &&
      hasWellFormedCustomerBiteSaverUtf16(value) &&
      Buffer.byteLength(value, "utf8") <= 1_500
    ? value
    : null;
}

function dateValue(value: unknown): Date | null {
  let candidate = value;
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as {toDate?: unknown}).toDate === "function"
  ) {
    try {
      candidate = (value as {toDate(): unknown}).toDate();
    } catch {
      return null;
    }
  }
  return candidate instanceof Date &&
      Number.isSafeInteger(candidate.getTime()) && candidate.getTime() >= 0
    ? new Date(candidate.getTime())
    : null;
}

function timestampParts(
  value: unknown,
): Readonly<{seconds: number; nanoseconds: number}> | null {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return null;
    const seconds = Math.floor(milliseconds / 1_000);
    return Object.freeze({
      seconds,
      nanoseconds: (milliseconds - seconds * 1_000) * 1_000_000,
    });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as {
    seconds?: unknown;
    nanoseconds?: unknown;
    _seconds?: unknown;
    _nanoseconds?: unknown;
    toDate?: unknown;
  };
  const seconds = candidate.seconds ?? candidate._seconds;
  const nanoseconds = candidate.nanoseconds ?? candidate._nanoseconds;
  if (
    typeof candidate.toDate !== "function" ||
    typeof seconds !== "number" ||
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    seconds > 253_402_300_799 ||
    typeof nanoseconds !== "number" ||
    !Number.isSafeInteger(nanoseconds) ||
    nanoseconds < 0 ||
    nanoseconds >= 1_000_000_000
  ) {
    return null;
  }
  return Object.freeze({seconds, nanoseconds});
}

function firestoreTimestamp(
  value: Readonly<{seconds: number; nanoseconds: number}>,
): Timestamp {
  return new Timestamp(value.seconds, value.nanoseconds);
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

class SavedOpaqueCodec {
  readonly #key: Buffer;
  readonly #now: () => number;

  constructor(key: Uint8Array, now: () => number) {
    if (!(key instanceof Uint8Array) || key.length !== 32) {
      throw new CustomerBiteSaverContractError("failed-precondition");
    }
    this.#key = Buffer.from(key);
    this.#now = now;
  }

  encode(payload: Readonly<Record<string, unknown>>): string {
    try {
      const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
      cipher.setAAD(Buffer.from(savedTokenPrefix, "ascii"));
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return savedTokenPrefix + Buffer.concat([
        nonce,
        cipher.getAuthTag(),
        encrypted,
      ]).toString("base64url");
    } catch {
      return invalidArgument();
    }
  }

  open(token: unknown): Record<string, unknown> {
    try {
      if (
        typeof token !== "string" ||
        !token.startsWith(savedTokenPrefix) ||
        token.length > 32_768
      ) {
        return invalidArgument();
      }
      const encoded = token.slice(savedTokenPrefix.length);
      if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return invalidArgument();
      const packed = Buffer.from(encoded, "base64url");
      if (packed.toString("base64url") !== encoded || packed.length <= 28) {
        return invalidArgument();
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        packed.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(savedTokenPrefix, "ascii"));
      decipher.setAuthTag(packed.subarray(12, 28));
      const plaintext = Buffer.concat([
        decipher.update(packed.subarray(28)),
        decipher.final(),
      ]);
      const payload = JSON.parse(plaintext.toString("utf8")) as unknown;
      if (!isRecord(payload)) return invalidArgument();
      const expiresAtMillis = safeInteger(payload.expiresAtMillis);
      if (expiresAtMillis === null || this.#now() >= expiresAtMillis) {
        return invalidArgument("The Saved access expired. Refresh Saved.");
      }
      return payload;
    } catch (error) {
      if (error instanceof CustomerBiteSaverContractError) throw error;
      return invalidArgument();
    }
  }
}

function parseSavedRequest(value: unknown): Readonly<{
  section: SavedSection;
  cursor: string | null;
}> {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "clientRequestId",
      "section",
      "cursor",
    ]) ||
    value.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    typeof value.clientRequestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(value.clientRequestId) ||
    (value.section !== "restaurants" && value.section !== "coupons") ||
    (value.cursor !== null &&
      (typeof value.cursor !== "string" || value.cursor.length > 32_768))
  ) {
    return invalidArgument();
  }
  return Object.freeze({
    section: value.section,
    cursor: value.cursor as string | null,
  });
}

function openPageCursor(value: {
  codec: SavedOpaqueCodec;
  token: string | null;
  userId: string;
  section: SavedSection;
}): Readonly<{createdAt: Timestamp; documentId: string}> | null {
  if (value.token === null) return null;
  const payload = value.codec.open(value.token);
  if (
    !exactKeys(payload, [
      "version",
      "purpose",
      "userId",
      "section",
      "createdAtSeconds",
      "createdAtNanoseconds",
      "documentId",
      "issuedAtMillis",
      "expiresAtMillis",
    ]) ||
    payload.version !== 1 ||
    payload.purpose !== "savedPage" ||
    payload.userId !== value.userId ||
    payload.section !== value.section
  ) {
    return invalidArgument();
  }
  const createdAtSeconds = safeInteger(payload.createdAtSeconds);
  const createdAtNanoseconds = safeInteger(payload.createdAtNanoseconds);
  const documentId = exactInternalId(payload.documentId);
  if (
    createdAtSeconds === null ||
    createdAtSeconds > 253_402_300_799 ||
    createdAtNanoseconds === null ||
    createdAtNanoseconds >= 1_000_000_000 ||
    documentId === null
  ) {
    return invalidArgument();
  }
  return Object.freeze({
    createdAt: new Timestamp(createdAtSeconds, createdAtNanoseconds),
    documentId,
  });
}

function pageCursor(value: {
  codec: SavedOpaqueCodec;
  userId: string;
  section: SavedSection;
  boundary: Readonly<{
    createdAt: Readonly<{seconds: number; nanoseconds: number}>;
    documentId: string;
  }>;
  nowMs: number;
}): string {
  return value.codec.encode(Object.freeze({
    version: 1,
    purpose: "savedPage",
    userId: value.userId,
    section: value.section,
    createdAtSeconds: value.boundary.createdAt.seconds,
    createdAtNanoseconds: value.boundary.createdAt.nanoseconds,
    documentId: value.boundary.documentId,
    issuedAtMillis: value.nowMs,
    expiresAtMillis: value.nowMs + savedTokenLifetimeMilliseconds,
  }));
}

function accessToken(value: {
  codec: SavedOpaqueCodec;
  userId: string;
  section: SavedSection;
  restaurantId: string;
  offerId: string | null;
  authoritativeAccountId: string;
  nowMs: number;
}): string {
  return value.codec.encode(Object.freeze({
    version: 1,
    purpose: "savedAccess",
    userId: value.userId,
    section: value.section,
    restaurantId: value.restaurantId,
    offerId: value.offerId,
    authoritativeAccountId: value.authoritativeAccountId,
    issuedAtMillis: value.nowMs,
    expiresAtMillis: value.nowMs + savedTokenLifetimeMilliseconds,
  }));
}

function openAccess(value: {
  codec: SavedOpaqueCodec;
  token: unknown;
  userId: string;
}): SavedAccess {
  const payload = value.codec.open(value.token);
  if (
    !exactKeys(payload, [
      "version",
      "purpose",
      "userId",
      "section",
      "restaurantId",
      "offerId",
      "authoritativeAccountId",
      "issuedAtMillis",
      "expiresAtMillis",
    ]) ||
    payload.version !== 1 ||
    payload.purpose !== "savedAccess" ||
    payload.userId !== value.userId ||
    (payload.section !== "restaurants" && payload.section !== "coupons") ||
    typeof payload.restaurantId !== "string" ||
    !publicRestaurantPattern.test(payload.restaurantId) ||
    (payload.offerId !== null &&
      (typeof payload.offerId !== "string" ||
        !publicOfferPattern.test(payload.offerId))) ||
    (payload.section === "restaurants" && payload.offerId !== null) ||
    (payload.section === "coupons" && payload.offerId === null)
  ) {
    return invalidArgument();
  }
  const authoritativeAccountId = exactInternalId(
    payload.authoritativeAccountId,
  );
  const issuedAtMillis = safeInteger(payload.issuedAtMillis);
  const expiresAtMillis = safeInteger(payload.expiresAtMillis);
  if (
    authoritativeAccountId === null ||
    issuedAtMillis === null ||
    expiresAtMillis === null ||
    expiresAtMillis <= issuedAtMillis ||
    expiresAtMillis - issuedAtMillis > savedTokenLifetimeMilliseconds
  ) {
    return invalidArgument();
  }
  return Object.freeze({
    userId: value.userId,
    section: payload.section,
    restaurantId: payload.restaurantId,
    offerId: payload.offerId as string | null,
    authoritativeAccountId,
    issuedAtMillis,
    expiresAtMillis,
  });
}

function boundedString(
  value: unknown,
  maximumLength: number,
  allowEmpty = true,
): string | null {
  if (
    typeof value !== "string" ||
    !hasWellFormedCustomerBiteSaverUtf16(value) ||
    Array.from(value).length > maximumLength ||
    Buffer.byteLength(value, "utf8") > maximumLength * 4 ||
    (!allowEmpty && value.length === 0)
  ) {
    return null;
  }
  return value;
}

function nullableString(value: unknown, maximumLength: number): string | null {
  return value === null || value === undefined
    ? null
    : boundedString(value, maximumLength);
}

function safeBusinessHours(value: unknown): readonly unknown[] {
  return Array.isArray(value) && (value.length === 0 || value.length === 7)
    ? Object.freeze([...value])
    : Object.freeze([]);
}

function restaurantDto(
  projection: Readonly<Record<string, unknown>>,
  publicRestaurantId: string,
): CustomerBiteSaverPublicRestaurantDto | null {
  const displayName = boundedString(projection.displayName, 200, false);
  if (displayName === null) return null;
  const streetAddress = nullableString(projection.streetAddress, 200);
  const city = boundedString(projection.city, 100) ?? "";
  const state = boundedString(projection.state, 100) ?? "";
  const zipCode = boundedString(projection.zipCode, 20) ?? "";
  const formattedAddress = nullableString(projection.formattedAddress, 500);
  const imageUrl = nullableString(projection.primaryImageUrl, 2_000);
  const phone = nullableString(projection.phone, 50);
  const website = nullableString(projection.website, 500);
  const bio = nullableString(projection.bio, 2_000);
  return Object.freeze({
    restaurantId: publicRestaurantId,
    displayName,
    streetAddress,
    city,
    state,
    zipCode,
    formattedAddress,
    imageUrl,
    phone,
    website,
    businessHours: safeBusinessHours(projection.businessHours),
    bio,
    distanceMiles: 0,
    isLocal: false,
    catalogBindingAvailable:
      typeof projection.biteSaverCatalogBindingId === "string",
    offers: Object.freeze([]),
    hasMoreOffers: false,
    usableOfferCount: null,
    offerCountState: "unknown",
    favoriteState: "unknown",
  });
}

function dateMillis(value: unknown): number | null {
  return dateValue(value)?.getTime() ?? null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeDays(value: unknown): readonly number[] {
  return Array.isArray(value)
    ? Object.freeze(value.filter((entry): entry is number =>
        typeof entry === "number" && Number.isInteger(entry) &&
        entry >= 1 && entry <= 7).slice(0, 7))
    : Object.freeze([]);
}

function offerDto(
  projection: Readonly<Record<string, unknown>>,
  publicOfferId: string,
): CustomerBiteSaverPublicOfferDto | null {
  const sourceCreatedAtMillis = dateMillis(projection.sourceCreatedAt);
  const usageRule = nullableString(projection.usageRule, 200);
  const usagePolicy = normalizeCustomerBiteSaverUsagePolicy(
    "coupon",
    usageRule,
  );
  if (sourceCreatedAtMillis === null || usagePolicy === null) return null;
  return Object.freeze({
    offerId: publicOfferId,
    offerOccurrence: "bsoc1." + createHash("sha256")
      .update("saved-offer\0", "utf8")
      .update(publicOfferId, "utf8")
      .update("\0", "utf8")
      .update(String(projection.sourceFingerprint ?? ""), "utf8")
      .digest("base64url"),
    offerType: "coupon",
    title: boundedString(projection.displayTitle, 200) ?? "",
    details: nullableString(projection.details, 4_000),
    couponCode: nullableString(projection.couponCode, 500),
    couponNumber: nullableString(projection.couponNumber, 500),
    usageRule,
    usagePolicy,
    availabilityMode: nullableString(projection.availabilityMode, 50),
    daysOfWeek: safeDays(projection.daysOfWeek),
    allDay: typeof projection.allDay === "boolean" ? projection.allDay : null,
    startTime: nullableString(projection.startTime, 50),
    endTime: nullableString(projection.endTime, 50),
    startAtMillis: dateMillis(projection.startAt),
    endAtMillis: dateMillis(projection.endAt),
    expiresAtMillis: dateMillis(projection.expiresAt),
    expiresText: nullableString(projection.expiresText, 500),
    isProximityOnly: projection.isProximityOnly === true,
    proximityRadiusMiles: finiteNumber(projection.proximityRadiusMiles),
    imageUrl: nullableString(projection.primaryImageUrl, 2_000),
    sourceCreatedAtMillis,
    available: false,
    availabilityReason: "savedReadOnly",
    redemptionPolicyLabel: usageRule,
    activeTimerExpiresAtMillis: null,
    nextAvailableAtMillis: null,
    usageState: "unknown",
  });
}

function projectionMap(
  documents: readonly CustomerBiteSaverStoredDocument[],
  field: "publicRestaurantId" | "publicOfferId",
): ReadonlyMap<string, CustomerBiteSaverStoredDocument> {
  const byId = new Map<string, CustomerBiteSaverStoredDocument>();
  const duplicateIds = new Set<string>();
  for (const document of documents) {
    const id = document.data[field];
    if (typeof id !== "string") continue;
    if (byId.has(id)) duplicateIds.add(id);
    byId.set(id, document);
  }
  for (const id of duplicateIds) byId.delete(id);
  return byId;
}

function unavailableRestaurant(restaurantId: string): CustomerBiteSaverSavedEntry {
  return Object.freeze({
    favoriteKind: "bitesaverRestaurant",
    restaurantId,
    offerId: null,
    availability: "unavailable",
    restaurant: null,
    offer: null,
    accessToken: null,
  });
}

function unavailableCoupon(
  offerId: string,
  restaurantId: string | null,
): CustomerBiteSaverSavedEntry {
  return Object.freeze({
    favoriteKind: "bitesaverCoupon",
    restaurantId,
    offerId,
    availability: "unavailable",
    restaurant: null,
    offer: null,
    accessToken: null,
  });
}

async function resolveRestaurantEntries(value: {
  context: CustomerBiteSaverSessionContext;
  codec: SavedOpaqueCodec;
  userId: string;
  candidates: readonly SavedCandidate[];
  now: Date;
}): Promise<readonly CustomerBiteSaverSavedEntry[]> {
  const ids = value.candidates.map((candidate) => candidate.document.id);
  const projections = ids.length === 0
    ? []
    : await value.context.database.queryDocuments({
        collectionPath: restaurantSearchIndexCollection,
        filters: Object.freeze([{
          field: "publicRestaurantId",
          operation: "in" as const,
          value: Object.freeze(ids),
        }]),
        orders: Object.freeze([]),
        limit: ids.length,
      });
  const byId = projectionMap(projections, "publicRestaurantId");
  const validProjectionById = new Map<string, CustomerBiteSaverStoredDocument>();
  for (const id of ids) {
    const document = byId.get(id);
    const accountId = exactInternalId(document?.data.sourceDocumentId);
    if (
      document !== undefined &&
      accountId !== null &&
      document.data.source === "biteSaver" &&
      document.data.entityType === "restaurant" &&
      document.data.publicProjectionVersion ===
        customerBiteSaverRestaurantProjectionVersion &&
      document.data.publicRestaurantId === id &&
      customerBiteSaverOpaqueRestaurantId(identityKey(value.context), accountId) === id
    ) {
      validProjectionById.set(id, document);
    }
  }
  const accountIds = [...new Set([...validProjectionById.values()].map(
    (document) => document.data.sourceDocumentId as string,
  ))];
  const rawDocuments = await value.context.database.getDocuments(
    accountIds.map((id) => `restaurant_accounts/${id}`),
  );
  const rawByAccount = new Map(accountIds.map((id, index) => [
    id,
    rawDocuments[index] ?? null,
  ]));
  return Object.freeze(value.candidates.map((candidate) => {
    const id = candidate.document.id;
    const parsed = parseCustomerBiteSaverRestaurantFavorite(
      candidate.document,
      {userId: value.userId, restaurantId: id},
    );
    const storedProjection = validProjectionById.get(id);
    const accountId = exactInternalId(storedProjection?.data.sourceDocumentId);
    const raw = accountId === null ? null : rawByAccount.get(accountId) ?? null;
    if (parsed === null || storedProjection === undefined ||
        accountId === null || raw === null) {
      return unavailableRestaurant(id);
    }
    const fresh = buildBiteSaverRestaurantIndex({
      sourceDocumentId: accountId,
      source: raw.data,
      now: value.now,
      identityKeyV1: identityKey(value.context),
    });
    const restaurant = fresh === null ? null : restaurantDto(fresh, id);
    if (
      fresh === null ||
      fresh.publicVisible !== true ||
      fresh.publicRestaurantId !== id ||
      restaurant === null
    ) {
      return unavailableRestaurant(id);
    }
    return Object.freeze({
      favoriteKind: "bitesaverRestaurant" as const,
      restaurantId: id,
      offerId: null,
      availability: "available" as const,
      restaurant,
      offer: null,
      accessToken: accessToken({
        codec: value.codec,
        userId: value.userId,
        section: "restaurants",
        restaurantId: id,
        offerId: null,
        authoritativeAccountId: accountId,
        nowMs: value.now.getTime(),
      }),
    });
  }));
}

async function resolveCouponEntries(value: {
  context: CustomerBiteSaverSessionContext;
  codec: SavedOpaqueCodec;
  userId: string;
  candidates: readonly SavedCandidate[];
  now: Date;
}): Promise<readonly CustomerBiteSaverSavedEntry[]> {
  const ids = value.candidates.map((candidate) => candidate.document.id);
  const projections = ids.length === 0
    ? []
    : await value.context.database.queryDocuments({
        collectionPath: biteSaverOfferIndexCollection,
        filters: Object.freeze([{
          field: "publicOfferId",
          operation: "in" as const,
          value: Object.freeze(ids),
        }]),
        orders: Object.freeze([]),
        limit: ids.length,
      });
  const byId = projectionMap(projections, "publicOfferId");
  const resolved = new Map<string, Readonly<{
    accountId: string;
    sourceDocumentId: string;
    publicRestaurantId: string;
  }>>();
  for (const id of ids) {
    const document = byId.get(id);
    const accountId = decodeDartUtf16FirestoreBytesOrderKey(
      document?.data.restaurantAccountId,
      1_500,
    );
    const sourceDocumentId = exactInternalId(document?.data.sourceDocumentId);
    const publicRestaurantId = document?.data.publicRestaurantId;
    if (
      document !== undefined &&
      accountId !== null &&
      sourceDocumentId !== null &&
      typeof publicRestaurantId === "string" &&
      publicRestaurantPattern.test(publicRestaurantId) &&
      document.data.source === "biteSaver" &&
      document.data.entityType === "offer" &&
      document.data.offerType === "coupon" &&
      document.data.customerOfferProjectionVersion ===
        customerBiteSaverOfferProjectionVersion &&
      document.data.publicOfferId === id &&
      customerBiteSaverOpaqueRestaurantId(
        identityKey(value.context),
        accountId,
      ) === publicRestaurantId &&
      customerBiteSaverOpaqueOfferId(
        identityKey(value.context),
        accountId,
        "coupon",
        sourceDocumentId,
      ) === id
    ) {
      resolved.set(id, Object.freeze({
        accountId,
        sourceDocumentId,
        publicRestaurantId,
      }));
    }
  }
  const accountIds = [...new Set([...resolved.values()].map((entry) =>
    entry.accountId))];
  const offerPaths = [...new Set([...resolved.values()].map((entry) =>
    `restaurant_accounts/${entry.accountId}/coupons/${entry.sourceDocumentId}`))];
  const [rawParents, rawOffers] = await Promise.all([
    value.context.database.getDocuments(
      accountIds.map((id) => `restaurant_accounts/${id}`),
    ),
    value.context.database.getDocuments(offerPaths),
  ]);
  const parentByAccount = new Map(accountIds.map((id, index) => [
    id,
    rawParents[index] ?? null,
  ]));
  const offerByPath = new Map(offerPaths.map((path, index) => [
    path,
    rawOffers[index] ?? null,
  ]));
  return Object.freeze(value.candidates.map((candidate) => {
    const offerId = candidate.document.id;
    const location = resolved.get(offerId);
    const favoriteRestaurantId = typeof candidate.document.data.restaurantId ===
        "string" && publicRestaurantPattern.test(
          candidate.document.data.restaurantId as string,
        )
      ? candidate.document.data.restaurantId as string
      : null;
    if (location === undefined) {
      return unavailableCoupon(offerId, favoriteRestaurantId);
    }
    const parsed = parseCustomerBiteSaverCouponFavorite(candidate.document, {
      userId: value.userId,
      restaurantId: location.publicRestaurantId,
      offerId,
    });
    const rawParent = parentByAccount.get(location.accountId) ?? null;
    const offerPath =
      `restaurant_accounts/${location.accountId}/coupons/` +
      location.sourceDocumentId;
    const rawOffer = offerByPath.get(offerPath) ?? null;
    if (parsed === null || rawParent === null || rawOffer === null) {
      return unavailableCoupon(offerId, favoriteRestaurantId);
    }
    const freshParent = buildBiteSaverRestaurantIndex({
      sourceDocumentId: location.accountId,
      source: rawParent.data,
      now: value.now,
      identityKeyV1: identityKey(value.context),
    });
    const freshOffer = buildBiteSaverCouponOfferIndex({
      restaurantAccountId: location.accountId,
      sourceDocumentId: location.sourceDocumentId,
      offer: rawOffer.data,
      restaurant: rawParent.data,
      now: value.now,
      identityKeyV1: identityKey(value.context),
    });
    const restaurant = freshParent === null
      ? null
      : restaurantDto(freshParent, location.publicRestaurantId);
    const offer = freshOffer === null ? null : offerDto(freshOffer, offerId);
    if (
      freshParent === null ||
      freshParent.publicVisible !== true ||
      freshParent.publicRestaurantId !== location.publicRestaurantId ||
      freshOffer === null ||
      freshOffer.publicVisible !== true ||
      freshOffer.customerDiscoverable !== true ||
      freshOffer.publicRestaurantId !== location.publicRestaurantId ||
      freshOffer.publicOfferId !== offerId ||
      restaurant === null ||
      offer === null
    ) {
      return unavailableCoupon(offerId, location.publicRestaurantId);
    }
    return Object.freeze({
      favoriteKind: "bitesaverCoupon" as const,
      restaurantId: location.publicRestaurantId,
      offerId,
      availability: "available" as const,
      restaurant,
      offer,
      accessToken: accessToken({
        codec: value.codec,
        userId: value.userId,
        section: "coupons",
        restaurantId: location.publicRestaurantId,
        offerId,
        authoritativeAccountId: location.accountId,
        nowMs: value.now.getTime(),
      }),
    });
  }));
}

export async function getCustomerBiteSaverSavedPageHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverSavedPageResult> {
  const request = parseSavedRequest(rawRequest);
  const userId = requireSignedInUserId(context.identity);
  const now = new Date(context.now?.() ?? Date.now());
  const codec = new SavedOpaqueCodec(context.discoveryKey, () => now.getTime());
  const cursor = openPageCursor({
    codec,
    token: request.cursor,
    userId,
    section: request.section,
  });
  const collection = request.section === "restaurants"
    ? "favorite_restaurants"
    : "favorite_coupons";
  const pattern = request.section === "restaurants"
    ? publicRestaurantPattern
    : publicOfferPattern;
  const candidates: SavedCandidate[] = [];
  let consumed = 0;
  let boundary = cursor;
  let hasMore = false;
  let sourceExhausted = false;
  while (
    consumed < savedCandidateBudget &&
    candidates.length < savedPageSize &&
    !sourceExhausted
  ) {
    const queryLimit = Math.min(
      savedPageSize + 1,
      savedCandidateBudget - consumed,
    );
    const documents = await context.database.queryDocuments({
      collectionPath: `user_profiles/${userId}/${collection}`,
      filters: Object.freeze([
        {field: "createdAt", operation: ">=" as const, value: Timestamp.fromMillis(0)},
        {
          field: "createdAt",
          operation: "<=" as const,
          value: new Timestamp(253_402_300_799, 999_999_999),
        },
      ]),
      orders: Object.freeze([
        {field: "createdAt", direction: "desc" as const},
        {field: "__name__", direction: "desc" as const},
      ]),
      ...(boundary === null
        ? {}
        : {startAfter: Object.freeze([
            boundary.createdAt,
            boundary.documentId,
          ])}),
      limit: queryLimit,
    });
    if (documents.length === 0) {
      sourceExhausted = true;
      break;
    }
    for (let index = 0; index < documents.length; index += 1) {
      const document = documents[index];
      const createdAt = timestampParts(document.data.createdAt);
      if (createdAt === null) {
        throw new CustomerBiteSaverContractError("failed-precondition");
      }
      consumed += 1;
      boundary = Object.freeze({
        createdAt: firestoreTimestamp(createdAt),
        documentId: document.id,
      });
      if (pattern.test(document.id)) {
        candidates.push(Object.freeze({document, createdAt}));
      }
      if (candidates.length === savedPageSize) {
        hasMore = index + 1 < documents.length || documents.length === queryLimit;
        break;
      }
    }
    if (candidates.length === savedPageSize) break;
    sourceExhausted = documents.length < queryLimit;
  }
  if (!sourceExhausted && candidates.length < savedPageSize) hasMore = true;
  const entries = request.section === "restaurants"
    ? await resolveRestaurantEntries({context, codec, userId, candidates, now})
    : await resolveCouponEntries({context, codec, userId, candidates, now});
  const nextCursor = !hasMore || boundary === null
    ? null
    : pageCursor({
        codec,
        userId,
        section: request.section,
        boundary: Object.freeze({
          createdAt: Object.freeze({
            seconds: boundary.createdAt.seconds,
            nanoseconds: boundary.createdAt.nanoseconds,
          }),
          documentId: boundary.documentId,
        }),
        nowMs: now.getTime(),
      });
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    section: request.section,
    entries,
    nextCursor,
    hasMore,
    partial: hasMore && entries.length < savedPageSize,
  });
}

function parseSavedMenuRequest(value: unknown): Readonly<{
  accessToken: string;
  cursor: string | null;
}> {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "clientRequestId",
      "accessToken",
      "cursor",
    ]) ||
    value.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    typeof value.clientRequestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(value.clientRequestId) ||
    typeof value.accessToken !== "string" ||
    value.accessToken.length > 32_768 ||
    (value.cursor !== null &&
      (typeof value.cursor !== "string" || value.cursor.length > 32_768))
  ) {
    return invalidArgument();
  }
  return Object.freeze({
    accessToken: value.accessToken,
    cursor: value.cursor as string | null,
  });
}

function menuCursor(value: {
  codec: SavedOpaqueCodec;
  userId: string;
  restaurantId: string;
  accessDigest: string;
  relationshipFingerprint: string;
  phase: number;
  afterId: string | null;
  nowMs: number;
  expiresAtMillis: number;
}): string {
  return value.codec.encode(Object.freeze({
    version: 1,
    purpose: "savedMenu",
    userId: value.userId,
    restaurantId: value.restaurantId,
    accessDigest: value.accessDigest,
    relationshipFingerprint: value.relationshipFingerprint,
    phase: value.phase,
    afterId: value.afterId,
    issuedAtMillis: value.nowMs,
    expiresAtMillis: Math.min(
      value.expiresAtMillis,
      value.nowMs + savedTokenLifetimeMilliseconds,
    ),
  }));
}

function openMenuCursor(value: {
  codec: SavedOpaqueCodec;
  token: string | null;
  access: SavedAccess;
  accessDigest: string;
  relationshipFingerprint: string;
}): Readonly<{phase: number; afterId: string | null}> {
  if (value.token === null) return Object.freeze({phase: 0, afterId: null});
  const payload = value.codec.open(value.token);
  if (
    !exactKeys(payload, [
      "version",
      "purpose",
      "userId",
      "restaurantId",
      "accessDigest",
      "relationshipFingerprint",
      "phase",
      "afterId",
      "issuedAtMillis",
      "expiresAtMillis",
    ]) ||
    payload.version !== 1 ||
    payload.purpose !== "savedMenu" ||
    payload.userId !== value.access.userId ||
    payload.restaurantId !== value.access.restaurantId ||
    payload.accessDigest !== value.accessDigest ||
    payload.relationshipFingerprint !== value.relationshipFingerprint ||
    typeof payload.phase !== "number" ||
    !Number.isInteger(payload.phase) ||
    payload.phase < 0 ||
    payload.phase >= customerBiteSaverMenuKinds.length ||
    (payload.afterId !== null && exactInternalId(payload.afterId) === null)
  ) {
    return invalidArgument();
  }
  return Object.freeze({
    phase: payload.phase,
    afterId: payload.afterId as string | null,
  });
}

export async function getCustomerBiteSaverSavedMenuPageHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverMenuPageResult> {
  const request = parseSavedMenuRequest(rawRequest);
  const userId = requireSignedInUserId(context.identity);
  const nowMs = context.now?.() ?? Date.now();
  const codec = new SavedOpaqueCodec(context.discoveryKey, () => nowMs);
  const access = openAccess({codec, token: request.accessToken, userId});
  const expectedRestaurantId = customerBiteSaverOpaqueRestaurantId(
    identityKey(context),
    access.authoritativeAccountId,
  );
  if (expectedRestaurantId !== access.restaurantId) return invalidArgument();
  if (access.offerId !== null) {
    const favorite = await context.database.getDocument(
      customerBiteSaverCouponFavoritePath(userId, access.offerId),
    );
    // The access token remains sufficient after a confirmed removal, but if a
    // record is present it must still be the same exact parent/type contract.
    if (favorite !== null && parseCustomerBiteSaverCouponFavorite(favorite, {
      userId,
      restaurantId: access.restaurantId,
      offerId: access.offerId,
    }) === null) {
      throw new CustomerBiteSaverContractError("permission-denied");
    }
  } else {
    const favorite = await context.database.getDocument(
      customerBiteSaverRestaurantFavoritePath(userId, access.restaurantId),
    );
    if (favorite !== null && parseCustomerBiteSaverRestaurantFavorite(favorite, {
      userId,
      restaurantId: access.restaurantId,
    }) === null) {
      throw new CustomerBiteSaverContractError("permission-denied");
    }
  }
  const source = await resolveCustomerBiteSaverSavedMenuSource({
    context,
    authoritativeAccountId: access.authoritativeAccountId,
    publicRestaurantId: access.restaurantId,
    now: new Date(nowMs),
  });
  const accessDigest = createHash("sha256")
    .update(request.accessToken, "utf8")
    .digest("hex");
  const boundary = openMenuCursor({
    codec,
    token: request.cursor,
    access,
    accessDigest,
    relationshipFingerprint: source.relationshipFingerprint,
  });
  if (source.state === "absent") {
    if (request.cursor !== null) return invalidArgument();
    return Object.freeze({
      schemaVersion: customerBiteSaverSearchSchemaVersion,
      state: "absent",
      attemptGeneration: 0,
      queryFingerprint: createQueryFingerprint({
        purpose: "savedMenu",
        accessDigest,
      }),
      restaurantId: access.restaurantId,
      menuStyle: source.style,
      entries: Object.freeze([]),
      nextCursor: null,
      hasMore: false,
    });
  }
  if (source.collectionRoot === null) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  let phase = boundary.phase;
  let afterId = boundary.afterId;
  let candidatesConsumed = 0;
  let candidateBytesConsumed = 0;
  const entries: CustomerBiteSaverMenuEntry[] = [];
  let hasMore = false;
  while (
    phase < customerBiteSaverMenuKinds.length &&
    candidatesConsumed < customerBiteSaverMenuCandidateBudget &&
    candidateBytesConsumed < customerBiteSaverMenuCandidateByteBudget
  ) {
    const queryLimit = Math.min(
      customerBiteSaverMenuPageSize + 1,
      customerBiteSaverMenuCandidateBudget - candidatesConsumed,
    );
    const documents = await context.database.queryDocuments({
      collectionPath: `${source.collectionRoot}/${customerBiteSaverMenuKinds[phase]}`,
      filters: Object.freeze([]),
      orders: Object.freeze([{field: "__name__", direction: "asc"}]),
      ...(afterId === null ? {} : {startAfter: Object.freeze([afterId])}),
      limit: queryLimit,
    });
    if (documents.length === 0) {
      phase += 1;
      afterId = null;
      continue;
    }
    for (const document of documents) {
      if (
        candidatesConsumed >= customerBiteSaverMenuCandidateBudget ||
        candidateBytesConsumed >= customerBiteSaverMenuCandidateByteBudget
      ) {
        hasMore = true;
        break;
      }
      candidatesConsumed += 1;
      candidateBytesConsumed += customerBiteSaverMenuCandidateBytes(document);
      const entry = customerBiteSaverPublicMenuEntry({
        context,
        relationshipFingerprint: source.relationshipFingerprint,
        privateSourceIdentities: source.privateSourceIdentities,
        kind: customerBiteSaverMenuKinds[phase],
        document,
      });
      if (entries.length >= customerBiteSaverMenuPageSize) {
        if (entry !== null) {
          hasMore = true;
          break;
        }
        afterId = document.id;
        continue;
      }
      afterId = document.id;
      if (entry !== null) entries.push(entry);
      if (candidateBytesConsumed >= customerBiteSaverMenuCandidateByteBudget) {
        hasMore = true;
        break;
      }
    }
    if (hasMore) break;
    if (
      candidatesConsumed >= customerBiteSaverMenuCandidateBudget ||
      candidateBytesConsumed >= customerBiteSaverMenuCandidateByteBudget
    ) {
      hasMore = true;
      break;
    }
    if (documents.length < queryLimit) {
      phase += 1;
      afterId = null;
    }
  }
  const currentSource = await resolveCustomerBiteSaverSavedMenuSource({
    context,
    authoritativeAccountId: access.authoritativeAccountId,
    publicRestaurantId: access.restaurantId,
    now: new Date(context.now?.() ?? Date.now()),
  });
  if (
    currentSource.state !== source.state ||
    currentSource.collectionRoot !== source.collectionRoot ||
    currentSource.relationshipFingerprint !== source.relationshipFingerprint
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The restaurant menu source changed. Refresh Saved and try again.",
    );
  }
  const nextCursor = hasMore
    ? menuCursor({
        codec,
        userId,
        restaurantId: access.restaurantId,
        accessDigest,
        relationshipFingerprint: source.relationshipFingerprint,
        phase,
        afterId,
        nowMs,
        expiresAtMillis: access.expiresAtMillis,
      })
    : null;
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    state: "available",
    attemptGeneration: 0,
    queryFingerprint: createQueryFingerprint({
      purpose: "savedMenu",
      accessDigest,
    }),
    restaurantId: access.restaurantId,
    menuStyle: source.style,
    entries: Object.freeze(entries),
    nextCursor,
    hasMore,
  });
}

type SavedRedemptionRequest = Readonly<{
  clientRequestId: string;
  accessToken: string;
  restaurantId: string;
  offerId: string;
  redemptionRequestId: string;
  timeZone: string;
  utcOffsetMinutes: number;
  currentCoordinates: Readonly<{
    latitude: number;
    longitude: number;
    capturedAtMillis: number;
  }> | null;
}>;

type SavedRedemptionStartRequest = SavedRedemptionRequest & Readonly<{
  validationId: string;
}>;

type SavedRedemptionTarget = Readonly<{
  authoritativeAccountId: string;
  sourceDocumentId: string;
  restaurantId: string;
  offerId: string;
}>;

type SavedRedemptionEvaluationContext = Readonly<{
  schemaVersion: number;
  sessionId: string;
  attemptGeneration: number;
  queryFingerprint: string;
  evaluationAtMillis: number;
  timeZone: string;
  utcOffsetMinutes: number;
  availabilityGeneration: string;
  validUntilExclusiveMillis: number;
  oncePerDayUnavailableWindows: readonly Readonly<{
    startAtMillisInclusive: number;
    endAtMillisExclusive: number;
  }>[];
}>;

type SavedValidationResponse = CustomerBiteSaverRedemptionValidationResult &
  Readonly<{evaluationContext: SavedRedemptionEvaluationContext}>;

const savedRedemptionReceiptLifetimeMilliseconds = 24 * 60 * 60 * 1_000;

function parseSavedRedemptionRequest(
  value: unknown,
  requireValidationId: false,
): SavedRedemptionRequest;
function parseSavedRedemptionRequest(
  value: unknown,
  requireValidationId: true,
): SavedRedemptionStartRequest;
function parseSavedRedemptionRequest(
  value: unknown,
  requireValidationId: boolean,
): SavedRedemptionRequest | SavedRedemptionStartRequest {
  const expected = [
    "schemaVersion",
    "clientRequestId",
    "accessToken",
    "restaurantId",
    "offerId",
    "redemptionRequestId",
    "timeZone",
    "utcOffsetMinutes",
    "currentCoordinates",
    ...(requireValidationId ? ["validationId"] : []),
  ];
  if (
    !isRecord(value) ||
    !exactKeys(value, expected) ||
    value.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    typeof value.clientRequestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(value.clientRequestId) ||
    typeof value.accessToken !== "string" ||
    value.accessToken.length > 32_768 ||
    typeof value.restaurantId !== "string" ||
    !publicRestaurantPattern.test(value.restaurantId) ||
    typeof value.offerId !== "string" ||
    !publicOfferPattern.test(value.offerId) ||
    typeof value.redemptionRequestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(value.redemptionRequestId) ||
    typeof value.timeZone !== "string" ||
    value.timeZone.length === 0 ||
    value.timeZone.length > 100 ||
    value.timeZone.trim() !== value.timeZone ||
    typeof value.utcOffsetMinutes !== "number" ||
    !Number.isSafeInteger(value.utcOffsetMinutes) ||
    value.utcOffsetMinutes < -840 ||
    value.utcOffsetMinutes > 840 ||
    (requireValidationId &&
      (typeof value.validationId !== "string" ||
        !/^bsv_[A-Za-z0-9_-]{43}$/u.test(value.validationId)))
  ) {
    return invalidArgument("The Saved redemption request is invalid.");
  }
  let currentCoordinates: SavedRedemptionRequest["currentCoordinates"] = null;
  if (value.currentCoordinates !== null) {
    if (
      !isRecord(value.currentCoordinates) ||
      !exactKeys(value.currentCoordinates, [
        "latitude",
        "longitude",
        "capturedAtMillis",
      ])
    ) {
      return invalidArgument("The Saved redemption location is invalid.");
    }
    const coordinates = validRestaurantCoordinates(
      value.currentCoordinates.latitude,
      value.currentCoordinates.longitude,
    );
    if (
      coordinates === null ||
      typeof value.currentCoordinates.capturedAtMillis !== "number" ||
      !Number.isSafeInteger(value.currentCoordinates.capturedAtMillis) ||
      value.currentCoordinates.capturedAtMillis < 0
    ) {
      return invalidArgument("The Saved redemption location is invalid.");
    }
    currentCoordinates = Object.freeze({
      ...coordinates,
      capturedAtMillis: value.currentCoordinates.capturedAtMillis,
    });
  }
  const base: SavedRedemptionRequest = Object.freeze({
    clientRequestId: value.clientRequestId,
    accessToken: value.accessToken,
    restaurantId: value.restaurantId,
    offerId: value.offerId,
    redemptionRequestId: value.redemptionRequestId,
    timeZone: value.timeZone,
    utcOffsetMinutes: value.utcOffsetMinutes,
    currentCoordinates,
  });
  return requireValidationId
    ? Object.freeze({
        ...base,
        validationId: value.validationId as string,
      })
    : base;
}

function savedRedemptionRequestFingerprint(
  request: SavedRedemptionRequest,
): string {
  return createQueryFingerprint({
    purpose: "savedRedemptionValidation",
    restaurantId: request.restaurantId,
    offerId: request.offerId,
    redemptionRequestId: request.redemptionRequestId,
    timeZone: request.timeZone,
    utcOffsetMinutes: request.utcOffsetMinutes,
    currentCoordinates: request.currentCoordinates === null
      ? null
      : {
          latitude: String(request.currentCoordinates.latitude),
          longitude: String(request.currentCoordinates.longitude),
          capturedAtMillis: request.currentCoordinates.capturedAtMillis,
        },
    accessDigest: createHash("sha256")
      .update(request.accessToken, "utf8")
      .digest("hex"),
  });
}

function savedRedemptionStartFingerprint(
  request: SavedRedemptionStartRequest,
): string {
  return createQueryFingerprint({
    purpose: "savedRedemptionStart",
    validationFingerprint: savedRedemptionRequestFingerprint(request),
    validationId: request.validationId,
  });
}

function savedRedemptionUserBinding(
  context: CustomerBiteSaverSessionContext,
  userId: string,
): string {
  return createHash("sha256")
    .update(context.discoveryKey)
    .update("\0saved-redemption-user\0", "utf8")
    .update(userId, "utf8")
    .digest("hex");
}

function savedRedemptionValidationId(
  context: CustomerBiteSaverSessionContext,
  userBinding: string,
  request: SavedRedemptionRequest,
): string {
  return customerBiteSaverDeterministicId(
    context.discoveryKey,
    "bsv",
    "savedRedemptionValidation",
    [userBinding, request.redemptionRequestId],
  );
}

function savedRedemptionStartReceiptId(
  context: CustomerBiteSaverSessionContext,
  userBinding: string,
  request: SavedRedemptionRequest,
): string {
  return customerBiteSaverDeterministicId(
    context.discoveryKey,
    "bssrr",
    "savedRedemptionStartReceipt",
    [userBinding, request.redemptionRequestId],
  );
}

async function resolveSavedRedemptionTarget(value: {
  context: CustomerBiteSaverSessionContext;
  access: SavedAccess;
  request: SavedRedemptionRequest;
}): Promise<SavedRedemptionTarget | null> {
  if (
    value.access.section !== "coupons" ||
    value.access.restaurantId !== value.request.restaurantId ||
    value.access.offerId !== value.request.offerId ||
    customerBiteSaverOpaqueRestaurantId(
      identityKey(value.context),
      value.access.authoritativeAccountId,
    ) !== value.request.restaurantId
  ) {
    return null;
  }
  const documents = await value.context.database.queryDocuments({
    collectionPath: biteSaverOfferIndexCollection,
    filters: Object.freeze([{
      field: "publicOfferId",
      operation: "in" as const,
      value: Object.freeze([value.request.offerId]),
    }]),
    orders: Object.freeze([]),
    limit: 2,
  });
  if (documents.length !== 1) return null;
  const projection = documents[0].data;
  const authoritativeAccountId = decodeDartUtf16FirestoreBytesOrderKey(
    projection.restaurantAccountId,
    1_500,
  );
  const sourceDocumentId = exactInternalId(projection.sourceDocumentId);
  if (
    authoritativeAccountId === null ||
    sourceDocumentId === null ||
    authoritativeAccountId !== value.access.authoritativeAccountId ||
    projection.source !== "biteSaver" ||
    projection.entityType !== "offer" ||
    projection.offerType !== "coupon" ||
    projection.customerOfferProjectionVersion !==
      customerBiteSaverOfferProjectionVersion ||
    projection.publicRestaurantId !== value.request.restaurantId ||
    projection.publicOfferId !== value.request.offerId ||
    customerBiteSaverOpaqueOfferId(
      identityKey(value.context),
      authoritativeAccountId,
      "coupon",
      sourceDocumentId,
    ) !== value.request.offerId
  ) {
    return null;
  }
  return Object.freeze({
    authoritativeAccountId,
    sourceDocumentId,
    restaurantId: value.request.restaurantId,
    offerId: value.request.offerId,
  });
}

function savedUsageState(value: {
  document: CustomerBiteSaverStoredDocument | null;
  userId: string;
  restaurantId: string;
  offerId: string;
}): CustomerBiteSaverUsageState {
  if (value.document === null) {
    return Object.freeze({
      known: true,
      lastRedeemedAt: null,
      timerStartedAt: null,
      generation: createQueryFingerprint({
        purpose: "savedRedemptionUsage",
        offerId: value.offerId,
        state: "missing",
      }),
    });
  }
  const parsed = parseCustomerBiteSaverCouponRedemption(value.document, {
    userId: value.userId,
    restaurantId: value.restaurantId,
    offerId: value.offerId,
  });
  if (parsed === null) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The BiteSaver redemption usage state is invalid.",
    );
  }
  return Object.freeze({
    known: true,
    lastRedeemedAt: null,
    timerStartedAt: parsed.timerStartedAt,
    generation: createQueryFingerprint({
      purpose: "savedRedemptionUsage",
      offerId: value.offerId,
      redemptionId: parsed.redemptionId,
      timerStartedAtMillis: parsed.timerStartedAt.getTime(),
      timerExpiresAtMillis: parsed.timerExpiresAt.getTime(),
    }),
  });
}

function currentSavedRedemptionSource(value: {
  context: CustomerBiteSaverSessionContext;
  target: SavedRedemptionTarget;
  parentDocument: CustomerBiteSaverStoredDocument | null;
  offerDocument: CustomerBiteSaverStoredDocument | null;
  now: Date;
}): Readonly<{
  parent: Readonly<Record<string, unknown>>;
  offer: Readonly<Record<string, unknown>>;
  restaurantCoordinates: Readonly<{latitude: number; longitude: number}>;
  usagePolicy: CustomerBiteSaverNormalizedUsagePolicy;
}> | null {
  if (value.parentDocument === null || value.offerDocument === null) return null;
  const parent = buildBiteSaverRestaurantIndex({
    sourceDocumentId: value.target.authoritativeAccountId,
    source: value.parentDocument.data,
    now: value.now,
    identityKeyV1: identityKey(value.context),
  });
  const offer = buildBiteSaverCouponOfferIndex({
    restaurantAccountId: value.target.authoritativeAccountId,
    sourceDocumentId: value.target.sourceDocumentId,
    offer: value.offerDocument.data,
    restaurant: value.parentDocument.data,
    now: value.now,
    identityKeyV1: identityKey(value.context),
  });
  const coordinates = validRestaurantCoordinates(
    parent?.latitude,
    parent?.longitude,
  );
  const usagePolicy = normalizeCustomerBiteSaverUsagePolicy(
    "coupon",
    offer?.usageRule,
  );
  if (
    parent === null ||
    parent.publicVisible !== true ||
    parent.publicProjectionVersion !== customerBiteSaverRestaurantProjectionVersion ||
    parent.publicRestaurantId !== value.target.restaurantId ||
    offer === null ||
    offer.customerOfferProjectionVersion !==
      customerBiteSaverOfferProjectionVersion ||
    offer.customerDiscoverable !== true ||
    offer.publicRestaurantId !== value.target.restaurantId ||
    offer.publicOfferId !== value.target.offerId ||
    offer.sourceDocumentId !== value.target.sourceDocumentId ||
    coordinates === null ||
    usagePolicy === null
  ) {
    return null;
  }
  const availabilityOffer: Record<string, unknown> = {
    ...value.offerDocument.data,
  };
  for (const field of [
    "startTime",
    "endTime",
    "usageRule",
    "isProximityOnly",
    "proximityRadiusMiles",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(offer, field)) {
      availabilityOffer[field] = offer[field];
    }
  }
  return Object.freeze({
    parent,
    offer: Object.freeze(availabilityOffer),
    restaurantCoordinates: coordinates,
    usagePolicy,
  });
}

function savedRedemptionCalendar(value: {
  request: SavedRedemptionRequest;
  evaluationAtMillis: number;
  usagePolicy: CustomerBiteSaverNormalizedUsagePolicy | null;
  validUntilExclusiveMillis: number;
}): SavedRedemptionEvaluationContext {
  let calendar;
  try {
    calendar = customerBiteSaverUsageEvaluationCalendar({
      evaluationAtMillis: value.evaluationAtMillis,
      timeZone: value.request.timeZone,
    });
  } catch {
    return invalidArgument("The customer time context is invalid.");
  }
  if (calendar.utcOffsetMinutes !== value.request.utcOffsetMinutes) {
    return invalidArgument("The customer time context is stale.");
  }
  const validUntilExclusiveMillis = value.usagePolicy === "oncePerDay"
    ? Math.min(
        value.validUntilExclusiveMillis,
        calendar.validUntilExclusiveMillis,
      )
    : value.validUntilExclusiveMillis;
  if (validUntilExclusiveMillis <= value.evaluationAtMillis) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The Saved redemption validation expired.",
    );
  }
  const sessionId = customerBiteSaverDeterministicId(
    new Uint8Array(createHash("sha256")
      .update(value.request.accessToken, "utf8")
      .digest()),
    "bss",
    "savedRedemptionEvaluation",
    [value.request.restaurantId, value.request.offerId],
  );
  const queryFingerprint = createQueryFingerprint({
    purpose: "savedRedemptionEvaluation",
    restaurantId: value.request.restaurantId,
    offerId: value.request.offerId,
    redemptionRequestId: value.request.redemptionRequestId,
  });
  const availabilityGeneration = createQueryFingerprint({
    purpose: "savedRedemptionAvailability",
    queryFingerprint,
    evaluationAtMillis: value.evaluationAtMillis,
    validUntilExclusiveMillis,
  });
  return Object.freeze({
    schemaVersion: calendar.schemaVersion,
    sessionId,
    attemptGeneration: 0,
    queryFingerprint,
    evaluationAtMillis: value.evaluationAtMillis,
    timeZone: calendar.timeZone,
    utcOffsetMinutes: calendar.utcOffsetMinutes,
    availabilityGeneration,
    validUntilExclusiveMillis,
    oncePerDayUnavailableWindows: calendar.oncePerDayUnavailableWindows,
  });
}

function validationReceiptPath(validationId: string): string {
  return `${privateCustomerBiteSaverActiveSessionCollection}/${validationId}`;
}

function startReceiptPath(receiptId: string): string {
  return `${privateCustomerBiteSaverActiveSessionCollection}/${receiptId}`;
}

function storedResponse(
  document: CustomerBiteSaverStoredDocument | null,
  expected: {
    role: "savedRedemptionValidationReceipt" | "savedRedemptionStartReceipt";
    documentId: string;
    userBinding: string;
    requestFingerprint: string;
    nowMillis: number;
  },
): Readonly<Record<string, unknown>> | null {
  if (document === null) return null;
  const data = document.data;
  const keys = Object.keys(data).sort();
  const expectedKeys = [
    "createdAt",
    "expiresAt",
    "protocolVersion",
    "requestFingerprint",
    "response",
    "responseFingerprint",
    "role",
    "schemaVersion",
    "state",
    "updatedAt",
    "userBinding",
  ];
  const createdAt = dateValue(data.createdAt);
  const updatedAt = dateValue(data.updatedAt);
  const expiresAt = dateValue(data.expiresAt);
  if (
    document.id !== expected.documentId ||
    document.path !== startReceiptPath(expected.documentId) ||
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    data.role !== expected.role ||
    data.state !== "complete" ||
    data.userBinding !== expected.userBinding ||
    typeof data.userBinding !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.userBinding) ||
    data.requestFingerprint !== expected.requestFingerprint ||
    typeof data.requestFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.requestFingerprint) ||
    !isRecord(data.response) ||
    typeof data.responseFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.responseFingerprint) ||
    data.responseFingerprint !== createQueryFingerprint(data.response) ||
    createdAt === null ||
    updatedAt === null ||
    expiresAt === null ||
    updatedAt.getTime() < createdAt.getTime() ||
    expiresAt.getTime() <= createdAt.getTime() ||
    expected.nowMillis >= expiresAt.getTime()
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The Saved redemption receipt is invalid or expired.",
    );
  }
  return data.response;
}

function receiptDocument(value: {
  role: "savedRedemptionValidationReceipt" | "savedRedemptionStartReceipt";
  userBinding: string;
  requestFingerprint: string;
  response: Readonly<Record<string, unknown>>;
  nowMillis: number;
  expiresAtMillis: number;
}): Readonly<Record<string, unknown>> {
  const now = new Date(value.nowMillis);
  const expiresAt = new Date(value.expiresAtMillis);
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    role: value.role,
    state: "complete",
    userBinding: value.userBinding,
    requestFingerprint: value.requestFingerprint,
    response: value.response,
    responseFingerprint: createQueryFingerprint(value.response),
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });
}

function validationResponseFromStored(
  value: Readonly<Record<string, unknown>>,
  request: SavedRedemptionRequest,
): SavedValidationResponse {
  if (
    value.restaurantId !== request.restaurantId ||
    value.offerId !== request.offerId ||
    typeof value.allowed !== "boolean" ||
    typeof value.reason !== "string" ||
    !isRecord(value.evaluationContext)
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  return value as SavedValidationResponse;
}

function startResponseFromStored(
  value: Readonly<Record<string, unknown>>,
  request: SavedRedemptionRequest,
): CustomerBiteSaverRedemptionStartResult {
  const keys = Object.keys(value).sort();
  const timed = value.status === "started" || value.status === "active";
  if (
    keys.length !== 7 ||
    keys.some((key, index) => key !== [
      "offerId",
      "redemptionId",
      "restaurantId",
      "schemaVersion",
      "status",
      "timerExpiresAtMillis",
      "timerStartedAtMillis",
    ][index]) ||
    value.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    value.restaurantId !== request.restaurantId ||
    value.offerId !== request.offerId ||
    !publicRestaurantPattern.test(value.restaurantId) ||
    !publicOfferPattern.test(value.offerId) ||
    (value.status !== "started" &&
      value.status !== "active" &&
      value.status !== "unlimited") ||
    (timed && (
      typeof value.redemptionId !== "string" ||
      !/^bsrd_[A-Za-z0-9_-]{43}$/u.test(value.redemptionId) ||
      typeof value.timerStartedAtMillis !== "number" ||
      !Number.isSafeInteger(value.timerStartedAtMillis) ||
      value.timerStartedAtMillis < 0 ||
      typeof value.timerExpiresAtMillis !== "number" ||
      !Number.isSafeInteger(value.timerExpiresAtMillis) ||
      value.timerExpiresAtMillis !== value.timerStartedAtMillis +
        customerBiteSaverRedemptionTimerMilliseconds
    )) ||
    (!timed && (
      value.redemptionId !== null ||
      value.timerStartedAtMillis !== null ||
      value.timerExpiresAtMillis !== null
    ))
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  return value as CustomerBiteSaverRedemptionStartResult;
}

function unavailableSavedValidation(value: {
  request: SavedRedemptionRequest;
  nowMillis: number;
  reason: string;
  usagePolicy?: CustomerBiteSaverNormalizedUsagePolicy | null;
  activeTimerExpiresAtMillis?: number | null;
  nextAvailableAtMillis?: number | null;
  evaluationContext: SavedRedemptionEvaluationContext;
}): SavedValidationResponse {
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    restaurantId: value.request.restaurantId,
    offerId: value.request.offerId,
    allowed: false,
    reason: value.reason,
    usagePolicy: value.usagePolicy ?? null,
    evaluatedAtMillis: value.nowMillis,
    activeTimerExpiresAtMillis: value.activeTimerExpiresAtMillis ?? null,
    nextAvailableAtMillis: value.nextAvailableAtMillis ?? null,
    validationId: null,
    validationExpiresAtMillis: null,
    evaluationContext: value.evaluationContext,
  });
}

export async function validateCustomerBiteSaverSavedOfferRedemptionStartHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<SavedValidationResponse> {
  const request = parseSavedRedemptionRequest(rawRequest, false);
  const userId = requireSignedInUserId(context.identity);
  const initialNowMillis = context.now?.() ?? Date.now();
  const codec = new SavedOpaqueCodec(context.discoveryKey, () => initialNowMillis);
  const access = openAccess({codec, token: request.accessToken, userId});
  const target = await resolveSavedRedemptionTarget({context, access, request});
  const userBinding = savedRedemptionUserBinding(context, userId);
  const requestFingerprint = savedRedemptionRequestFingerprint(request);
  const validationId = savedRedemptionValidationId(
    context,
    userBinding,
    request,
  );
  const receiptPath = validationReceiptPath(validationId);
  const favoritePath = customerBiteSaverCouponFavoritePath(
    userId,
    request.offerId,
  );
  const rawParentPath = target === null
    ? null
    : `restaurant_accounts/${target.authoritativeAccountId}`;
  const rawOfferPath = target === null
    ? null
    : `${rawParentPath}/coupons/${target.sourceDocumentId}`;
  const usagePath = customerBiteSaverCouponRedemptionPath(
    userId,
    request.offerId,
  );
  return context.database.runTransaction(async (transaction) => {
    const paths = [
      receiptPath,
      favoritePath,
      ...(rawParentPath === null ? [] : [rawParentPath, rawOfferPath!, usagePath]),
    ];
    const documents = await transaction.getDocuments(paths);
    const mutationNowMillis = context.now?.() ?? Date.now();
    const replay = storedResponse(documents[0], {
      role: "savedRedemptionValidationReceipt",
      documentId: validationId,
      userBinding,
      requestFingerprint,
      nowMillis: mutationNowMillis,
    });
    if (replay !== null) {
      return validationResponseFromStored(replay, request);
    }
    const favorite = documents[1];
    if (
      favorite === null ||
      parseCustomerBiteSaverCouponFavorite(favorite, {
        userId,
        restaurantId: request.restaurantId,
        offerId: request.offerId,
      }) === null
    ) {
      throw new CustomerBiteSaverContractError(
        "permission-denied",
        "The exact Saved coupon is required to use this path.",
      );
    }
    let usagePolicy: CustomerBiteSaverNormalizedUsagePolicy | null = null;
    let response: SavedValidationResponse;
    if (target === null) {
      const evaluationContext = savedRedemptionCalendar({
        request,
        evaluationAtMillis: mutationNowMillis,
        usagePolicy: null,
        validUntilExclusiveMillis: Math.min(
          mutationNowMillis + 60_000,
          access.expiresAtMillis,
        ),
      });
      response = unavailableSavedValidation({
        request,
        nowMillis: mutationNowMillis,
        reason: "offerUnavailable",
        evaluationContext,
      });
    } else {
      const source = currentSavedRedemptionSource({
        context,
        target,
        parentDocument: documents[2],
        offerDocument: documents[3],
        now: new Date(mutationNowMillis),
      });
      usagePolicy = source?.usagePolicy ?? null;
      const usage = savedUsageState({
        document: documents[4],
        userId,
        restaurantId: request.restaurantId,
        offerId: request.offerId,
      });
      const decision = source === null
        ? null
        : evaluateCustomerBiteSaverOfferAvailability({
            offerType: "coupon",
            offer: source.offer,
            parentEligible: true,
            now: new Date(mutationNowMillis),
            timeZone: request.timeZone,
            locationMode: "current",
            restaurantCoordinates: source.restaurantCoordinates,
            currentCoordinates: request.currentCoordinates,
            currentCoordinatesCapturedAt: request.currentCoordinates === null
              ? null
              : new Date(request.currentCoordinates.capturedAtMillis),
            usage,
            requireFreshLocation: true,
          });
      const validationExpiresAtMillis = Math.min(
        mutationNowMillis + 60_000,
        access.expiresAtMillis,
        decision?.eligibilityExpiresAtMs ?? Number.MAX_SAFE_INTEGER,
      );
      const evaluationContext = savedRedemptionCalendar({
        request,
        evaluationAtMillis: mutationNowMillis,
        usagePolicy,
        validUntilExclusiveMillis: validationExpiresAtMillis,
      });
      if (source === null || decision === null) {
        response = unavailableSavedValidation({
          request,
          nowMillis: mutationNowMillis,
          reason: "offerUnavailable",
          evaluationContext,
        });
      } else if (!decision.visible || !decision.redeemable) {
        response = unavailableSavedValidation({
          request,
          nowMillis: mutationNowMillis,
          reason: decision.reason,
          usagePolicy,
          activeTimerExpiresAtMillis: decision.activeTimerExpiresAtMs,
          nextAvailableAtMillis: decision.nextAvailableAtMs,
          evaluationContext,
        });
      } else {
        response = Object.freeze({
          schemaVersion: customerBiteSaverSearchSchemaVersion,
          restaurantId: request.restaurantId,
          offerId: request.offerId,
          allowed: true,
          reason: "available",
          usagePolicy,
          evaluatedAtMillis: mutationNowMillis,
          activeTimerExpiresAtMillis: decision.activeTimerExpiresAtMs,
          nextAvailableAtMillis: decision.nextAvailableAtMs,
          validationId,
          validationExpiresAtMillis:
            evaluationContext.validUntilExclusiveMillis,
          evaluationContext,
        });
      }
    }
    transaction.createDocument(receiptPath, receiptDocument({
      role: "savedRedemptionValidationReceipt",
      userBinding,
      requestFingerprint,
      response,
      nowMillis: mutationNowMillis,
      expiresAtMillis: Math.min(
        access.expiresAtMillis,
        mutationNowMillis + savedRedemptionReceiptLifetimeMilliseconds,
      ),
    }));
    return response;
  });
}

function newSavedRedemptionId(
  context: CustomerBiteSaverSessionContext,
): string {
  const entropy = (context.randomSource ?? randomBytes)(32);
  if (!(entropy instanceof Uint8Array) || entropy.length !== 32) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  return `bsrd_${Buffer.from(entropy).toString("base64url")}`;
}

export async function startCustomerBiteSaverSavedOfferRedemptionHandler(
  rawRequest: unknown,
  context: CustomerBiteSaverSessionContext,
): Promise<CustomerBiteSaverRedemptionStartResult> {
  const request = parseSavedRedemptionRequest(rawRequest, true);
  const userId = requireSignedInUserId(context.identity);
  const initialNowMillis = context.now?.() ?? Date.now();
  const codec = new SavedOpaqueCodec(context.discoveryKey, () => initialNowMillis);
  const access = openAccess({codec, token: request.accessToken, userId});
  const userBinding = savedRedemptionUserBinding(context, userId);
  const validationFingerprint = savedRedemptionRequestFingerprint(request);
  const expectedValidationId = savedRedemptionValidationId(
    context,
    userBinding,
    request,
  );
  if (request.validationId !== expectedValidationId) return invalidArgument();
  const requestFingerprint = savedRedemptionStartFingerprint(request);
  const receiptId = savedRedemptionStartReceiptId(
    context,
    userBinding,
    request,
  );
  const receiptPath = startReceiptPath(receiptId);
  const committed = storedResponse(
    await context.database.getDocument(receiptPath),
    {
      role: "savedRedemptionStartReceipt",
      documentId: receiptId,
      userBinding,
      requestFingerprint,
      nowMillis: context.now?.() ?? Date.now(),
    },
  );
  if (committed !== null) return startResponseFromStored(committed, request);

  const target = await resolveSavedRedemptionTarget({context, access, request});
  if (target === null) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "The Saved coupon is no longer available to start.",
    );
  }
  const favoritePath = customerBiteSaverCouponFavoritePath(
    userId,
    request.offerId,
  );
  const validationPath = validationReceiptPath(request.validationId);
  const parentPath = `restaurant_accounts/${target.authoritativeAccountId}`;
  const offerPath = `${parentPath}/coupons/${target.sourceDocumentId}`;
  const usagePath = customerBiteSaverCouponRedemptionPath(
    userId,
    request.offerId,
  );
  const proposedRedemptionId = newSavedRedemptionId(context);
  return context.database.runTransaction(async (transaction) => {
    const documents = await transaction.getDocuments([
      receiptPath,
      validationPath,
      favoritePath,
      parentPath,
      offerPath,
      usagePath,
    ]);
    const mutationNowMillis = context.now?.() ?? Date.now();
    const replay = storedResponse(documents[0], {
      role: "savedRedemptionStartReceipt",
      documentId: receiptId,
      userBinding,
      requestFingerprint,
      nowMillis: mutationNowMillis,
    });
    if (replay !== null) return startResponseFromStored(replay, request);
    const validationStored = storedResponse(documents[1], {
      role: "savedRedemptionValidationReceipt",
      documentId: request.validationId,
      userBinding,
      requestFingerprint: validationFingerprint,
      nowMillis: mutationNowMillis,
    });
    if (validationStored === null) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The Saved redemption validation is missing.",
      );
    }
    const validation = validationResponseFromStored(validationStored, request);
    if (
      validation.allowed !== true ||
      validation.validationId !== request.validationId ||
      typeof validation.validationExpiresAtMillis !== "number" ||
      mutationNowMillis >= validation.validationExpiresAtMillis
    ) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The Saved redemption validation expired or was denied.",
      );
    }
    const favorite = documents[2];
    if (
      favorite === null ||
      parseCustomerBiteSaverCouponFavorite(favorite, {
        userId,
        restaurantId: request.restaurantId,
        offerId: request.offerId,
      }) === null
    ) {
      throw new CustomerBiteSaverContractError(
        "permission-denied",
        "The exact Saved coupon is required to use this path.",
      );
    }
    const source = currentSavedRedemptionSource({
      context,
      target,
      parentDocument: documents[3],
      offerDocument: documents[4],
      now: new Date(mutationNowMillis),
    });
    if (source === null) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The Saved coupon is no longer available to start.",
      );
    }
    const usage = savedUsageState({
      document: documents[5],
      userId,
      restaurantId: request.restaurantId,
      offerId: request.offerId,
    });
    const calendar = savedRedemptionCalendar({
      request,
      evaluationAtMillis: mutationNowMillis,
      usagePolicy: source.usagePolicy,
      validUntilExclusiveMillis: Math.min(
        validation.validationExpiresAtMillis,
        access.expiresAtMillis,
      ),
    });
    const decision = evaluateCustomerBiteSaverOfferAvailability({
      offerType: "coupon",
      offer: source.offer,
      parentEligible: true,
      now: new Date(mutationNowMillis),
      timeZone: request.timeZone,
      locationMode: "current",
      restaurantCoordinates: source.restaurantCoordinates,
      currentCoordinates: request.currentCoordinates,
      currentCoordinatesCapturedAt: request.currentCoordinates === null
        ? null
        : new Date(request.currentCoordinates.capturedAtMillis),
      usage,
      requireFreshLocation: true,
    });
    if (
      !decision.visible ||
      !decision.redeemable ||
      (decision.eligibilityExpiresAtMs !== null &&
        mutationNowMillis >= decision.eligibilityExpiresAtMs) ||
      mutationNowMillis >= calendar.validUntilExclusiveMillis
    ) {
      throw new CustomerBiteSaverContractError(
        "failed-precondition",
        "The Saved coupon is no longer available to start.",
      );
    }
    const canonicalUsage = documents[5] === null
      ? null
      : parseCustomerBiteSaverCouponRedemption(documents[5]!, {
          userId,
          restaurantId: request.restaurantId,
          offerId: request.offerId,
        });
    let result: CustomerBiteSaverRedemptionStartResult;
    let usageWrite = null;
    if (source.usagePolicy === "unlimited") {
      result = Object.freeze({
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        restaurantId: request.restaurantId,
        offerId: request.offerId,
        redemptionId: null,
        status: "unlimited",
        timerStartedAtMillis: null,
        timerExpiresAtMillis: null,
      });
    } else if (
      canonicalUsage !== null &&
      canonicalUsage.timerExpiresAt.getTime() > mutationNowMillis
    ) {
      result = Object.freeze({
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        restaurantId: request.restaurantId,
        offerId: request.offerId,
        redemptionId: canonicalUsage.redemptionId,
        status: "active",
        timerStartedAtMillis: canonicalUsage.timerStartedAt.getTime(),
        timerExpiresAtMillis: canonicalUsage.timerExpiresAt.getTime(),
      });
    } else {
      usageWrite = buildCustomerBiteSaverCouponRedemption({
        userId,
        restaurantId: request.restaurantId,
        offerId: request.offerId,
        redemptionId: proposedRedemptionId,
        timerStartedAt: new Date(mutationNowMillis),
        createdAt: canonicalUsage?.createdAt ?? new Date(mutationNowMillis),
      });
      result = Object.freeze({
        schemaVersion: customerBiteSaverSearchSchemaVersion,
        restaurantId: request.restaurantId,
        offerId: request.offerId,
        redemptionId: usageWrite.redemptionId,
        status: "started",
        timerStartedAtMillis: usageWrite.timerStartedAt.getTime(),
        timerExpiresAtMillis: usageWrite.timerExpiresAt.getTime(),
      });
    }
    if (usageWrite !== null) transaction.setDocument(usagePath, usageWrite);
    transaction.createDocument(receiptPath, receiptDocument({
      role: "savedRedemptionStartReceipt",
      userBinding,
      requestFingerprint,
      response: result,
      nowMillis: mutationNowMillis,
      expiresAtMillis: Math.min(
        access.expiresAtMillis,
        mutationNowMillis + savedRedemptionReceiptLifetimeMilliseconds,
      ),
    }));
    return result;
  });
}

export const customerBiteSaverSavedInternals = Object.freeze({
  savedPageSize,
  savedCandidateBudget,
  parseSavedRequest,
  parseSavedRedemptionRequest,
  savedRedemptionRequestFingerprint,
  savedRedemptionStartFingerprint,
  openAccess,
});
