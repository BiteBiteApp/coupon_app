type RestaurantSubscriptionDocumentSnapshot = {
  exists: boolean;
};

type RestaurantSubscriptionDocumentReference = {
  id: string;
  get(): Promise<RestaurantSubscriptionDocumentSnapshot>;
};

type RestaurantSubscriptionCollectionReference = {
  doc(id: string): RestaurantSubscriptionDocumentReference;
};

type RestaurantSubscriptionTransaction = {
  get(
    reference: RestaurantSubscriptionDocumentReference,
  ): Promise<RestaurantSubscriptionDocumentSnapshot>;
  update(
    reference: RestaurantSubscriptionDocumentReference,
    data: Record<string, unknown>,
  ): unknown;
};

export type RestaurantSubscriptionFirestore = {
  collection(path: string): RestaurantSubscriptionCollectionReference;
  runTransaction<T>(
    updateFunction: (
      transaction: RestaurantSubscriptionTransaction,
    ) => Promise<T>,
  ): Promise<T>;
};

export type RestaurantSubscriptionUpdateResult =
  | "updated"
  | "missing-account";

const restaurantSubscriptionUpdateFields = new Set([
  "subscriptionStatus",
  "trialEndsAt",
  "subscriptionEndsAt",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "billingPlanName",
  "couponPostingEnabled",
  "updatedAt",
  "hasUsedTrial",
]);

/**
 * Applies a Stripe-derived subscription patch only when the target restaurant
 * account already exists. The injected transaction makes the existence check
 * and update atomic, so this helper cannot create a partial account document.
 */
export async function updateExistingRestaurantSubscription(
  db: RestaurantSubscriptionFirestore,
  restaurantUid: string,
  updateData: Record<string, unknown>,
): Promise<RestaurantSubscriptionUpdateResult> {
  for (const field of Object.keys(updateData)) {
    if (!restaurantSubscriptionUpdateFields.has(field)) {
      throw new Error("Unsupported restaurant subscription update field.");
    }
  }

  const accountRef = db.collection("restaurant_accounts").doc(restaurantUid);

  return db.runTransaction<RestaurantSubscriptionUpdateResult>(
    async (transaction) => {
      const accountSnapshot = await transaction.get(accountRef);
      if (!accountSnapshot.exists) {
        return "missing-account";
      }

      transaction.update(accountRef, updateData);
      return "updated";
    },
  );
}
