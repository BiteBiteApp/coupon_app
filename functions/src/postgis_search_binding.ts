import {createHash} from "node:crypto";
import type {CustomerBiteSaverStoredDocument} from "./customer_bitesaver_search_store.js";
import {type Firestore} from "firebase-admin/firestore";
import {requirePostgisSourceConfiguration, type PostgisSourceConfiguration} from "./postgis_source_firestore.js";

export const postgisSearchBindingCollection = "private_postgis_search_bindings";

/** Server-supplied admission evidence. Never populated from callable data. */
export type PostgisSearchAdmission = Readonly<{
  revision: string;
  pinId: string;
  expiresAtMs: number;
}>;

export type PostgisSearchBinding = PostgisSearchAdmission & Readonly<{
  schemaVersion: 1;
  backend: "postgis";
  sessionId: string;
  expiresAt: Date;
  state: "ready";
}>;

export type PostgisPendingSearchBinding = Readonly<{
  schemaVersion: 1; backend: "postgis"; state: "preparing";
  sessionId: string; revision: null; pinId: string; expiresAtMs: number; expiresAt: Date;
}>;

export function postgisSearchBindingPath(sessionId: string): string {
  if (!/^(?:bss_[A-Za-z0-9_-]{43}|[a-f0-9]{64})$/u.test(sessionId)) {
    throw new Error("Invalid candidate search session binding.");
  }
  return `${postgisSearchBindingCollection}/${sessionId}`;
}

export function buildPostgisSearchBinding(
  sessionId: string,
  admission: PostgisSearchAdmission,
  absoluteExpiresAtMs: number,
): PostgisSearchBinding {
  postgisSearchBindingPath(sessionId);
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(admission.revision) ||
      !/^[a-f0-9]{64}$/u.test(admission.pinId) ||
      !Number.isSafeInteger(admission.expiresAtMs) ||
      admission.expiresAtMs < absoluteExpiresAtMs) {
    throw new Error("The candidate search revision is not retained for this session.");
  }
  return Object.freeze({schemaVersion: 1, backend: "postgis", state: "ready", sessionId,
    revision: admission.revision, pinId: admission.pinId,
    expiresAtMs: admission.expiresAtMs, expiresAt: new Date(admission.expiresAtMs)});
}

export function buildPostgisPendingSearchBinding(
  sessionId: string, absoluteExpiresAtMs: number,
): PostgisPendingSearchBinding {
  postgisSearchBindingPath(sessionId);
  if (!Number.isSafeInteger(absoluteExpiresAtMs) || absoluteExpiresAtMs < 0) {
    throw new Error("Invalid candidate search expiry.");
  }
  return Object.freeze({schemaVersion: 1, backend: "postgis", state: "preparing", sessionId,
    revision: null, pinId: createHash("sha256").update(`postgis.session.pin.v1:${sessionId}`).digest("hex"),
    expiresAtMs: absoluteExpiresAtMs, expiresAt: new Date(absoluteExpiresAtMs)});
}

export function readPostgisSearchBinding(
  document: CustomerBiteSaverStoredDocument | null,
  sessionId: string,
): PostgisSearchBinding | PostgisPendingSearchBinding | null {
  if (document === null) return null;
  const data = document.data;
  if (document.path !== postgisSearchBindingPath(sessionId) ||
      data.schemaVersion !== 1 || data.backend !== "postgis" ||
      data.sessionId !== sessionId ||
      typeof data.pinId !== "string" || typeof data.expiresAtMs !== "number") {
    throw new Error("Invalid candidate search revision binding.");
  }
  if (data.state === "preparing" && data.revision === null) {
    const pending = buildPostgisPendingSearchBinding(sessionId, data.expiresAtMs);
    if (pending.pinId !== data.pinId) throw new Error("Invalid candidate search pin.");
    return pending;
  }
  if (data.state !== "ready" || typeof data.revision !== "string") {
    throw new Error("Invalid candidate search readiness.");
  }
  return buildPostgisSearchBinding(sessionId, {
    revision: data.revision, pinId: data.pinId, expiresAtMs: data.expiresAtMs,
  }, data.expiresAtMs);
}

export function searchBackendMatches(
  binding: PostgisSearchBinding | PostgisPendingSearchBinding | null,
  backend: "postgis" | undefined,
): boolean {
  return backend === "postgis" ? binding !== null : binding === null;
}

/** Explicit candidate maintenance only. Construction performs no reads/writes;
 * no scheduler or production TTL policy is registered by importing this module.
 */
export function createFirestorePostgisBindingPruner(
  database: Firestore, configuration: PostgisSourceConfiguration,
): (nowMs?: number, limit?: number) => Promise<{deleted: number}> {
  requirePostgisSourceConfiguration(database, configuration);
  return async (nowMs = Date.now(), limit = 100) => {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
        !Number.isInteger(limit) || limit < 1 || limit > 400) {
      throw new Error("Invalid bounded PostGIS binding cleanup.");
    }
    return database.runTransaction(async transaction => {
      const expired = await transaction.get(database.collection(postgisSearchBindingCollection)
        .where("expiresAtMs", "<=", nowMs).orderBy("expiresAtMs").limit(limit));
      // The query and deletes share a transaction: an expiry extended while this
      // page is read causes a retry, so a newly live binding cannot be deleted.
      for (const document of expired.docs) {
        const binding = readPostgisSearchBinding({id: document.id, path: document.ref.path,
          data: document.data()}, document.id);
        if (binding === null || binding.expiresAtMs > nowMs) throw new Error("Invalid expired PostGIS binding.");
      }
      for (const document of expired.docs) transaction.delete(document.ref);
      return {deleted: expired.size};
    });
  };
}
