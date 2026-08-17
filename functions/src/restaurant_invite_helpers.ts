import { createHash, randomBytes } from "node:crypto";

export const restaurantInviteBaseUrl = "https://go.bitestar.app/invite";
export const biteScoreCatalogRestaurantIdField =
  "biteScoreCatalogRestaurantId" as const;
export const biteSaverCatalogBindingIdField =
  "biteSaverCatalogBindingId" as const;

const biteSaverCatalogBindingIdPattern = /^[A-Za-z0-9_-]{43}$/u;
const maximumFirestoreDocumentIdBytes = 1_500;
const unsupportedFirestoreDocumentIdCharacterPattern = /[\p{Cc}\p{Cf}]/u;

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
    unsupportedFirestoreDocumentIdCharacterPattern.test(value) ||
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
