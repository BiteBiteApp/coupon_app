import { createHash, randomBytes } from "node:crypto";

export const restaurantInviteBaseUrl = "https://go.bitestar.app/invite";
export const restaurantCustomerBaseUrl = "https://go.bitestar.app/r";
export const biteScoreCatalogRestaurantIdField =
  "biteScoreCatalogRestaurantId" as const;
export const biteSaverCatalogBindingIdField =
  "biteSaverCatalogBindingId" as const;

const biteSaverCatalogBindingIdPattern = /^[A-Za-z0-9_-]{43}$/u;
const maximumFirestoreDocumentIdBytes = 1_500;
const unsupportedFirestoreDocumentIdCharacterPattern = /[\p{Cc}\p{Cf}]/u;
const explicitlyRejectedFirestoreDocumentIdCodePointPattern = /[\u17b4\u17b5]/u;

function hasWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) {
        return false;
      }
      const trailingCodeUnit = value.charCodeAt(index + 1);
      if (trailingCodeUnit < 0xdc00 || trailingCodeUnit > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function generateBiteSaverCatalogBindingId(): string {
  return randomBytes(32).toString("base64url");
}

export function isValidBiteSaverCatalogBindingId(
  value: unknown,
): value is string {
  return typeof value === "string" &&
    biteSaverCatalogBindingIdPattern.test(value);
}

export function readBiteScoreCatalogRestaurantId(
  value: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    explicitlyRejectedFirestoreDocumentIdCodePointPattern.test(value) ||
    unsupportedFirestoreDocumentIdCharacterPattern.test(value) ||
    !hasWellFormedUtf16(value) ||
    Buffer.byteLength(value, "utf8") > maximumFirestoreDocumentIdBytes
  ) {
    return null;
  }
  return value;
}

export type BiteSaverAccountCatalogBindingState =
  | Readonly<{ type: "unbound" }>
  | Readonly<{
    type: "bound";
    biteScoreCatalogRestaurantId: string;
    biteSaverCatalogBindingId: string;
  }>
  | Readonly<{ type: "invalid" }>;

export function biteSaverAccountCatalogBindingState(
  data: Readonly<Record<string, unknown>>,
): BiteSaverAccountCatalogBindingState {
  const hasCatalogRestaurantId = Object.prototype.hasOwnProperty.call(
    data,
    biteScoreCatalogRestaurantIdField,
  );
  const hasBindingId = Object.prototype.hasOwnProperty.call(
    data,
    biteSaverCatalogBindingIdField,
  );
  if (!hasCatalogRestaurantId && !hasBindingId) {
    return Object.freeze({ type: "unbound" });
  }
  if (!hasCatalogRestaurantId || !hasBindingId) {
    return Object.freeze({ type: "invalid" });
  }

  const biteScoreCatalogRestaurantId = readBiteScoreCatalogRestaurantId(
    data[biteScoreCatalogRestaurantIdField],
  );
  const biteSaverCatalogBindingId = data[biteSaverCatalogBindingIdField];
  if (
    biteScoreCatalogRestaurantId === null ||
    !isValidBiteSaverCatalogBindingId(biteSaverCatalogBindingId)
  ) {
    return Object.freeze({ type: "invalid" });
  }
  return Object.freeze({
    type: "bound",
    biteScoreCatalogRestaurantId,
    biteSaverCatalogBindingId,
  });
}

export type BiteScoreCatalogBindingState =
  | Readonly<{ type: "unbound" }>
  | Readonly<{ type: "bound"; biteSaverCatalogBindingId: string }>
  | Readonly<{ type: "invalid" }>;

export function biteScoreCatalogBindingState(
  data: Readonly<Record<string, unknown>>,
): BiteScoreCatalogBindingState {
  if (!Object.prototype.hasOwnProperty.call(
    data,
    biteSaverCatalogBindingIdField,
  )) {
    return Object.freeze({ type: "unbound" });
  }
  const biteSaverCatalogBindingId = data[biteSaverCatalogBindingIdField];
  return isValidBiteSaverCatalogBindingId(biteSaverCatalogBindingId)
    ? Object.freeze({ type: "bound", biteSaverCatalogBindingId })
    : Object.freeze({ type: "invalid" });
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteLink(side: "coupon" | "bitescore", token: string): string {
  return `${restaurantInviteBaseUrl}/${side}/${token}`;
}

export function restaurantCustomerLink(
  side: "coupons" | "bitescore",
  catalogRestaurantId: string,
): string {
  const safeCatalogRestaurantId = readBiteScoreCatalogRestaurantId(
    catalogRestaurantId,
  );
  if (safeCatalogRestaurantId === null) {
    throw new TypeError("A valid canonical restaurant ID is required.");
  }
  return `${restaurantCustomerBaseUrl}/${side}/${
    encodeURIComponent(safeCatalogRestaurantId)
  }`;
}

export type RestaurantInviteAuditActor = Readonly<{
  uid: string;
  email: string;
}>;

type RestaurantInviteLifecycleFields = Readonly<{
  tokenHash: string;
  status: "active";
  createdAt: unknown;
  createdByUid: string;
  createdByEmail: string;
  expiresAt: unknown;
  usedAt: null;
  usedByUid: null;
  usedByEmail: null;
  maxUses: 1;
  useCount: 0;
  lastAccessedAt: null;
  revokedAt: null;
  revokedByUid: null;
}>;

function restaurantInviteLifecycleFields(params: Readonly<{
  tokenHash: string;
  actor: RestaurantInviteAuditActor;
  createdAt: unknown;
  expiresAt: unknown;
}>): RestaurantInviteLifecycleFields {
  return Object.freeze({
    tokenHash: params.tokenHash,
    status: "active",
    createdAt: params.createdAt,
    createdByUid: params.actor.uid,
    createdByEmail: params.actor.email,
    expiresAt: params.expiresAt,
    usedAt: null,
    usedByUid: null,
    usedByEmail: null,
    maxUses: 1,
    useCount: 0,
    lastAccessedAt: null,
    revokedAt: null,
    revokedByUid: null,
  });
}

export function buildCouponRestaurantInviteDocument(params: Readonly<{
  tokenHash: string;
  actor: RestaurantInviteAuditActor;
  createdAt: unknown;
  expiresAt: unknown;
  restaurantId: string | null;
  pendingRestaurantKey: string | null;
  catalogRestaurantId: string | null;
  restaurantName: string;
  couponPrefill: Readonly<Record<string, unknown>>;
}>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...restaurantInviteLifecycleFields(params),
    type: "coupon_invite",
    side: "coupon",
    restaurantId: params.restaurantId,
    pendingRestaurantKey: params.pendingRestaurantKey,
    restaurantName: params.restaurantName,
    couponPrefill: params.couponPrefill,
    ...(params.catalogRestaurantId === null
      ? {}
      : {
          [biteScoreCatalogRestaurantIdField]: params.catalogRestaurantId,
        }),
  });
}

export function buildBiteScoreRestaurantClaimInviteDocument(params: Readonly<{
  tokenHash: string;
  actor: RestaurantInviteAuditActor;
  createdAt: unknown;
  expiresAt: unknown;
  catalogRestaurantId: string;
  restaurantName: string;
  restaurantAddressSummary: string;
}>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...restaurantInviteLifecycleFields(params),
    type: "bitescore_claim_invite",
    side: "bitescore",
    restaurantId: params.catalogRestaurantId,
    restaurantName: params.restaurantName,
    restaurantAddressSummary: params.restaurantAddressSummary,
  });
}

export function couponInviteRestaurantIdentity(
  rawRestaurantId: unknown,
  inviteId: string,
): { restaurantId: string | null; pendingRestaurantKey: string | null } {
  const safeInviteId = readBiteScoreCatalogRestaurantId(inviteId);
  if (safeInviteId === null) {
    throw new TypeError("A valid invitation document ID is required.");
  }
  if (
    rawRestaurantId === null ||
    rawRestaurantId === undefined ||
    rawRestaurantId === ""
  ) {
    return {
      restaurantId: null,
      pendingRestaurantKey: `pending_${safeInviteId}`,
    };
  }
  const restaurantId = readBiteScoreCatalogRestaurantId(rawRestaurantId);
  if (restaurantId === null) {
    throw new TypeError("A valid restaurant document ID is required.");
  }

  return {
    restaurantId,
    pendingRestaurantKey: null,
  };
}

export type InviteListSummary = {
  side?: unknown;
  createdAtMillis?: unknown;
};

export type InvitePreviewSummary = {
  side?: unknown;
  status?: unknown;
  expiresAtMillis?: unknown;
  maxUses?: unknown;
  useCount?: unknown;
};

export function filterAndSortInviteSummaries<T extends InviteListSummary>(
  invites: T[],
  side?: string | null,
  limit = 50,
): T[] {
  const normalizedSide = side === "coupon" || side === "bitescore"
    ? side
    : null;
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  return invites
    .filter((invite) => {
      if (!normalizedSide) {
        return true;
      }
      return invite.side === normalizedSide;
    })
    .sort((a, b) => {
      const aCreatedAt =
        typeof a.createdAtMillis === "number" ? a.createdAtMillis : 0;
      const bCreatedAt =
        typeof b.createdAtMillis === "number" ? b.createdAtMillis : 0;
      return bCreatedAt - aCreatedAt;
    })
    .slice(0, safeLimit);
}

export function normalizeInviteSide(value: unknown): "coupon" | "bitescore" | null {
  return value === "coupon" || value === "bitescore" ? value : null;
}

export function invitePreviewUnavailableReason(
  invite: InvitePreviewSummary,
  expectedSide?: string | null,
  nowMillis = Date.now(),
): string | null {
  const normalizedExpectedSide = normalizeInviteSide(expectedSide);
  if (normalizedExpectedSide && invite.side !== normalizedExpectedSide) {
    return "wrong-side";
  }

  if (invite.status !== "active") {
    return "inactive";
  }

  const expiresAtMillis =
    typeof invite.expiresAtMillis === "number" ? invite.expiresAtMillis : null;
  if (expiresAtMillis === null || expiresAtMillis <= nowMillis) {
    return "expired";
  }

  const maxUses = typeof invite.maxUses === "number" ? invite.maxUses : 1;
  const useCount = typeof invite.useCount === "number" ? invite.useCount : 0;
  if (useCount >= maxUses) {
    return "used";
  }

  return null;
}
