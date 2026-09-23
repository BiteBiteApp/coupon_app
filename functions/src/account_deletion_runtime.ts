import {createAccountDeletionObjects} from "./account_deletion_media.js";
import {accountDeletionObjectFinalizedHandler, accountDeletionMediaBucket, createAccountDeletionFinalizedObjects} from "./account_deletion_finalized_media.js";
import {onObjectFinalized} from "firebase-functions/v2/storage";
import Stripe from "stripe";
import {defineSecret} from "firebase-functions/params";
import {createAccountDeletionStripeAdapter} from "./account_deletion_billing.js";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {getAccountDeletionStatusHandler, processDueAccountDeletions, requestAccountDeletionHandler} from "./account_deletion_service.js";
import {createAccountDeletionStep, type AccountDeletionAuth} from "./account_deletion_cleanup.js";
import type {AccountDeletionIdentity} from "./account_deletion_contract.js";

const requestIdentity = "account-deletion-request@coupon-app-29446.iam.gserviceaccount.com";
const workerIdentity = "account-deletion-worker@coupon-app-29446.iam.gserviceaccount.com";
const callableOptions = {region: "us-central1", serviceAccount: requestIdentity,
  memory: "256MiB" as const, timeoutSeconds: 30, maxInstances: 2, concurrency: 10,
  invoker: "public" as const, secrets: []};

async function identity(uid: string): Promise<AccountDeletionIdentity | null> {
  try {
    const user = await getAuth().getUser(uid);
    return {uid: user.uid, creationTime: user.metadata.creationTime, providerIds: user.providerData.map((value) => value.providerId), disabled: user.disabled,
      privileged: user.customClaims?.admin === true || user.email === "schuyler.cole@gmail.com"};
  } catch (error) {
    if ((error as {code?: string}).code === "auth/user-not-found") return null;
    throw new HttpsError("unavailable", "Account verification is temporarily unavailable.");
  }
}

/** Explicit revoked-session verification: callable middleware alone does not
 * enable checkRevoked. Auth target is never taken from expectedUid. */
export const requestAccountDeletion = onCall(callableOptions, async (request) => {
  const header = request.rawRequest.headers.authorization;
  if (!request.auth || typeof header !== "string" || !header.startsWith("Bearer ")) throw new HttpsError("unauthenticated", "Sign in to delete your account.");
  let token;
  try { token = await getAuth().verifyIdToken(header.slice(7), true); }
  catch { throw new HttpsError("unauthenticated", "Authenticate again before deleting your account."); }
  if (token.uid !== request.auth.uid) throw new HttpsError("permission-denied", "The authenticated account changed.");
  const user = await identity(token.uid);
  if (!user) throw new HttpsError("unauthenticated", "The authenticated account is unavailable.");
  return requestAccountDeletionHandler(getFirestore(), request.data, {
    uid: token.uid, authTime: token.auth_time, issuedAt: token.iat,
    signInProvider: token.firebase.sign_in_provider,
  }, user);
});

// Receipt-only callers intentionally omit Authorization, so an expired token
// cannot prevent recovery after Auth removal. Receipt grants no mutation.
export const getAccountDeletionStatus = onCall(callableOptions, (request) =>
  getAccountDeletionStatusHandler(getFirestore(), request.data, request.auth?.uid ?? null));

const auth: AccountDeletionAuth = {
  getIdentity: identity,
  async deleteIdentity(uid) {
    try { await getAuth().deleteUser(uid); }
    catch (error) { if ((error as {code?: string}).code !== "auth/user-not-found") throw new Error("Auth deletion needs recovery"); }
  },
};
const deletionStripeSecret = defineSecret("STRIPE_SECRET_KEY");
export const processAccountDeletionRequests = onSchedule({
  region: "us-central1", schedule: "every 1 minutes", serviceAccount: workerIdentity,
  memory: "256MiB", timeoutSeconds: 60, maxInstances: 1, concurrency: 1,
  retryCount: 0, secrets: [deletionStripeSecret],
}, async () => { await processDueAccountDeletions(getFirestore(), createAccountDeletionStep(auth, createAccountDeletionStripeAdapter(new Stripe(deletionStripeSecret.value(), {apiVersion: "2025-08-27.basil"})), createAccountDeletionObjects(), createAccountDeletionFinalizedObjects())); });

export const cleanupAccountDeletionFinalizedImage = onObjectFinalized({
  bucket: accountDeletionMediaBucket, region: "us-central1",
  serviceAccount: "account-deletion-media@coupon-app-29446.iam.gserviceaccount.com",
  memory: "256MiB", timeoutSeconds: 60, maxInstances: 2, concurrency: 10,
  retry: true, secrets: [],
}, async (event) => { await accountDeletionObjectFinalizedHandler(getFirestore(), event, identity, createAccountDeletionFinalizedObjects()); });
