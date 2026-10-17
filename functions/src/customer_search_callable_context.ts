import {createHmac} from "node:crypto";
import {type CallableRequest, HttpsError} from "firebase-functions/v2/https";
import {requireRestaurantAccountAdminAccess} from "./admin_authorization.js";
import {OpaqueCursorCodec} from "./opaque_cursor.js";
import type {CustomerBiteSaverCallableIdentity} from "./customer_bitesaver_search_session.js";

/** Only a verified callable request belongs here; request.data is never identity. */
export function customerBiteSaverCallableIdentity(
  request: Pick<CallableRequest<unknown>, "auth">,
): CustomerBiteSaverCallableIdentity {
  return Object.freeze({authUid: request.auth?.uid ?? null,
    authIsAnonymous: request.auth?.token.firebase?.sign_in_provider === "anonymous"});
}

export function customerBiteScoreActorBinding(key: Uint8Array, uid: string | null, instance: string): string {
  return createHmac("sha256", key).update(JSON.stringify(uid === null
    ? ["bitestar.customer-bitescore.actor.v1", "guest", instance]
    : ["bitestar.customer-bitescore.actor.v1", "user", uid])).digest("hex");
}

/** Same actor and cursor derivation for legacy callables and isolated candidate. */
export function customerBiteScoreCallableContext(request: CallableRequest<unknown>, root: Uint8Array | (() => Uint8Array)) {
  const raw = request.data as {clientInstanceId?: unknown} | null;
  const instance = raw?.clientInstanceId;
  if (typeof instance !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(instance)) {
    throw new HttpsError("invalid-argument", "Invalid BiteScore client binding.");
  }
  const key = createHmac("sha256", typeof root === "function" ? root() : root)
    .update("bitestar.customer-bitescore.cursor-key.v1").digest();
  const uid = request.auth?.uid ?? null;
  const actorId = customerBiteScoreActorBinding(key, uid, instance);
  let isAdmin = false;
  try { requireRestaurantAccountAdminAccess(request); isAdmin = true; } catch { /* public caller */ }
  return {actorId, cursorCodec: new OpaqueCursorCodec({key}), userId: uid, isAdmin};
}
