import { createHash, randomBytes } from "node:crypto";

export const restaurantInviteBaseUrl = "https://colesmartllc.com/invite";

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
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
  const restaurantId =
    typeof rawRestaurantId === "string" && rawRestaurantId.trim()
      ? rawRestaurantId.trim()
      : null;

  return {
    restaurantId,
    pendingRestaurantKey: restaurantId ? null : `pending_${inviteId}`,
  };
}

export type InviteListSummary = {
  side?: unknown;
  createdAtMillis?: unknown;
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
