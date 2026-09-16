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
  customerBiteSaverSearchSchemaVersion,
  CustomerBiteSaverContractError,
} from "./customer_bitesaver_search_contract.js";
import {
  customerBiteSaverOpaqueOfferId,
  customerBiteSaverOpaqueRestaurantId,
  type CustomerBiteSaverIdentityKeyV1,
} from "./customer_bitesaver_public_identity.js";
import {
  customerBiteSaverCouponFavoritePath,
  customerBiteSaverRestaurantFavoritePath,
  parseCustomerBiteSaverCouponFavorite,
  parseCustomerBiteSaverRestaurantFavorite,
} from "./customer_bitesaver_customer_data_contract.js";
import {
  normalizeCustomerBiteSaverUsagePolicy,
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

export const customerBiteSaverSavedInternals = Object.freeze({
  savedPageSize,
  savedCandidateBudget,
  parseSavedRequest,
  openAccess,
});
