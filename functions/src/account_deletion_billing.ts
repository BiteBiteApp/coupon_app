import {createHash} from "node:crypto";
import type Stripe from "stripe";
import {FieldValue, type Firestore, type Transaction, type DocumentData} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {accountDeletionPath} from "./account_deletion_guard.js";
import type {AccountDeletionStepContext} from "./account_deletion_service.js";
import {parseOwnerBillingStateDocument} from "./owner_billing_state_contract.js";
import {parseOwnerBillingStripeMetadata} from "./owner_billing_webhook.js";
import {ownerBillingStripeIdempotencyKey} from "./owner_billing_lifecycle.js";

export const deletionStripePriceId = "price_1TJKGjBwoT6e93tVkesJPfxD";
// Firestore maps do not preserve property insertion order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const intentCollection = (uid: string) => `${accountDeletionPath(uid)}/billing_intents`;
const checkoutCollection = (uid: string) => `private_owner_billing_states/${uid}/checkout_intents`;
const terminal = (status: string) => status === "canceled" || status === "incomplete_expired";
const stripeId = (value: unknown, prefix: string): value is string => typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
const customer = (value: {customer: unknown}): string | null => typeof value.customer === "string" ? value.customer :
  value.customer && typeof value.customer === "object" && "id" in value.customer ? String(value.customer.id) : null;

export interface AccountDeletionBillingAdapter {
  listSubscriptions(customerId: string, after?: string): Promise<{data: Stripe.Subscription[]; has_more: boolean}>;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  cancelSubscription(id: string): Promise<void>;
  listCheckouts(expiresAt: number, customerId?: string, after?: string): Promise<{data: Stripe.Checkout.Session[]; has_more: boolean; providerNowMs: number}>;
  retrieveCheckout(id: string): Promise<Stripe.Checkout.Session>;
  expireCheckout(id: string): Promise<void>;
  replayCheckout(body: Stripe.Checkout.SessionCreateParams, idempotencyKey: string): Promise<Stripe.Checkout.Session>;
}

export function createAccountDeletionStripeAdapter(stripe: Stripe): AccountDeletionBillingAdapter {
  const options = {timeout: 10_000, maxNetworkRetries: 0};
  return {
    listSubscriptions: (customerId, after) => stripe.subscriptions.list({customer: customerId, status: "all", limit: 25, ...(after ? {starting_after: after} : {})}, options),
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id, {}, options),
    async cancelSubscription(id) { await stripe.subscriptions.cancel(id, {invoice_now: false, prorate: false}, options); },
    async listCheckouts(expiresAt, customerId, after) {
      const result = await stripe.checkout.sessions.list({created: {gte: expiresAt - 24 * 60 * 60, lte: expiresAt}, limit: 25,
        ...(customerId ? {customer: customerId} : {}), ...(after ? {starting_after: after} : {})}, options);
      return {data: result.data, has_more: result.has_more, providerNowMs: Date.parse(String(result.lastResponse.headers.date ?? ""))};
    },
    retrieveCheckout: (id) => stripe.checkout.sessions.retrieve(id, {}, options),
    async expireCheckout(id) { await stripe.checkout.sessions.expire(id, {}, options); },
    replayCheckout: (body, idempotencyKey) => stripe.checkout.sessions.create(body, {...options, idempotencyKey}),
  };
}

/** Called only after exact server v2 metadata validation. Queues every owned
 * subscription even when the normal latest-subscription ledger rejects a late
 * event. The job revision is a completion barrier, not event ordering. */
export async function queueAccountDeletionSubscription(
  db: Firestore, tx: Transaction, uid: string,
  value: {subscriptionId: string; customerId: string; checkoutAttemptId: string},
): Promise<boolean> {
  if (!stripeId(value.subscriptionId, "sub") || !stripeId(value.customerId, "cus")) throw new Error("Invalid billing identity");
  const jobRef = db.doc(accountDeletionPath(uid));
  const job = await tx.get(jobRef);
  if (!job.exists) return false;
  const ref = db.collection(intentCollection(uid)).doc(value.subscriptionId);
  const existing = await tx.get(ref);
  if (existing.exists) {
    if (existing.get("customerId") !== value.customerId || existing.get("checkoutAttemptId") !== value.checkoutAttemptId) throw new Error("Cancellation identity changed");
    return true;
  }
  tx.create(ref, {...value, ownerUid: uid, terminal: false, phase: "inspect", createdAt: FieldValue.serverTimestamp()});
  tx.update(jobRef, {billingRevision: FieldValue.increment(1), state: "pending", reason: "billing", nextAttemptAtMs: Date.now(), completedAtMs: FieldValue.delete(), ...(job.get("state") === "complete" ? {phase: "verify", item: null, stageIndex: 0} : {})});
  return true;
}

/** Reservation is recorded in the SAME transaction as the existing billing
 * reservation, closing the crash-before-dispatch gap without a new producer. */
export async function reserveAccountDeletionCheckoutIntent(
  db: Firestore, tx: Transaction, uid: string, attemptId: string,
  previous: {newAttempt: boolean; sessionId: string | null; attemptedAtMs: number},
): Promise<void> {
  const ref = db.collection(checkoutCollection(uid)).doc(attemptId);
  if (!(await tx.get(ref)).exists) tx.create(ref, {
    ownerUid: uid, checkoutAttemptId: attemptId,
    // Only a newly created attempt is proven never dispatched. Older source
    // may have created Stripe work before this recovery child existed.
    phase: previous.newAttempt ? "reserved" : "legacy",
    sessionId: previous.sessionId, dispatchedAtMs: previous.attemptedAtMs, terminal: false,
  });
}

/** Persist the exact already-authorized outbound request BEFORE sessions.create.
 * This is specific billing recovery, not a general outbound-job framework. */
export async function createDeletionAwareCheckout(
  db: Firestore, stripe: Stripe, uid: string, attemptId: string,
  body: Stripe.Checkout.SessionCreateParams,
): Promise<Stripe.Checkout.Session> {
  const key = ownerBillingStripeIdempotencyKey({ownerUid: uid, checkoutAttemptId: attemptId});
  const ref = db.collection(checkoutCollection(uid)).doc(attemptId);
  let fingerprint = "";
  let outbound = body;
  const admitted = await db.runTransaction(async (tx) => {
    const [job, previous] = await tx.getAll(db.doc(accountDeletionPath(uid)), ref);
    if (job.exists) {
      // Reservation preceded deletion but no dispatch was accepted. Persist the
      // closed attempt in this same transaction; throwing here would roll it back.
      if (!previous.exists) tx.create(ref, {ownerUid: uid, checkoutAttemptId: attemptId, terminal: true, confirmedStatus: "not_dispatched"});
      else if (previous.get("phase") === "reserved") tx.update(ref, {terminal: true, confirmedStatus: "not_dispatched"});
      return false;
    }
    const bounded = !previous.exists || previous.get("phase") === "reserved" || previous.get("admissionExpiresAt") !== undefined;
    const expiresAt = previous.get("admissionExpiresAt") ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    outbound = bounded ? {...body, expires_at: expiresAt} : body;
    fingerprint = createHash("sha256").update(canonical(outbound)).digest("hex");
    if (bounded && (Date.now() >= (expiresAt - 60 * 60) * 1000 ||
        (previous.get("phase") === "dispatched" && Date.now() - previous.get("dispatchedAtMs") >= 23 * 60 * 60 * 1000))) {
      throw new HttpsError("failed-precondition", "This Checkout attempt requires reconciliation.");
    }
    const firstRecordedDispatch = !previous.exists || ["reserved", "legacy"].includes(previous.get("phase"));
    if (!firstRecordedDispatch && (previous.get("fingerprint") !== fingerprint || previous.get("idempotencyKey") !== key)) throw new Error("Checkout recovery identity changed");
    if (firstRecordedDispatch) {
      if (previous.exists && (previous.get("ownerUid") !== uid || previous.get("checkoutAttemptId") !== attemptId || previous.get("terminal") !== false)) throw new Error("Checkout reservation is closed");
      const intent = {ownerUid: uid, checkoutAttemptId: attemptId, phase: "dispatched", fingerprint, idempotencyKey: key, body: JSON.parse(canonical(outbound)), ...(bounded ? {admissionExpiresAt: expiresAt} : {}), dispatchedAtMs: previous.get("phase") === "legacy" ? previous.get("dispatchedAtMs") : Date.now(), sessionId: previous.exists ? previous.get("sessionId") ?? null : null, terminal: false};
      if (previous.exists) tx.update(ref, intent); else tx.create(ref, intent);
    }
    return true;
  });
  if (!admitted) throw new HttpsError("failed-precondition", "Account deletion is in progress.");
  const session = await stripe.checkout.sessions.create(outbound, {idempotencyKey: key});
  const deleting = await db.runTransaction(async (tx) => {
    const [job, current] = await tx.getAll(db.doc(accountDeletionPath(uid)), ref);
    if (!current.exists || current.get("fingerprint") !== fingerprint) throw new Error("Checkout recovery state changed");
    tx.update(ref, {sessionId: session.id, body: FieldValue.delete()});
    if (job.exists) tx.update(job.ref, {billingRevision: FieldValue.increment(1), state: "pending", reason: "billing", nextAttemptAtMs: Date.now(), completedAtMs: FieldValue.delete(), ...(job.get("state") === "complete" ? {phase: "verify", item: null, stageIndex: 0} : {})});
    return job.exists;
  });
  if (deleting) throw new HttpsError("failed-precondition", "Account deletion is in progress.");
  return session;
}

function ownedSubscription(raw: Stripe.Subscription, expected: {uid: string; subscriptionId: string; customerId: string; checkoutAttemptId: string}): void {
  const metadata = parseOwnerBillingStripeMetadata(raw.metadata);
  if (!metadata || raw.id !== expected.subscriptionId || customer(raw) !== expected.customerId ||
      metadata.ownerUid !== expected.uid || metadata.restaurantAccountId !== expected.uid || metadata.checkoutAttemptId !== expected.checkoutAttemptId) throw new Error("Subscription ownership is unproven");
  if (terminal(raw.status)) return;
  // Current BiteStar creates exactly one licensed fixed-price item. Additional
  // metered/schedule/transfer billing requires a specific money-handling policy.
  if (raw.schedule || raw.pending_invoice_item_interval || raw.transfer_data || raw.items.has_more || raw.items.data.length !== 1 ||
      raw.items.data[0].price.id !== deletionStripePriceId || raw.items.data[0].price.recurring?.usage_type !== "licensed" || raw.items.data[0].quantity !== 1) {
    throw new Error("Unsupported subscription billing mechanism");
  }
}

async function checkpoint(context: AccountDeletionStepContext, path: string, patch: DocumentData): Promise<void> {
  await context.db.runTransaction(async (tx) => { await context.assertLease(tx); tx.update(context.db.doc(path), patch); });
}

/** Returns true only when every known owned subscription and accepted Checkout
 * is settled. A false result is automatically retried, before content cleanup. */
export async function reconcileAccountDeletionBilling(context: AccountDeletionStepContext, adapter: AccountDeletionBillingAdapter): Promise<boolean> {
  const {db, job} = context;
  const billingRef = db.doc(`private_owner_billing_states/${job.uid}`);
  const snapshot = await billingRef.get();
  const billing = parseOwnerBillingStateDocument(snapshot.exists ? {id: job.uid, data: snapshot.data()!} : null);
  const account = await db.doc(`restaurant_accounts/${job.uid}`).get();
  if (snapshot.exists && !billing) throw new Error("Invalid billing state");
  if (!billing && account.exists && ["stripeCustomerId", "stripeSubscriptionId"].some((field) => account.get(field))) throw new Error("Billing association needs recovery");
  if (billing?.stripeSubscriptionId && billing.stripeCustomerId && billing.checkoutAttemptId) {
    await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      await queueAccountDeletionSubscription(db, tx, job.uid, {subscriptionId: billing.stripeSubscriptionId!, customerId: billing.stripeCustomerId!, checkoutAttemptId: billing.checkoutAttemptId!});
    });
  }
  const page = await db.collection(intentCollection(job.uid)).where("terminal", "==", false).limit(1).get();
  if (!page.empty) {
    const intent = page.docs[0], value = intent.data();
    await db.runTransaction(async (tx) => { await context.assertLease(tx); });
    // Retrieve first on EVERY retry, including response-loss after cancellation.
    const subscription = await adapter.retrieveSubscription(intent.id);
    ownedSubscription(subscription, {uid: job.uid, subscriptionId: intent.id, customerId: value.customerId, checkoutAttemptId: value.checkoutAttemptId});
    if (terminal(subscription.status)) {
      await checkpoint(context, intent.ref.path, {terminal: true, confirmedStatus: subscription.status, confirmedAt: FieldValue.serverTimestamp()});
    } else if (value.phase !== "cancel") {
      await checkpoint(context, intent.ref.path, {phase: "cancel"}); // durable intent before external effect
    } else {
      await adapter.cancelSubscription(intent.id);
      // Response itself is insufficient: next step retrieves terminal state.
      await checkpoint(context, intent.ref.path, {phase: "verify"});
    }
    return false;
  }
  if (billing?.stripeCustomerId && (job.billingScanCustomer !== billing.stripeCustomerId || job.billingScanComplete !== true)) {
    const after = job.billingScanCustomer === billing.stripeCustomerId ? job.billingScanAfter : undefined;
    const page = await adapter.listSubscriptions(billing.stripeCustomerId, typeof after === "string" ? after : undefined);
    if (page.data.length > 25 || (page.has_more && page.data.length === 0)) throw new Error("Invalid bounded subscription page");
    for (const subscription of page.data) {
      let metadata;
      try { metadata = parseOwnerBillingStripeMetadata(subscription.metadata); } catch { continue; }
      // Reading a shared customer's page never authorizes canceling all rows.
      if (metadata.ownerUid !== job.uid || metadata.restaurantAccountId !== job.uid || customer(subscription) !== billing.stripeCustomerId) continue;
      await db.runTransaction(async (tx) => { await context.assertLease(tx); await queueAccountDeletionSubscription(db, tx, job.uid, {subscriptionId: subscription.id, customerId: billing.stripeCustomerId!, checkoutAttemptId: metadata.checkoutAttemptId}); });
    }
    await checkpoint(context, accountDeletionPath(job.uid), {billingScanCustomer: billing.stripeCustomerId, billingScanAfter: page.data.length ? page.data[page.data.length - 1].id : null, billingScanComplete: !page.has_more});
    return false;
  }
  if (billing?.checkoutSessionId && billing.checkoutAttemptId) {
    const ref = db.collection(checkoutCollection(job.uid)).doc(billing.checkoutAttemptId);
    await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(ref);
      if (!current.exists) tx.create(ref, {ownerUid: job.uid, checkoutAttemptId: billing.checkoutAttemptId, sessionId: billing.checkoutSessionId, terminal: false});
      else {
        if (current.get("ownerUid") !== job.uid || current.get("checkoutAttemptId") !== billing.checkoutAttemptId ||
            (current.get("sessionId") && current.get("sessionId") !== billing.checkoutSessionId)) throw new Error("Checkout session binding changed");
        if (!current.get("sessionId")) tx.update(ref, {sessionId: billing.checkoutSessionId, phase: "dispatched", terminal: false, confirmedStatus: FieldValue.delete()});
      }
    });
  }
  const accepted = await db.collection(checkoutCollection(job.uid)).where("terminal", "==", false).limit(1).get();
  if (!accepted.empty) {
    const intent = accepted.docs[0], value = intent.data();
    if (value.ownerUid !== job.uid || value.checkoutAttemptId !== intent.id) throw new Error("Checkout intent ownership changed");
    await db.runTransaction(async (tx) => { await context.assertLease(tx); });
    if (value.phase === "reserved") {
      await db.runTransaction(async (tx) => {
        await context.assertLease(tx);
        const current = await tx.get(intent.ref);
        if (current.get("phase") === "reserved") tx.update(intent.ref, {terminal: true, confirmedStatus: "not_dispatched"});
      });
      return false;
    }
    let session: Stripe.Checkout.Session;
    if (value.sessionId) session = await adapter.retrieveCheckout(value.sessionId);
    else {
      if (!value.body || context.now() < value.dispatchedAtMs ||
          value.idempotencyKey !== ownerBillingStripeIdempotencyKey({ownerUid: job.uid, checkoutAttemptId: intent.id}) ||
          createHash("sha256").update(canonical(value.body)).digest("hex") !== value.fingerprint) throw new Error("Uncertain Checkout needs bounded reconciliation");
      if (context.now() - value.dispatchedAtMs < 23 * 60 * 60 * 1000) {
        session = await adapter.replayCheckout(value.body, value.idempotencyKey);
        await checkpoint(context, intent.ref.path, {sessionId: session.id, body: FieldValue.delete()});
      } else {
        // Frozen expiry bounds server admission even if the first network call
        // outlives the caller. Never create again beyond Stripe's replay window.
        const expiry = value.admissionExpiresAt;
        if (!Number.isSafeInteger(expiry) || value.body.expires_at !== expiry) throw new Error("Historical Checkout has no admission bound");
        if (context.now() < expiry * 1000) return false;
        const scopedCustomer = typeof value.body.customer === "string" ? value.body.customer : undefined;
        const page = await adapter.listCheckouts(expiry, scopedCustomer, value.discoveryAfter ?? undefined);
        if (!Number.isFinite(page.providerNowMs) || page.providerNowMs < expiry * 1000 || page.data.length > 25 || (page.has_more && page.data.length === 0)) throw new Error("Checkout admission closure unproven");
        let found: Stripe.Checkout.Session | undefined;
        for (const candidate of page.data) {
          let metadata;
          try { metadata = parseOwnerBillingStripeMetadata(candidate.metadata); } catch { continue; }
          if (metadata?.ownerUid !== job.uid || metadata.restaurantAccountId !== job.uid || metadata.checkoutAttemptId !== intent.id) continue;
          if (found || candidate.client_reference_id !== job.uid || candidate.mode !== "subscription" || candidate.expires_at !== expiry ||
              (scopedCustomer && customer(candidate) !== scopedCustomer)) throw new Error("Checkout discovery identity changed");
          found = candidate;
        }
        if (!found) {
          await checkpoint(context, intent.ref.path, page.has_more ? {discoveryAfter: page.data[page.data.length - 1].id} :
            {terminal: true, confirmedStatus: "closed_admission_no_session", body: FieldValue.delete()});
          return false;
        }
        session = found;
        await checkpoint(context, intent.ref.path, {sessionId: session.id, body: FieldValue.delete()});
      }
    }
    const metadata = parseOwnerBillingStripeMetadata(session.metadata);
    if (!metadata || metadata.ownerUid !== job.uid || metadata.checkoutAttemptId !== intent.id || session.client_reference_id !== job.uid || session.mode !== "subscription") throw new Error("Checkout ownership is unproven");
    if (session.status === "open") { await adapter.expireCheckout(session.id); return false; }
    if (session.status === "complete") {
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      const customerId = customer(session);
      if (!subscriptionId || !customerId) throw new Error("Completed Checkout has no subscription association");
      await db.runTransaction(async (tx) => { await context.assertLease(tx);
        await queueAccountDeletionSubscription(db, tx, job.uid, {subscriptionId, customerId, checkoutAttemptId: intent.id});
        tx.update(intent.ref, {terminal: true, confirmedStatus: "complete", body: FieldValue.delete()});
      });
    } else if (session.status === "expired") await checkpoint(context, intent.ref.path, {terminal: true, confirmedStatus: "expired", body: FieldValue.delete()});
    else throw new Error("Checkout terminal state is unproven");
    return false;
  }
  // Earlier source did not persist full outbound intents. Never invent replay
  // parameters or assume an unknown/missing session means no subscription.
  if (billing && ["checkout_pending", "unknown"].includes(billing.lifecycleState)) {
    if (!billing.checkoutAttemptId) throw new Error("Unsettled billing state");
    const accepted = await db.collection(checkoutCollection(job.uid)).doc(billing.checkoutAttemptId).get();
    if (!accepted.exists || accepted.get("terminal") !== true) throw new Error("Legacy accepted Checkout needs reconciliation");
  }
  return true;
}
