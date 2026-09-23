import {accountDeletionPath} from "./account_deletion_guard.js";
import type {CustomerBiteSaverSearchDatabase} from "./customer_bitesaver_search_store.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {biteScoreRecord, customerBiteScoreDigest, CustomerBiteScoreSearchError} from "./customer_bitescore_search_contract.js";

const version = "bitestar.customer-bitescore-profile-list.v1";
export const customerBiteScoreProfileGenerationCollection = "private_bitescore_profile_generations";
function id(value: string): string {
  if (readBiteScoreCatalogRestaurantId(value) !== value) {
    throw new CustomerBiteScoreSearchError("invalid-argument", "Invalid profile identity.");
  }
  return value;
}
export function customerBiteScoreProfileGenerationPath(userId: string): string {
  return `${customerBiteScoreProfileGenerationCollection}/${customerBiteScoreDigest(version, id(userId))}`;
}
export function nextCustomerBiteScoreProfileGeneration(previous: unknown): Readonly<Record<string, unknown>> {
  const count = previous == null ? 0 : biteScoreRecord(previous) ? previous.generation : NaN;
  if (!Number.isSafeInteger(count) || (count as number) < 0 || !Number.isSafeInteger((count as number) + 1)) {
    throw new CustomerBiteScoreSearchError("unavailable", "Profile generation is unavailable.");
  }
  return {version, generation: (count as number) + 1};
}

/** Reread current membership; repeated and reordered favorite events converge. */
export async function reconcileCustomerBiteScoreFavoriteGeneration(database: CustomerBiteSaverSearchDatabase,
  userId: string, kind: "favorite_restaurants" | "favorite_dishes", favoriteId: string): Promise<void> {
  if (kind !== "favorite_restaurants" && kind !== "favorite_dishes") {
    throw new CustomerBiteScoreSearchError("invalid-argument", "Invalid favorite list.");
  }
  const sourcePath = `user_profiles/${id(userId)}/${kind}/${id(favoriteId)}`;
  const accountingPath = `${customerBiteScoreProfileGenerationCollection}/favorite_${customerBiteScoreDigest(version, sourcePath)}`;
  const generationPath = customerBiteScoreProfileGenerationPath(userId);
  await database.runTransaction(async (tx) => {
    const [source, previous, generation, deletion] = await tx.getDocuments([sourcePath, accountingPath, generationPath, accountDeletionPath(userId)]);
    if (deletion) { tx.deleteDocument(accountingPath); tx.deleteDocument(generationPath); return; }
    const raw = source?.data;
    const target = raw && readBiteScoreCatalogRestaurantId(raw[kind === "favorite_dishes" ? "dishId" : "restaurantId"] ?? favoriteId);
    const next = raw && target && raw.restaurantType !== "bitesaver" && !String(raw.favoriteKind ?? "").startsWith("bitesaver") ?
      customerBiteScoreDigest(kind, target) : null;
    if ((previous?.data.fingerprint ?? null) === next) return;
    tx.setDocument(generationPath, nextCustomerBiteScoreProfileGeneration(generation?.data));
    if (next === null) tx.deleteDocument(accountingPath);
    else tx.setDocument(accountingPath, {version, fingerprint: next});
  });
}
