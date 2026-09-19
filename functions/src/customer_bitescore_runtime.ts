import {createHmac} from "node:crypto";
import {getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {type CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {requireRestaurantAccountAdminAccess} from "./admin_authorization.js";
import {decodeCouponAdminCursorKey, couponAdminCursorSecretName} from "./coupon_admin_paging.js";
import {OpaqueCursorCodec, OpaqueCursorError} from "./opaque_cursor.js";
import {createFirestoreCustomerBiteSaverSearchDatabase} from "./customer_bitesaver_search_store.js";
import {
  startCustomerBiteScoreSearchHandler,
  advanceCustomerBiteScoreSearchHandler,
  getCustomerBiteScoreSearchPageHandler,
} from "./customer_bitescore_search.js";
import {CustomerBiteScoreSearchError} from "./customer_bitescore_search_contract.js";
import {
  startCustomerBiteScoreProfileListHandler,
  advanceCustomerBiteScoreProfileListHandler,
  getCustomerBiteScoreProfileListPageHandler,
} from "./customer_bitescore_profile_search.js";
import {getCustomerBiteScoreProfileSummaryHandler} from "./customer_bitescore_profile_summary.js";
import {reconcileCustomerBiteScoreFavoriteGeneration} from "./customer_bitescore_profile_generation.js";
import {getCustomerBiteScoreSuggestionsHandler, reconcileCustomerBiteScoreSuggestionCatalog} from "./customer_bitescore_suggestions.js";
import {pageCustomerBiteScoreMenuHandler, reconcileCustomerBiteScoreMenuGeneration} from "./customer_bitescore_menu_search.js";
import {
  getCustomerBiteScoreDetailHandler,
  pageCustomerBiteScoreReviewsHandler,
  pageCustomerBiteScoreImagesHandler,
  reconcileCustomerBiteScoreReview,
  reconcileCustomerBiteScoreFeedback,
  reconcileCustomerBiteScoreImage,
} from "./customer_bitescore_reads.js";
import {createFirestoreRatingDestructivePrivateDatabase} from "./rating_destructive_job_store.js";
import {
  BiteScoreReviewAggregateError,
  saveCustomerBiteScoreReview as saveReview,
  reconcileBiteScoreReviewAggregateEvent,
  reconcileBiteScoreReviewAggregateDish,
  continueBiteScoreReviewAggregates,
} from "./bitescore_review_aggregate.js";

import {
  submitCustomerBiteScoreRestaurantClaimHandler,
  resolveCustomerBiteScoreRestaurantCreationHandler,
  resolveCustomerBiteScoreDishCreationHandler,
  completeCustomerBiteScoreRestaurantProvenanceHandler,
} from "./customer_bitescore_creation.js";
import {createCustomerBiteScorePhotoHandler, toggleCustomerBiteScorePhotoVoteHandler} from "./customer_bitescore_photos.js";

// Rollout dependency only: provision least-privilege Firestore/trigger runtime
// access and access to this existing secret before deploying these exports.
// No BiteSaver runtime identity or secret value is changed.
export const biteScoreCustomerRuntimeServiceAccount =
  "bitescore-customer-runtime@coupon-app-29446.iam.gserviceaccount.com";
const cursorSecret = defineSecret(couponAdminCursorSecretName);
const publicOptions = {
  serviceAccount: biteScoreCustomerRuntimeServiceAccount,
  secrets: [cursorSecret],
  timeoutSeconds: 60,
};

// Signed-in admission is shared across screen instances. Guest public reading
// retains the existing per-installation binding without introducing a login gate.
export function customerBiteScoreActorBinding(key: Uint8Array, uid: string | null, instance: string): string {
  return createHmac("sha256", key).update(JSON.stringify(uid === null
    ? ["bitestar.customer-bitescore.actor.v1", "guest", instance]
    : ["bitestar.customer-bitescore.actor.v1", "user", uid])).digest("hex");
}

function readContext(request: CallableRequest<unknown>) {
  const raw = request.data as {clientInstanceId?: unknown} | null;
  const instance = raw?.clientInstanceId;
  if (typeof instance !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(instance)) {
    throw new HttpsError("invalid-argument", "Invalid BiteScore client binding.");
  }
  const root = decodeCouponAdminCursorKey(cursorSecret.value());
  const key = createHmac("sha256", root)
    .update("bitestar.customer-bitescore.cursor-key.v1").digest();
  const uid = request.auth?.uid ?? null;
  const actorId = customerBiteScoreActorBinding(key, uid, instance);
  let isAdmin = false;
  try { requireRestaurantAccountAdminAccess(request); isAdmin = true; } catch { /* public caller */ }
  return {actorId, cursorCodec: new OpaqueCursorCodec({key}), userId: uid, isAdmin};
}

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof CustomerBiteScoreSearchError || error instanceof BiteScoreReviewAggregateError) {
      throw new HttpsError(error.code, error.message);
    }
    if (error instanceof OpaqueCursorError) {
      throw new HttpsError("invalid-argument", "Invalid or expired BiteScore cursor.");
    }
    throw new HttpsError("internal", "BiteScore is temporarily unavailable.");
  }
}

export const startCustomerBiteScoreSearch = onCall(publicOptions, (request) => safely(() =>
  startCustomerBiteScoreSearchHandler(createFirestoreCustomerBiteSaverSearchDatabase(getFirestore()), request.data, readContext(request))));
export const advanceCustomerBiteScoreSearch = onCall(publicOptions, (request) => safely(() =>
  advanceCustomerBiteScoreSearchHandler(createFirestoreCustomerBiteSaverSearchDatabase(getFirestore()), request.data, readContext(request))));
export const getCustomerBiteScoreSearchPage = onCall(publicOptions, (request) => safely(() =>
  getCustomerBiteScoreSearchPageHandler(createFirestoreCustomerBiteSaverSearchDatabase(getFirestore()), request.data, readContext(request))));
export const getCustomerBiteScoreDetail = onCall(publicOptions, (request) => safely(() =>
  getCustomerBiteScoreDetailHandler(getFirestore(), request.data, readContext(request))));
export const pageCustomerBiteScoreReviews = onCall(publicOptions, (request) => safely(() =>
  pageCustomerBiteScoreReviewsHandler(getFirestore(), request.data, readContext(request))));
export const pageCustomerBiteScoreImages = onCall(publicOptions, (request) => safely(() =>
  pageCustomerBiteScoreImagesHandler(getFirestore(), request.data, readContext(request))));
export const pageCustomerBiteScoreMenu = onCall(publicOptions, (request) => safely(() =>
  pageCustomerBiteScoreMenuHandler(getFirestore(), request.data, readContext(request))));
export const startCustomerBiteScoreProfileList = onCall(publicOptions, (request) => safely(() =>
  startCustomerBiteScoreProfileListHandler(createFirestoreCustomerBiteSaverSearchDatabase(getFirestore()), request.data, readContext(request))));
export const advanceCustomerBiteScoreProfileList = onCall(publicOptions, (request) => safely(() =>
  advanceCustomerBiteScoreProfileListHandler(createFirestoreCustomerBiteSaverSearchDatabase(getFirestore()), request.data, readContext(request))));
export const getCustomerBiteScoreProfileListPage = onCall(publicOptions, (request) => safely(() =>
  getCustomerBiteScoreProfileListPageHandler(createFirestoreCustomerBiteSaverSearchDatabase(getFirestore()), request.data, readContext(request))));
export const getCustomerBiteScoreProfileSummary = onCall(publicOptions, (request) => safely(() =>
  getCustomerBiteScoreProfileSummaryHandler(getFirestore(), request.data, readContext(request))));
export const getCustomerBiteScoreSuggestions = onCall(publicOptions, (request) => safely(() =>
  getCustomerBiteScoreSuggestionsHandler(getFirestore(), request.data, readContext(request))));

export const saveCustomerBiteScoreReview = onCall({
  serviceAccount: biteScoreCustomerRuntimeServiceAccount,
  timeoutSeconds: 60,
}, (request) => safely(() => saveReview(
  createFirestoreRatingDestructivePrivateDatabase(getFirestore()),
  {uid: request.auth?.uid ?? "", emailVerified: request.auth?.token.email_verified === true},
  request.data,
  new Date(),
)));

export const maintainCustomerBiteScoreReviewAggregate = onDocumentWritten({
  serviceAccount: biteScoreCustomerRuntimeServiceAccount,
  document: "dish_reviews/{reviewId}",
  retry: true,
}, async (event) => {
  await reconcileBiteScoreReviewAggregateEvent(
    createFirestoreRatingDestructivePrivateDatabase(getFirestore()),
    {reviewId: event.params.reviewId, before: event.data?.before.data() ?? null,
      after: event.data?.after.data() ?? null, now: new Date()},
  );
  await reconcileCustomerBiteScoreReview(getFirestore(), event.params.reviewId);
});

export const maintainCustomerBiteScoreDishAggregate = onDocumentWritten({
  serviceAccount: biteScoreCustomerRuntimeServiceAccount,
  document: "bitescore_dishes/{dishId}",
  retry: true,
}, async (event) => {
  await reconcileBiteScoreReviewAggregateDish(
    createFirestoreRatingDestructivePrivateDatabase(getFirestore()), event.params.dishId, new Date(),
  );
});

export const maintainCustomerBiteScoreReviewFeedback = onDocumentWritten({
  serviceAccount: biteScoreCustomerRuntimeServiceAccount,
  document: "review_feedback_votes/{voteId}",
  retry: true,
}, async (event) => {
  await reconcileCustomerBiteScoreFeedback(getFirestore(), event.params.voteId);
});

export const maintainCustomerBiteScoreImage = onDocumentWritten({
  serviceAccount: biteScoreCustomerRuntimeServiceAccount,
  document: "bitescore_dish_images/{imageId}",
  retry: true,
}, async (event) => {
  await reconcileCustomerBiteScoreImage(getFirestore(), event.params.imageId);
});

export const maintainCustomerBiteScoreFavoriteRestaurant = onDocumentWritten({
  serviceAccount: biteScoreCustomerRuntimeServiceAccount,
  document: "user_profiles/{userId}/favorite_restaurants/{favoriteId}",
  retry: true,
}, async (event) => reconcileCustomerBiteScoreFavoriteGeneration(
  createFirestoreCustomerBiteSaverSearchDatabase(getFirestore()),
  event.params.userId, "favorite_restaurants", event.params.favoriteId,
));
export const maintainCustomerBiteScoreFavoriteDish = onDocumentWritten({
  serviceAccount: biteScoreCustomerRuntimeServiceAccount,
  document: "user_profiles/{userId}/favorite_dishes/{favoriteId}",
  retry: true,
}, async (event) => reconcileCustomerBiteScoreFavoriteGeneration(
  createFirestoreCustomerBiteSaverSearchDatabase(getFirestore()),
  event.params.userId, "favorite_dishes", event.params.favoriteId,
));
export const maintainCustomerBiteScoreSuggestionCatalog = onDocumentWritten({
  serviceAccount: biteScoreCustomerRuntimeServiceAccount,
  document: "dish_catalog/{catalogId}",
  retry: true,
}, async () => reconcileCustomerBiteScoreSuggestionCatalog(getFirestore()));

function menuMaintenance(root: "restaurant_accounts" | "restaurant_menus",
  kind: "menu_images" | "menu_items" | "menu_sections") {
  return onDocumentWritten({serviceAccount: biteScoreCustomerRuntimeServiceAccount,
    document: `${root}/{rootId}/${kind}/{entryId}`, retry: true}, async (event) =>
    reconcileCustomerBiteScoreMenuGeneration(
      createFirestoreCustomerBiteSaverSearchDatabase(getFirestore()),
      `${root}/${event.params.rootId}`, kind, event.params.entryId));
}
export const maintainCustomerBiteScoreMenuImage = menuMaintenance("restaurant_menus", "menu_images");
export const maintainCustomerBiteScoreMenuItem = menuMaintenance("restaurant_menus", "menu_items");
export const maintainCustomerBiteScoreMenuSection = menuMaintenance("restaurant_menus", "menu_sections");
export const maintainCustomerBiteScoreLinkedMenuImage = menuMaintenance("restaurant_accounts", "menu_images");
export const maintainCustomerBiteScoreLinkedMenuItem = menuMaintenance("restaurant_accounts", "menu_items");
export const maintainCustomerBiteScoreLinkedMenuSection = menuMaintenance("restaurant_accounts", "menu_sections");

export const continueCustomerBiteScoreReviewAggregates = onSchedule({
  serviceAccount: biteScoreCustomerRuntimeServiceAccount,
  schedule: "every 1 minutes",
  timeoutSeconds: 60,
}, async () => {
  await continueBiteScoreReviewAggregates(
    createFirestoreRatingDestructivePrivateDatabase(getFirestore()), new Date(),
  );
});

// These narrow mutation boundaries derive their actor exclusively from Firebase
// authentication. Client flags and request fields cannot grant authority.
const mutationOptions = {serviceAccount: biteScoreCustomerRuntimeServiceAccount, timeoutSeconds: 60};
function creationContext(request: CallableRequest<unknown>) {
  return {userId: request.auth?.uid ?? null,
    email: typeof request.auth?.token.email === "string" ? request.auth.token.email : null,
    emailVerified: request.auth?.token.email_verified === true,
    isAnonymous: request.auth?.token.firebase?.sign_in_provider === "anonymous"};
}
function creationCursorContext(request: CallableRequest<unknown>) {
  const root = decodeCouponAdminCursorKey(cursorSecret.value());
  const key = createHmac("sha256", root)
    .update("bitestar.customer-bitescore.cursor-key.v1").digest();
  return {...creationContext(request), cursorCodec: new OpaqueCursorCodec({key})};
}
export const submitCustomerBiteScoreRestaurantClaim = onCall(mutationOptions, request => safely(() =>
  submitCustomerBiteScoreRestaurantClaimHandler(createFirestoreRatingDestructivePrivateDatabase(getFirestore()), request.data, creationContext(request))));
export const resolveCustomerBiteScoreRestaurantCreation = onCall(publicOptions, request => safely(() =>
  resolveCustomerBiteScoreRestaurantCreationHandler(createFirestoreRatingDestructivePrivateDatabase(getFirestore()), request.data, creationCursorContext(request))));
export const resolveCustomerBiteScoreDishCreation = onCall(publicOptions, request => safely(() =>
  resolveCustomerBiteScoreDishCreationHandler(createFirestoreRatingDestructivePrivateDatabase(getFirestore()), request.data, creationCursorContext(request))));
export const completeCustomerBiteScoreRestaurantProvenance = onCall(mutationOptions, request => safely(() =>
  completeCustomerBiteScoreRestaurantProvenanceHandler(createFirestoreRatingDestructivePrivateDatabase(getFirestore()), request.data, creationContext(request))));
export const createCustomerBiteScorePhoto = onCall(mutationOptions, request => safely(() =>
  createCustomerBiteScorePhotoHandler(getFirestore(), request)));
export const toggleCustomerBiteScorePhotoVote = onCall(mutationOptions, request => safely(() =>
  toggleCustomerBiteScorePhotoVoteHandler(getFirestore(), request)));
