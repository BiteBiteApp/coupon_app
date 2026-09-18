import {createHash, randomBytes, timingSafeEqual} from "node:crypto";
import {
  customerBiteSaverDeviceChallengeCleanupDelayMilliseconds,
  customerBiteSaverDeviceChallengeLifetimeMilliseconds,
  type CustomerBiteSaverDeviceChallengeAdmission,
  type CustomerBiteSaverDevicePlatform,
} from "./customer_bitesaver_device_proof_contract.js";
import {
  customerBiteSaverCombinedUseRequestFingerprint,
  customerBiteSaverDeviceUsePurpose,
  customerBiteSaverSignedUserId,
  type CustomerBiteSaverCombinedUseRequest,
  type CustomerBiteSaverDeviceUseContext,
} from "./customer_bitesaver_device_usage_core.js";
import {authenticateCustomerBiteSaverDiscoveryChallengeAuthority} from
  "./customer_bitesaver_search_session.js";
import {authenticateCustomerBiteSaverSavedChallengeAuthority} from
  "./customer_bitesaver_saved.js";
import {customerBiteSaverDeterministicId} from
  "./customer_bitesaver_search_cursor.js";
import {CustomerBiteSaverContractError} from
  "./customer_bitesaver_search_contract.js";
import type {CustomerBiteSaverStoredDocument, CustomerBiteSaverTransaction} from
  "./customer_bitesaver_search_store.js";

export const customerBiteSaverDeviceChallengeAllowanceSize = 30 as const;
const collection = "private_bitesaver_device_challenges";
const windowMillis = customerBiteSaverDeviceChallengeLifetimeMilliseconds;
const handlePattern = /^bsda_[A-Za-z0-9_-]{43}$/u;
const hashPattern = /^[0-9a-f]{64}$/u;

type Reservation = Readonly<{
  permitHash: string;
  requestFingerprint: string;
  platform: CustomerBiteSaverDevicePlatform;
  authenticatedUserId: string | null;
  origin: "discovery" | "saved";
  purpose: typeof customerBiteSaverDeviceUsePurpose;
  createdAt: Date;
  expiresAt: Date;
  authorityExpiresAt: Date;
  consumedAt: Date | null;
}>;

type Allowance = Readonly<{
  schemaVersion: 1;
  role: "deviceChallengeAllowance";
  admissionHandle: string;
  scope: "guestSession" | "signedAccount";
  scopeSubject: string;
  reservations: readonly Reservation[];
  deleteAfter: Date;
}>;

export class CustomerBiteSaverDeviceChallengeLimitError extends
  CustomerBiteSaverContractError {
  readonly retryAfterMillis: number;

  constructor(retryAfterMillis: number) {
    super("resource-exhausted", "Device verification is temporarily limited. Try again shortly.");
    this.retryAfterMillis = Math.max(1, Math.min(windowMillis, retryAfterMillis));
  }
}

function invalid(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition", "The device verification allowance is unavailable.",
  );
}

function denied(): never {
  throw new CustomerBiteSaverContractError(
    "permission-denied", "The device verification permit is invalid or expired.",
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function time(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 ||
    value > 8_640_000_000_000_000 - windowMillis -
      customerBiteSaverDeviceChallengeCleanupDelayMilliseconds) return invalid();
  return value;
}

function date(value: unknown): Date {
  let candidate = value;
  if (candidate !== null && typeof candidate === "object" && !(candidate instanceof Date)) {
    const toDate = (candidate as {toDate?: unknown}).toDate;
    if (typeof toDate !== "function") return invalid();
    try { candidate = toDate.call(candidate); } catch { return invalid(); }
  }
  if (!(candidate instanceof Date)) return invalid();
  time(candidate.getTime());
  return candidate;
}

function releaseAt(entry: Reservation): number {
  return entry.consumedAt === null ? entry.expiresAt.getTime() :
    entry.consumedAt.getTime() + windowMillis;
}

function cleanupAt(entries: readonly Reservation[]): Date {
  return new Date(Math.max(...entries.map(releaseAt)) +
    customerBiteSaverDeviceChallengeCleanupDelayMilliseconds);
}

function parseAllowance(document: CustomerBiteSaverStoredDocument | null, handle: string): Allowance | null {
  if (document === null) return null;
  const data = document.data;
  if (document.id !== handle || document.path !== `${collection}/${handle}` ||
    !record(data) || !keys(data, ["schemaVersion", "role", "admissionHandle", "scope",
      "scopeSubject", "reservations", "deleteAfter"]) ||
    data.schemaVersion !== 1 || data.role !== "deviceChallengeAllowance" ||
    data.admissionHandle !== handle || !handlePattern.test(handle) ||
    (data.scope !== "guestSession" && data.scope !== "signedAccount") ||
    typeof data.scopeSubject !== "string" || data.scopeSubject.length === 0 ||
    Buffer.byteLength(data.scopeSubject, "utf8") > 128 ||
    (data.scope === "guestSession" && !/^bss_[A-Za-z0-9_-]{43}$/u.test(data.scopeSubject)) ||
    !Array.isArray(data.reservations) || data.reservations.length === 0 ||
    data.reservations.length > customerBiteSaverDeviceChallengeAllowanceSize) return invalid();
  const seen = new Set<string>();
  const reservations = data.reservations.map((raw): Reservation => {
    if (!record(raw) || !keys(raw, ["permitHash", "requestFingerprint", "platform",
      "authenticatedUserId", "origin", "purpose", "createdAt", "expiresAt",
      "authorityExpiresAt", "consumedAt"]) ||
      typeof raw.permitHash !== "string" || !hashPattern.test(raw.permitHash) ||
      seen.has(raw.permitHash) ||
      typeof raw.requestFingerprint !== "string" || !hashPattern.test(raw.requestFingerprint) ||
      (raw.platform !== "android" && raw.platform !== "ios") ||
      (raw.origin !== "discovery" && raw.origin !== "saved") ||
      raw.purpose !== customerBiteSaverDeviceUsePurpose ||
      raw.authenticatedUserId !== (data.scope === "signedAccount" ? data.scopeSubject : null) ||
      (data.scope === "guestSession" && raw.origin !== "discovery")) return invalid();
    seen.add(raw.permitHash);
    const createdAt = date(raw.createdAt);
    const expiresAt = date(raw.expiresAt);
    const authorityExpiresAt = date(raw.authorityExpiresAt);
    const consumedAt = raw.consumedAt === null ? null : date(raw.consumedAt);
    if (expiresAt.getTime() <= createdAt.getTime() ||
      expiresAt.getTime() > createdAt.getTime() + windowMillis ||
      expiresAt.getTime() > authorityExpiresAt.getTime() ||
      (consumedAt !== null && (consumedAt.getTime() < createdAt.getTime() ||
        consumedAt.getTime() >= expiresAt.getTime()))) return invalid();
    return Object.freeze({...raw, createdAt, expiresAt, authorityExpiresAt, consumedAt}) as Reservation;
  });
  const deleteAfter = date(data.deleteAfter);
  if (deleteAfter.getTime() !== cleanupAt(reservations).getTime()) return invalid();
  return Object.freeze({...data, reservations, deleteAfter}) as unknown as Allowance;
}

function permitHash(permit: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(permit)) return denied();
  const bytes = Buffer.from(permit, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== permit) return denied();
  return createHash("sha256").update("BiteSaver/device-challenge-permit/v1\0").update(bytes).digest("hex");
}

/** Only authenticated origin authority can allocate one of the fixed slots. */
export async function reserveCustomerBiteSaverDeviceChallengeAdmission(value: {
  request: CustomerBiteSaverCombinedUseRequest;
  platform: CustomerBiteSaverDevicePlatform;
  context: CustomerBiteSaverDeviceUseContext;
}): Promise<CustomerBiteSaverDeviceChallengeAdmission> {
  const {request, context, platform} = value;
  if (platform !== "android" && platform !== "ios") return invalid();
  const authenticatedUserId = customerBiteSaverSignedUserId(context.identity);
  const clock = context.now ?? Date.now;
  const requestFingerprint = customerBiteSaverCombinedUseRequestFingerprint(request);
  // Randomness is never a scope key, and only its digest is stored.
  const entropy = (context.randomSource ?? randomBytes)(32);
  if (!(entropy instanceof Uint8Array) || entropy.length !== 32) return invalid();
  const permit = Buffer.from(entropy).toString("base64url");
  const digest = permitHash(permit);
  return context.database.runTransaction(async (transaction) => {
    const initialNow = time(clock());
    let guestSessionId: string | null = null;
    let recoveryExpiresAtMillis: number;
    if (request.origin.kind === "discovery") {
      const authority = await authenticateCustomerBiteSaverDiscoveryChallengeAuthority(
        request, context, transaction, initialNow,
      );
      guestSessionId = authority.guestSessionId;
      recoveryExpiresAtMillis = authority.recoveryExpiresAtMillis;
    } else {
      recoveryExpiresAtMillis = authenticateCustomerBiteSaverSavedChallengeAuthority(
        request, context, initialNow,
      ).recoveryExpiresAtMillis;
    }
    const scope = authenticatedUserId === null ? "guestSession" : "signedAccount";
    const scopeSubject = authenticatedUserId ?? guestSessionId ?? invalid();
    const admissionHandle = customerBiteSaverDeterministicId(
      context.discoveryKey, "bsda", "deviceChallengeAllowance/v1", [scope, scopeSubject],
    );
    const path = `${collection}/${admissionHandle}`;
    const stored = parseAllowance(await transaction.getDocument(path), admissionHandle);
    if (stored !== null && (stored.scope !== scope || stored.scopeSubject !== scopeSubject)) return invalid();
    const now = time(clock());
    if (now < initialNow || now >= recoveryExpiresAtMillis) return denied();
    const retained = (stored?.reservations ?? []).filter((entry) => releaseAt(entry) > now);
    if (retained.some((entry) => entry.createdAt.getTime() > now ||
      (entry.consumedAt !== null && entry.consumedAt.getTime() > now))) return invalid();
    if (retained.length >= customerBiteSaverDeviceChallengeAllowanceSize) {
      throw new CustomerBiteSaverDeviceChallengeLimitError(Math.min(...retained.map(releaseAt)) - now);
    }
    if (retained.some((entry) => entry.permitHash === digest)) return invalid();
    const expiresAtMillis = Math.min(now + windowMillis, recoveryExpiresAtMillis);
    const reservations = [...retained, Object.freeze({
      permitHash: digest, requestFingerprint, platform, authenticatedUserId,
      origin: request.origin.kind, purpose: customerBiteSaverDeviceUsePurpose,
      createdAt: new Date(now), expiresAt: new Date(expiresAtMillis),
      authorityExpiresAt: new Date(recoveryExpiresAtMillis), consumedAt: null,
    })];
    const allowance: Allowance = Object.freeze({
      schemaVersion: 1, role: "deviceChallengeAllowance", admissionHandle,
      scope, scopeSubject, reservations, deleteAfter: cleanupAt(reservations),
    });
    transaction.setDocument(path, allowance);
    return Object.freeze({schemaVersion: 1, admissionHandle, permit, expiresAtMillis});
  });
}

/** Read/validate only. The caller writes this update atomically with its challenge. */
export async function consumeCustomerBiteSaverDeviceChallengeAdmission(value: {
  transaction: CustomerBiteSaverTransaction;
  admissionHandle: string;
  permit: string;
  request: CustomerBiteSaverCombinedUseRequest;
  platform: CustomerBiteSaverDevicePlatform;
  authenticatedUserId: string | null;
  now: () => number;
}): Promise<Readonly<{path: string; document: Readonly<Record<string, unknown>>; consumedAtMillis: number}>> {
  if (!handlePattern.test(value.admissionHandle)) return denied();
  const digest = permitHash(value.permit);
  const path = `${collection}/${value.admissionHandle}`;
  const allowance = parseAllowance(await value.transaction.getDocument(path), value.admissionHandle);
  if (allowance === null) return denied();
  if (allowance.scope === "signedAccount"
    ? allowance.scopeSubject !== value.authenticatedUserId
    : value.authenticatedUserId !== null || value.request.origin.kind !== "discovery" ||
      value.request.origin.sessionId !== allowance.scopeSubject) return denied();
  const index = allowance.reservations.findIndex((entry) =>
    timingSafeEqual(Buffer.from(entry.permitHash, "hex"), Buffer.from(digest, "hex")));
  if (index < 0) return denied();
  const entry = allowance.reservations[index];
  const now = time(value.now());
  if (entry.consumedAt !== null || now < entry.createdAt.getTime() ||
    now >= entry.expiresAt.getTime() || now >= entry.authorityExpiresAt.getTime() ||
    entry.authenticatedUserId !== value.authenticatedUserId ||
    entry.platform !== value.platform || entry.origin !== value.request.origin.kind ||
    entry.requestFingerprint !== customerBiteSaverCombinedUseRequestFingerprint(value.request)) return denied();
  const reservations = allowance.reservations.map((candidate, i) => i === index
    ? Object.freeze({...entry, consumedAt: new Date(now)}) : candidate);
  return Object.freeze({
    path, consumedAtMillis: now,
    document: Object.freeze({...allowance, reservations, deleteAfter: cleanupAt(reservations)}),
  });
}
