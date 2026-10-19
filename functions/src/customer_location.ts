import {createHash, randomUUID} from "node:crypto";
import type {Firestore} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {
  geocodeCustomerUsSearchCenter, normalizeCustomerLocationQuery,
  RestaurantGeocodingError, type RestaurantGeocodingDependencies,
} from "./restaurant_geocoding.js";

export const customerLocationAdmissionPath = "private_customer_location/admission";
export const customerLocationMaximumDailyLimit = 250;
export const customerLocationCacheSeconds = 24 * 60 * 60;

export function customerLocationDailyLimit(value: unknown): number {
  if (typeof value !== "string" || !/^[0-9]{1,3}$/.test(value)) return 0;
  const limit = Number(value);
  return limit <= customerLocationMaximumDailyLimit ? limit : 0;
}

type Counter = {dayCount: number; minute: number; minuteCount: number};
function counter(value: unknown, minute: number): Counter {
  if (value === undefined) return {dayCount: 0, minute, minuteCount: 0};
  const c = value as Counter;
  if (!c || ![c.dayCount, c.minute, c.minuteCount].every((n) => Number.isSafeInteger(n) && n >= 0)) {
    throw new HttpsError("unavailable", "Location lookup is temporarily unavailable.");
  }
  return {...c, minute, minuteCount: c.minute === minute ? c.minuteCount : 0};
}

/** One fixed private document, bounded maps; same reserve-before-provider pattern
 * as photo screening. Rotating guest IDs cannot bypass the shared daily pool.
 * Failed, timed-out and replayed requests consume their reservation; no refunds.
 */
export function createCustomerLocationAdmission(db: Firestore, now = Date.now) {
  return async (actor: string, allowance: number): Promise<() => Promise<void>> => {
    const at = now();
    const day = new Date(at).toISOString().slice(0, 10);
    const minute = Math.floor(at / 60_000);
    const attempt = randomUUID();
    const ref = db.doc(customerLocationAdmissionPath);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const raw = snap.data();
      const data = raw?.day === day ? raw : {};
      const total = counter(data.total, minute);
      const actors = data.actors ?? {};
      const own = counter(actors[actor], minute);
      const active = Object.fromEntries(Object.entries(data.active ?? {})
        .filter(([, until]) => typeof until === "number" && until > at));
      if (!Number.isInteger(allowance) || allowance <= 0 || allowance > customerLocationMaximumDailyLimit ||
          total.dayCount >= allowance || total.minuteCount >= 20 || own.dayCount >= 20 ||
          own.minuteCount >= 3 || Object.keys(active).length >= 4) {
        throw new HttpsError("resource-exhausted", "Location lookup is busy or paused. Please try later.");
      }
      tx.set(ref, {day,
        total: {...total, dayCount: total.dayCount + 1, minuteCount: total.minuteCount + 1},
        actors: {...actors, [actor]: {...own, dayCount: own.dayCount + 1, minuteCount: own.minuteCount + 1}},
        active: {...active, [attempt]: at + 30_000},
      });
    });
    return async () => {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.get("day") !== day) return;
        const active = {...(snap.get("active") ?? {})};
        delete active[attempt];
        tx.update(ref, {active});
      });
    };
  };
}

export type CustomerLocationDependencies = RestaurantGeocodingDependencies & {
  dailyLimit: () => number;
  reserve: (actor: string, allowance: number) => Promise<() => Promise<void>>;
};

export async function resolveCustomerLocationHandler(
  data: unknown, authUid: string | null, dependencies: CustomerLocationDependencies,
) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).sort().join(",") !== "clientInstanceId,query,schemaVersion") {
    throw new HttpsError("invalid-argument", "Invalid location request.");
  }
  const input = data as Record<string, unknown>;
  if (input.schemaVersion !== 1 || typeof input.clientInstanceId !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(input.clientInstanceId)) {
    throw new HttpsError("invalid-argument", "Invalid location request.");
  }
  let release: (() => Promise<void>) | undefined;
  try {
    const query = normalizeCustomerLocationQuery(input.query);
    // Google's ranked first result cannot establish nationwide city uniqueness.
    // Require state before spending, unless the client reuses a center the user
    // already confirmed. No arbitrary business/street/address proxy is exposed.
    if (query.kind === "city" && query.state === null) {
      throw new HttpsError("invalid-argument", "Include the state, for example Ocala, FL.");
    }
    const allowance = dependencies.dailyLimit();
    if (!Number.isInteger(allowance) || allowance <= 0 || allowance > customerLocationMaximumDailyLimit) {
      throw new HttpsError("failed-precondition", "City and ZIP lookup is not available right now. Use your current location or try later.");
    }
    let apiKey: string;
    try { apiKey = dependencies.getGeocodingApiKey(); } catch { apiKey = ""; }
    if (typeof apiKey !== "string" || !apiKey.trim()) throw new RestaurantGeocodingError("missing-configuration");
    const actor = createHash("sha256").update(JSON.stringify(authUid === null
      ? ["customer-location-v1", "guest", input.clientInstanceId]
      : ["customer-location-v1", "user", authUid])).digest("hex");
    release = await dependencies.reserve(actor, allowance);
    const center = await geocodeCustomerUsSearchCenter(query, {...dependencies, getGeocodingApiKey: () => apiKey});
    return {schemaVersion: 1, ...center, provider: "google", cacheSeconds: customerLocationCacheSeconds};
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof RestaurantGeocodingError) {
      const message = error.kind === "invalid-input" ? "Enter a US ZIP code or city and state."
        : error.kind === "no-result" || error.kind === "untrustworthy-result" || error.kind === "ambiguous-result"
          ? "That location could not be confirmed. Check the ZIP code or enter city and state."
          : error.kind === "timeout" ? "Location lookup timed out. Please try again."
            : "City and ZIP lookup is temporarily unavailable. Use your current location or try later.";
      throw new HttpsError(error.code, message);
    }
    throw new HttpsError("unavailable", "Location lookup is temporarily unavailable.");
  } finally {
    // A failed release leaves only a short lease; never refund the paid allowance.
    try { await release?.(); } catch { /* no provider payload or request logging */ }
  }
}
