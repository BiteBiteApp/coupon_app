import { initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  Firestore,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { defineSecret, defineString } from "firebase-functions/params";
import {
  onDocumentCreated,
  onDocumentDeleted,
} from "firebase-functions/v2/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import Stripe from "stripe";

initializeApp();

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

const db: Firestore = getFirestore();
const stripeSecret = defineSecret("STRIPE_SECRET_KEY");
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripeCheckoutSuccessUrl = defineString("STRIPE_CHECKOUT_SUCCESS_URL");
const stripeCheckoutCancelUrl = defineString("STRIPE_CHECKOUT_CANCEL_URL");
const stripeCustomerPortalReturnUrl = defineString(
  "STRIPE_CUSTOMER_PORTAL_RETURN_URL",
);
const stripePriceId = "price_1TJKGjBwoT6e93tVkesJPfxD";
const stripeTrialDays = 60;
const subscriptionReturnSuccessUri = "couponapp://subscription-return?status=success";
const subscriptionReturnCancelUri = "couponapp://subscription-return?status=cancel";

type PushRequestData = {
  requestId?: string;
  installationId?: string;
  guestDeviceId?: string;
  authUid?: string | null;
  customerAccountUid?: string | null;
  isAnonymous?: boolean;
  couponId?: string;
  couponTitle?: string;
  restaurant?: string;
  isProximityOnly?: boolean;
  proximityRadiusMiles?: number | null;
  status?: string;
  source?: string;
  userLatitude?: number | null;
  userLongitude?: number | null;
};

type InstallationData = {
  installationId?: string;
  guestDeviceId?: string;
  fcmToken?: string | null;
  authUid?: string | null;
  customerAccountUid?: string | null;
  isAnonymous?: boolean;
  notificationsPermissionStatus?: string;
  platform?: string;
  proximityPushEnabled?: boolean;
  maxProximityPushesPerDay?: number;
};

function isPermissionUsable(status: string | undefined): boolean {
  return status === "authorized" || status === "provisional";
}

function hasText(value: string | undefined | null): boolean {
  return !!value && value.trim().length > 0;
}

function buildNotificationTitle(data: PushRequestData): string {
  if (hasText(data.restaurant)) {
    return `Nearby deal at ${data.restaurant!.trim()}`;
  }
  return "Nearby deal unlocked";
}

function buildNotificationBody(data: PushRequestData): string {
  if (hasText(data.couponTitle)) {
    return data.couponTitle!.trim();
  }
  return "A nearby proximity coupon just became available.";
}

function unixSecondsToTimestamp(seconds?: number | null): Timestamp | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return Timestamp.fromMillis(seconds * 1000);
}

function mapStripeStatusToAppStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "inactive";
    default:
      return "inactive";
  }
}

async function resolveRestaurantAccountUid(params: {
  ownerUid?: string | null;
  restaurantAccountId?: string | null;
  stripeCustomerId?: string | null;
}): Promise<string | null> {
  const ownerUid = params.ownerUid?.trim();
  if (ownerUid) {
    return ownerUid;
  }

  const restaurantAccountId = params.restaurantAccountId?.trim();
  if (restaurantAccountId) {
    return restaurantAccountId;
  }

  const stripeCustomerId = params.stripeCustomerId?.trim();
  if (!stripeCustomerId) {
    return null;
  }

  const snapshot = await db
    .collection("restaurant_accounts")
    .where("stripeCustomerId", "==", stripeCustomerId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  return snapshot.docs[0].id;
}

async function syncRestaurantSubscriptionFromStripe(
  subscription: Stripe.Subscription,
  fallbackMetadata?: Record<string, string>,
): Promise<void> {
  const metadata = {
    ...(fallbackMetadata ?? {}),
    ...(subscription.metadata ?? {}),
  };

  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const restaurantUid = await resolveRestaurantAccountUid({
    ownerUid: metadata.ownerUid,
    restaurantAccountId: metadata.restaurantAccountId,
    stripeCustomerId,
  });

  if (!restaurantUid) {
    logger.warn("Could not resolve restaurant account for Stripe subscription", {
      subscriptionId: subscription.id,
      stripeCustomerId,
      metadata,
    });
    return;
  }

  const subscriptionStatus = mapStripeStatusToAppStatus(subscription.status);
  const couponPostingEnabled =
    subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const trialEndsAt = subscriptionStatus === "trialing"
    ? unixSecondsToTimestamp(subscription.trial_end)
    : null;

  await db.collection("restaurant_accounts").doc(restaurantUid).set(
    {
      subscriptionStatus,
      trialEndsAt,
      subscriptionEndsAt:
        unixSecondsToTimestamp((subscription as any).current_period_end) ??
        unixSecondsToTimestamp(subscription.ended_at) ??
        unixSecondsToTimestamp(subscription.canceled_at),
      stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      billingPlanName: metadata.billingPlanName?.trim() || "coupon_monthly",
      couponPostingEnabled,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}



async function getTrialEligibility(ownerUid: string): Promise<boolean> {
  const accountSnapshot = await db
    .collection("restaurant_accounts")
    .doc(ownerUid)
    .get();
  const accountData = accountSnapshot.data();
  return accountData?.hasUsedTrial === true;
}

export const createSubscriptionCheckoutSession = onCall(
  {
    secrets: [stripeSecretKey],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const successUrl = stripeCheckoutSuccessUrl.value();
    const cancelUrl = stripeCheckoutCancelUrl.value();
    if (!successUrl || !cancelUrl) {
      throw new HttpsError(
        "failed-precondition",
        "Stripe Checkout is not configured.",
      );
    }

    const stripe = new Stripe(stripeSecretKey.value(), {
      apiVersion: "2025-08-27.basil",
    });

    const ownerUid = request.auth.uid;
    const hasUsedTrial = await getTrialEligibility(ownerUid);

    try {
      const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData =
        {
          metadata: {
            ownerUid,
            restaurantAccountId: ownerUid,
            source: "bitesaver_subscription",
          },
        };
      

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price: stripePriceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: ownerUid,
        metadata: {
          ownerUid,
          restaurantAccountId: ownerUid,
          source: "bitesaver_subscription",
        },
        subscription_data: subscriptionData,
      });

      if (!hasUsedTrial) {
        await db.collection("restaurant_accounts").doc(ownerUid).set(
          {
            hasUsedTrial: true,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      if (!session.url) {
        throw new HttpsError(
          "internal",
          "Stripe Checkout did not return a URL.",
        );
      }
      

      return {
        checkoutUrl: session.url,
      };
    } catch (error) {
      logger.error("Failed to create Stripe Checkout session", {
        ownerUid,
        error,
      });
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "Could not start Stripe Checkout.",
      );
    }
  },
);

export const createCheckoutSession = onCall(
  {
    secrets: [stripeSecret],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const successUrl = stripeCheckoutSuccessUrl.value();
    const cancelUrl = stripeCheckoutCancelUrl.value();
    if (!successUrl || !cancelUrl) {
      throw new HttpsError(
        "failed-precondition",
        "Stripe Checkout is not configured.",
      );
    }

    try {
      const stripe = new Stripe(stripeSecret.value(), {
        apiVersion: "2025-08-27.basil",
      });

      const ownerUid = request.auth.uid;
     const accountRef = db.collection("restaurant_accounts").doc(ownerUid);
const accountSnap = await accountRef.get();
const hasUsedTrial = accountSnap.data()?.hasUsedTrial === true;

const includeTrial = !hasUsedTrial;
if (includeTrial) {
  await accountRef.set(
    {
      hasUsedTrial: true,
    },
    { merge: true },
  );
}
      const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData =
        {
          metadata: {
            ownerUid,
            restaurantAccountId: ownerUid,
            billingPlanName: "coupon_monthly",
            source: "bitesaver_subscription",
          },
        };
      if (includeTrial) {
        subscriptionData.trial_period_days = stripeTrialDays;
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price: stripePriceId,
            quantity: 1,
          },
        ],
        subscription_data: subscriptionData,
        metadata: {
          ownerUid,
          restaurantAccountId: ownerUid,
          billingPlanName: "coupon_monthly",
          source: "bitesaver_subscription",
        },
        client_reference_id: ownerUid,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      return {
        url: session.url,
      };
    } catch (error) {
      logger.error("Failed to create checkout session", { error });
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "Failed to create checkout session",
      );
    }
  },
);

export const createCustomerPortalSession = onCall(
  {
    secrets: [stripeSecret],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const returnUrl = stripeCustomerPortalReturnUrl.value();
    if (!returnUrl) {
      throw new HttpsError(
        "failed-precondition",
        "Stripe Customer Portal is not configured.",
      );
    }

    const ownerUid = request.auth.uid;
    const accountSnapshot = await db
      .collection("restaurant_accounts")
      .doc(ownerUid)
      .get();
    const accountData = accountSnapshot.data();
    const stripeCustomerId =
      typeof accountData?.stripeCustomerId === "string"
        ? accountData.stripeCustomerId.trim()
        : "";

    if (!stripeCustomerId) {
      throw new HttpsError(
        "failed-precondition",
        "No Stripe customer is linked to this restaurant account.",
      );
    }

    try {
      const stripe = new Stripe(stripeSecret.value(), {
        apiVersion: "2025-08-27.basil",
      });
      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl,
      });

      if (!session.url) {
        throw new HttpsError(
          "internal",
          "Stripe Customer Portal did not return a URL.",
        );
      }

      return {
        url: session.url,
      };
    } catch (error) {
      logger.error("Failed to create Stripe Customer Portal session", {
        ownerUid,
        error,
      });
      throw new HttpsError(
        "internal",
        error instanceof Error
          ? error.message
          : "Failed to create customer portal session.",
      );
    }
  },
);

function renderSubscriptionReturnPage(params: {
  title: string;
  message: string;
  returnUri: string;
  buttonLabel: string;
}): string {
  const escapedTitle = params.title
    .split("&").join("&amp;")
.split("<").join("&lt;")
.split(">").join("&gt;");
  const escapedMessage = params.message
    .split("&").join("&amp;")
.split("<").join("&lt;")
.split(">").join("&gt;");
  const escapedButton = params.buttonLabel
    .split("&").join("&amp;")
.split("<").join("&lt;")
.split(">").join("&gt;");
  const escapedReturnUri = params.returnUri.split("&").join("&amp;");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #0f172a;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 420px;
        background: #ffffff;
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
        text-align: center;
      }
      .button {
        display: inline-block;
        margin-top: 20px;
        padding: 14px 20px;
        border-radius: 14px;
        background: #111827;
        color: #ffffff;
        text-decoration: none;
        font-weight: 700;
      }
      .hint {
        margin-top: 12px;
        color: #64748b;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapedTitle}</h1>
      <p>${escapedMessage}</p>
      <a class="button" href="${escapedReturnUri}">${escapedButton}</a>
      <p class="hint">If the app does not open automatically, tap the button above.</p>
    </div>
    <script>
      window.location.replace("${params.returnUri}");
    </script>
  </body>
</html>`;
}

export const subscriptionCheckoutSuccess = onRequest((request, response) => {
  response.status(200).send(
    renderSubscriptionReturnPage({
      title: "Subscription started successfully",
      message: "Your subscription has started. You can return to the app now.",
      returnUri: subscriptionReturnSuccessUri,
      buttonLabel: "Return to app",
    }),
  );
});

export const subscriptionCheckoutCancel = onRequest((request, response) => {
  response.status(200).send(
    renderSubscriptionReturnPage({
      title: "Subscription checkout canceled",
      message: "No changes were made. You can return to the app now.",
      returnUri: subscriptionReturnCancelUri,
      buttonLabel: "Return to app",
    }),
  );
});

export const stripeWebhook = onRequest(
  {
    secrets: [stripeSecret, stripeWebhookSecret],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method Not Allowed");
      return;
    }

    const signature = request.header("stripe-signature");
    if (!signature) {
      logger.warn("Missing Stripe signature header.");
      response.status(400).send("Missing Stripe signature.");
      return;
    }

    const stripe = new Stripe(stripeSecret.value(), {
      apiVersion: "2025-08-27.basil",
    });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        stripeWebhookSecret.value(),
      );
    } catch (error) {
      logger.error("Invalid Stripe webhook signature", { error });
      response.status(400).send("Invalid Stripe signature.");
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (
            session.mode === "subscription" &&
            typeof session.subscription === "string"
          ) {
            const subscription = await stripe.subscriptions.retrieve(
              session.subscription,
            );
            await syncRestaurantSubscriptionFromStripe(
              subscription,
              session.metadata ?? undefined,
            );
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          await syncRestaurantSubscriptionFromStripe(subscription);
          break;
        }
        default:
          logger.info("Ignoring Stripe webhook event", {
            type: event.type,
          });
      }

      response.status(200).json({ received: true });
    } catch (error) {
      logger.error("Failed to process Stripe webhook", {
        type: event.type,
        error,
      });
      response.status(500).send("Webhook processing failed.");
    }
  },
);

export const processProximityPushRequest = onDocumentCreated(
  "proximity_push_requests/{requestId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.warn("Missing event snapshot.");
      return;
    }

    const requestRef = snapshot.ref;
    const requestId = event.params.requestId as string;
    const raw = snapshot.data() as PushRequestData | undefined;

    if (!raw) {
      await requestRef.set(
        {
          status: "failed",
          failureReason: "missing_request_data",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    logger.info("Processing proximity push request", {
      requestId,
      installationId: raw.installationId,
      couponId: raw.couponId,
      restaurant: raw.restaurant,
    });

    const claimResult = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(requestRef);
      const freshData = fresh.data() as PushRequestData | undefined;

      if (!fresh.exists || !freshData) {
        return { proceed: false, reason: "missing_request_doc" };
      }

      const status = freshData.status ?? "pending";
      if (status !== "pending") {
        return { proceed: false, reason: `status_${status}` };
      }

      tx.set(
        requestRef,
        {
          status: "processing",
          processingStartedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { proceed: true, reason: "claimed" };
    });

    if (!claimResult.proceed) {
      logger.info("Skipping request before send", {
        requestId,
        reason: claimResult.reason,
      });
      return;
    }

    try {
      const installationId = raw.installationId?.trim();
      if (!installationId) {
        await requestRef.set(
          {
            status: "skipped_missing_installation",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      const installationRef = db
        .collection("customer_device_installations")
        .doc(installationId);

      const installationSnap = await installationRef.get();
      const installation =
        installationSnap.data() as InstallationData | undefined;

      if (!installationSnap.exists || !installation) {
        await requestRef.set(
          {
            status: "skipped_missing_installation_doc",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      const proximityPushEnabled = installation.proximityPushEnabled ?? true;
      const maxPerDay = installation.maxProximityPushesPerDay ?? 2;
      const permissionStatus = installation.notificationsPermissionStatus;
      const token = installation.fcmToken?.trim();

      if (!proximityPushEnabled || maxPerDay <= 0) {
        await requestRef.set(
          {
            status: "skipped_disabled",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      if (!isPermissionUsable(permissionStatus)) {
        await requestRef.set(
          {
            status: "skipped_permission",
            permissionStatus: permissionStatus ?? null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      if (!token) {
        await requestRef.set(
          {
            status: "skipped_missing_token",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return;
      }

      const title = buildNotificationTitle(raw);
      const body = buildNotificationBody(raw);

      const response = await getMessaging().send({
        token,
        notification: {
          title,
          body,
        },
        data: {
          type: "proximity_coupon",
          requestId,
          installationId,
          couponId: raw.couponId ?? "",
          couponTitle: raw.couponTitle ?? "",
          restaurant: raw.restaurant ?? "",
          source: raw.source ?? "client_proximity_trigger",
        },
        android: {
          priority: "high",
          notification: {
            channelId: "default",
          },
        },
      });

      await requestRef.set(
        {
          status: "sent",
          fcmMessageId: response,
          sentAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      logger.info("Proximity push sent", {
        requestId,
        installationId,
        response,
      });
    } catch (error) {
      logger.error("Failed to process proximity push request", {
        requestId,
        error,
      });

      await requestRef.set(
        {
          status: "failed",
          failureReason:
            error instanceof Error ? error.message : "unknown_error",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  },
);

export const cleanupDeletedRestaurantCoupons = onDocumentDeleted(
  "restaurant_accounts/{uid}",
  async (event) => {
    const uid = event.params.uid as string;
    const accountRef =
      event.data?.ref ?? db.collection("restaurant_accounts").doc(uid);
    await db.recursiveDelete(accountRef.collection("coupons"));
  },
);
