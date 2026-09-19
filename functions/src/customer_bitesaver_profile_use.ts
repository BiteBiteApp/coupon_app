/** Exact-profile variant of private discovery sessions; uses the existing
 * challenge admission and combined device/account writer at the final tap. */
import {randomBytes} from "node:crypto";
import {createQueryFingerprint} from "./query_fingerprint.js";
import {
  CustomerBiteSaverContractError, customerBiteSaverSearchProtocolVersion,
  customerBiteSaverAbsoluteExpiryMilliseconds, customerBiteSaverIdleExpiryMilliseconds,
  customerBiteSaverStartRateLimit, customerBiteSaverStartRateWindowMilliseconds,
  privateCustomerBiteSaverActiveSessionCollection, requireIanaTimeZone,
  timeZoneSupportsUtcOffset, requireCustomerBiteSaverPublicId,
} from "./customer_bitesaver_search_contract.js";
import {
  customerBiteSaverCallerBinding, customerBiteSaverCapabilityForSession,
  customerBiteSaverCapabilityHash, customerBiteSaverRandomSessionId,
} from "./customer_bitesaver_search_cursor.js";
import {
  authorizeCustomerBiteSaverSession, customerBiteSaverSessionInternals as internals,
  type CustomerBiteSaverSessionAuthority, type CustomerBiteSaverSessionContext,
} from "./customer_bitesaver_search_session.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {resolveCustomerBiteSaverPublicProfile} from "./customer_bitesaver_public_profile.js";
import {
  SavedOpaqueCodec, currentSavedRedemptionSource, resolveCustomerBiteSaverCouponTarget, exactInternalId,
} from "./customer_bitesaver_saved.js";
import type {CustomerBiteSaverStoredDocument, CustomerBiteSaverTransaction} from "./customer_bitesaver_search_store.js";
import type {
  CustomerBiteSaverCombinedUseRequest, CustomerBiteSaverDeviceUseContext,
  CustomerBiteSaverFreshUseAuthorityDecision,
} from "./customer_bitesaver_device_usage_core.js";

const mode = "publicProfileUse" as const;
const protocolVersion = customerBiteSaverSearchProtocolVersion;
type ProfileSession = CustomerBiteSaverSessionAuthority & Readonly<{
  protocolVersion: typeof protocolVersion; schemaVersion: 1; mode: typeof mode;
  state: "ready"; catalogRestaurantId: string; attemptGeneration: 0;
  createdAt: Date; expiresAt: Date;
}>;
const sessionKeys = ["protocolVersion", "schemaVersion", "mode", "state", "catalogRestaurantId",
  "attemptGeneration", "createdAt", "expiresAt", "sessionId", "criteriaFingerprint",
  "callerScope", "callerBindingHash", "authenticatedUidHash", "capabilityHash",
  "logicalExpiresAt", "absoluteExpiresAt"].sort().join(",");
function fail(code: "invalid-argument" | "permission-denied" | "failed-precondition" = "failed-precondition"): never {
  throw new CustomerBiteSaverContractError(code, "This coupon cannot be used right now.");
}
const fingerprint = (catalogRestaurantId: string) => createQueryFingerprint({mode, catalogRestaurantId});
const activePath = (id: string) => `${privateCustomerBiteSaverActiveSessionCollection}/${id}`;
function parseSession(document: CustomerBiteSaverStoredDocument | null): ProfileSession | null {
  if (document === null) return null;
  const d = document.data;
  const createdAt = internals.dateValue(d.createdAt);
  const logicalExpiresAt = internals.dateValue(d.logicalExpiresAt);
  const absoluteExpiresAt = internals.dateValue(d.absoluteExpiresAt);
  const expiresAt = internals.dateValue(d.expiresAt);
  const catalogRestaurantId = readBiteScoreCatalogRestaurantId(d.catalogRestaurantId);
  if (Object.keys(d).sort().join(",") !== sessionKeys || d.mode !== mode ||
      d.protocolVersion !== protocolVersion || d.schemaVersion !== 1 || d.state !== "ready" ||
      d.attemptGeneration !== 0 || catalogRestaurantId === null ||
      d.criteriaFingerprint !== fingerprint(catalogRestaurantId) ||
      typeof d.sessionId !== "string" || !/^bss_[A-Za-z0-9_-]{43}$/u.test(d.sessionId) ||
      document.id !== d.sessionId || document.path !== internals.sessionPath(d.sessionId) ||
      (d.callerScope !== "guest" && d.callerScope !== "authenticated") ||
      ![d.callerBindingHash, d.capabilityHash].every(x => typeof x === "string" && /^[0-9a-f]{64}$/u.test(x)) ||
      (d.callerScope === "guest" ? d.authenticatedUidHash !== null :
        typeof d.authenticatedUidHash !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(d.authenticatedUidHash)) ||
      createdAt === null || logicalExpiresAt === null || absoluteExpiresAt === null || expiresAt === null ||
      createdAt.getTime() < 0 || logicalExpiresAt <= createdAt || absoluteExpiresAt < logicalExpiresAt ||
      expiresAt.getTime() !== absoluteExpiresAt.getTime() ||
      absoluteExpiresAt.getTime() - createdAt.getTime() !== customerBiteSaverAbsoluteExpiryMilliseconds) return fail();
  return {...d, createdAt, logicalExpiresAt, absoluteExpiresAt, expiresAt} as ProfileSession;
}

type ContextRequest = Readonly<{
  clientRequestId: string; clientInstanceId: string; catalogRestaurantId: string;
  restaurantId: string; offerId: string; timeZone: string; utcOffsetMinutes: number;
  guestStateRevision: number | null;
}>;
function parseRequest(raw: unknown, context: CustomerBiteSaverSessionContext): ContextRequest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fail("invalid-argument");
  const d = raw as Record<string, unknown>;
  if (Object.keys(d).sort().join(",") !== "catalogRestaurantId,clientInstanceId,clientRequestId,guestStateRevision,kind,offerId,restaurantId,schemaVersion,timeZone,utcOffsetMinutes" ||
      d.kind !== mode || d.schemaVersion !== 1 ||
      ![d.clientRequestId, d.clientInstanceId].every(x => typeof x === "string" && /^[A-Za-z0-9_-]{16,128}$/u.test(x))) return fail("invalid-argument");
  const catalogRestaurantId = readBiteScoreCatalogRestaurantId(d.catalogRestaurantId);
  const timeZone = requireIanaTimeZone(d.timeZone);
  if (catalogRestaurantId === null || typeof d.utcOffsetMinutes !== "number" ||
      !Number.isInteger(d.utcOffsetMinutes) || !timeZoneSupportsUtcOffset(timeZone, d.utcOffsetMinutes) ||
      (internals.requireAuthUid(context.identity) !== null ? d.guestStateRevision !== null :
        typeof d.guestStateRevision !== "number" || !Number.isSafeInteger(d.guestStateRevision) || d.guestStateRevision < 0)) return fail("invalid-argument");
  return {clientRequestId: d.clientRequestId as string, clientInstanceId: d.clientInstanceId as string,
    catalogRestaurantId, restaurantId: requireCustomerBiteSaverPublicId(d.restaurantId, "bsr"),
    offerId: requireCustomerBiteSaverPublicId(d.offerId, "bso"), timeZone,
    utcOffsetMinutes: d.utcOffsetMinutes, guestStateRevision: d.guestStateRevision as number | null};
}

export type CustomerBiteSaverProfileUseContextResult = Readonly<{
  schemaVersion: 1; kind: typeof mode; catalogRestaurantId: string; restaurantId: string; offerId: string;
  sessionId: string; capability: string; criteriaFingerprint: string; offerOccurrence: string;
  freshExpiresAtMillis: number; isProximityOnly: boolean; usagePolicy: string;
}>;

export async function startCustomerBiteSaverProfileUseContext(raw: unknown,
  context: CustomerBiteSaverSessionContext): Promise<CustomerBiteSaverProfileUseContextResult> {
  const request = parseRequest(raw, context);
  const nowMs = context.now?.() ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return fail();
  const parent = await resolveCustomerBiteSaverPublicProfile(request, context);
  if (parent.state !== "available" || parent.restaurant.restaurantId !== request.restaurantId) return fail();
  const target = await resolveCustomerBiteSaverCouponTarget({context,
    authoritativeAccountId: parent.account.id, restaurantId: request.restaurantId, offerId: request.offerId});
  if (target === null) return fail();
  const uid = internals.requireAuthUid(context.identity);
  const callerScope = internals.callerScope(context.identity);
  const callerBindingHash = customerBiteSaverCallerBinding(context.discoveryKey,
    {scope: callerScope, clientInstanceId: request.clientInstanceId, uid});
  // The restaurant, not offer/calendar/content, keys the validated guest session.
  const criteriaFingerprint = fingerprint(request.catalogRestaurantId);
  const controlId = internals.controlDocumentId(context.discoveryKey, callerBindingHash);
  const pointerId = internals.pointerDocumentId(context.discoveryKey, callerBindingHash, criteriaFingerprint);
  const replayId = internals.startRequestReplayDocumentId(context.discoveryKey, callerBindingHash, request.clientRequestId);
  const clientRequestBinding = internals.startRequestClientBinding(context.discoveryKey, callerBindingHash, request.clientRequestId);
  const requestFingerprint = createQueryFingerprint({mode, ...request});
  return context.database.runTransaction(async transaction => {
    const current = await resolveCustomerBiteSaverPublicProfile(request, context, transaction);
    if (current.state !== "available" || current.account.id !== target.authoritativeAccountId ||
        current.restaurant.restaurantId !== request.restaurantId) return fail();
    const coupon = await transaction.getDocument(`restaurant_accounts/${target.authoritativeAccountId}/coupons/${target.sourceDocumentId}`);
    const source = currentSavedRedemptionSource({context, target, parentDocument: current.account,
      offerDocument: coupon, now: new Date(nowMs)});
    if (source === null) return fail();
    const [controlDoc, pointerDoc, replayDoc] = await transaction.getDocuments([
      activePath(controlId), activePath(pointerId), activePath(replayId)]);
    const control = internals.parseActiveControl(controlDoc, {documentId: controlId, callerBindingHash});
    const pointer = internals.parseActivePointer(pointerDoc, {documentId: pointerId, callerBindingHash, criteriaFingerprint});
    const replay = internals.parseStartRequestReplay(replayDoc);
    if (replay !== null && (replay.callerBindingHash !== callerBindingHash ||
        replay.clientRequestBinding !== clientRequestBinding || replay.requestFingerprint !== requestFingerprint)) return fail("invalid-argument");
    const sessionId = replay?.sessionId ?? pointer?.sessionId;
    let session = sessionId === undefined ? null : parseSession(await transaction.getDocument(internals.sessionPath(sessionId)));
    if (session !== null && (session.callerBindingHash !== callerBindingHash ||
        session.criteriaFingerprint !== criteriaFingerprint)) return fail();
    if (replay !== null && (session === null || nowMs >= session.absoluteExpiresAt.getTime())) return fail();
    const freshSession = session === null || nowMs >= session.absoluteExpiresAt.getTime();
    const now = new Date(nowMs);
    const starts = control.recentStartsAtMs.filter(t => t > nowMs - customerBiteSaverStartRateWindowMilliseconds);
    if (freshSession) {
      if (starts.length >= customerBiteSaverStartRateLimit) throw new CustomerBiteSaverContractError("resource-exhausted");
      const id = customerBiteSaverRandomSessionId(context.randomSource ?? randomBytes);
      const absoluteExpiresAt = new Date(nowMs + customerBiteSaverAbsoluteExpiryMilliseconds);
      session = {protocolVersion, schemaVersion: 1, mode, state: "ready", attemptGeneration: 0,
        catalogRestaurantId: request.catalogRestaurantId, sessionId: id, criteriaFingerprint,
        callerScope, callerBindingHash, authenticatedUidHash: internals.authenticatedUidHash(context.discoveryKey, uid),
        capabilityHash: customerBiteSaverCapabilityHash(context.discoveryKey,
          customerBiteSaverCapabilityForSession(context.discoveryKey, id, callerBindingHash)),
        createdAt: now, logicalExpiresAt: new Date(nowMs + customerBiteSaverIdleExpiryMilliseconds),
        absoluteExpiresAt, expiresAt: absoluteExpiresAt};
    } else {
      session = {...session!, logicalExpiresAt: new Date(Math.min(session!.absoluteExpiresAt.getTime(),
        nowMs + customerBiteSaverIdleExpiryMilliseconds))};
    }
    const capability = customerBiteSaverCapabilityForSession(context.discoveryKey, session.sessionId, callerBindingHash);
    const token = new SavedOpaqueCodec(context.discoveryKey, () => nowMs).encode({
      version: 1, purpose: mode, sessionId: session.sessionId, criteriaFingerprint,
      callerCapabilityBinding: internals.requestCallerCapabilityBindingFor(context,
        {schemaVersion: 1, ...request, sessionId: session.sessionId, capability, criteriaFingerprint}),
      catalogRestaurantId: request.catalogRestaurantId, bindingId: current.account.data.biteSaverCatalogBindingId,
      ...target, timeZone: request.timeZone, utcOffsetMinutes: request.utcOffsetMinutes,
      guestStateRevision: request.guestStateRevision, issuedAtMillis: nowMs,
      freshExpiresAtMillis: session.logicalExpiresAt.getTime(), expiresAtMillis: session.absoluteExpiresAt.getTime(),
    });
    if (freshSession) {
      transaction.createDocument(internals.sessionPath(session.sessionId), session);
      transaction.setDocument(activePath(controlId), {protocolVersion, role: "callerControl", state: "active",
        callerBindingHash, attemptGeneration: 0, unfinishedSessionIds: control.unfinishedSessionIds,
        recentStartsAtMs: [...starts, nowMs], recentRequests: [...control.recentRequests,
          {clientRequestBinding, criteriaFingerprint, sessionId: session.sessionId, createdAtMs: nowMs}].slice(-customerBiteSaverStartRateLimit),
        createdAt: control.createdAt ?? now, logicalExpiresAt: session.logicalExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt, expiresAt: session.absoluteExpiresAt});
      transaction.setDocument(activePath(pointerId), {protocolVersion, role: "criteriaPointer", state: "active",
        callerBindingHash, criteriaFingerprint, sessionId: session.sessionId, attemptGeneration: 0,
        createdAt: now, logicalExpiresAt: session.logicalExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt, expiresAt: session.absoluteExpiresAt});
    } else transaction.setDocument(internals.sessionPath(session.sessionId), session);
    if (replay === null) transaction.createDocument(activePath(replayId), internals.buildStartRequestReplay({
      callerBindingHash, clientRequestBinding, requestFingerprint, session, now}));
    return {schemaVersion: 1, kind: mode, catalogRestaurantId: request.catalogRestaurantId,
      restaurantId: request.restaurantId, offerId: request.offerId, sessionId: session.sessionId,
      capability, criteriaFingerprint, offerOccurrence: token, freshExpiresAtMillis: session.logicalExpiresAt.getTime(),
      isProximityOnly: source.offer.isProximityOnly === true, usagePolicy: source.usagePolicy};
  });
}

function authenticate(request: CustomerBiteSaverCombinedUseRequest, context: CustomerBiteSaverDeviceUseContext,
  document: CustomerBiteSaverStoredDocument, now: number, fresh: boolean) {
  if (request.origin.kind !== "discovery") return fail("invalid-argument");
  const session = authorizeCustomerBiteSaverSession({request: {schemaVersion: 1,
    clientRequestId: request.logicalRequestId, ...request.origin},
    session: parseSession(document), context, nowMs: now, allowExpired: !fresh});
  if (now < session.createdAt.getTime() || now >= session.absoluteExpiresAt.getTime()) return fail();
  const token = new SavedOpaqueCodec(context.discoveryKey, () => now).open(request.origin.offerOccurrence);
  if (Object.keys(token).sort().join(",") !== "authoritativeAccountId,bindingId,callerCapabilityBinding,catalogRestaurantId,criteriaFingerprint,expiresAtMillis,freshExpiresAtMillis,guestStateRevision,issuedAtMillis,offerId,purpose,restaurantId,sessionId,sourceDocumentId,timeZone,utcOffsetMinutes,version" ||
      token.version !== 1 || token.purpose !== mode || token.sessionId !== session.sessionId ||
      token.criteriaFingerprint !== session.criteriaFingerprint || token.catalogRestaurantId !== session.catalogRestaurantId ||
      token.restaurantId !== request.restaurantId || token.offerId !== request.offerId ||
      token.guestStateRevision !== request.origin.guestStateRevision || token.timeZone !== request.timeZone ||
      token.utcOffsetMinutes !== request.utcOffsetMinutes || token.expiresAtMillis !== session.absoluteExpiresAt.getTime() ||
      typeof token.issuedAtMillis !== "number" || token.issuedAtMillis < session.createdAt.getTime() || token.issuedAtMillis > now ||
      typeof token.freshExpiresAtMillis !== "number" || token.freshExpiresAtMillis <= token.issuedAtMillis ||
      token.freshExpiresAtMillis > (token.expiresAtMillis as number) ||
      (fresh && now >= token.freshExpiresAtMillis) ||
      exactInternalId(token.authoritativeAccountId) === null ||
      exactInternalId(token.sourceDocumentId) === null || typeof token.bindingId !== "string" ||
      token.callerCapabilityBinding !== internals.requestCallerCapabilityBindingFor(context,
        {schemaVersion: 1, clientRequestId: request.logicalRequestId, ...request.origin})) return fail("permission-denied");
  return {session, token};
}

export function authenticateCustomerBiteSaverProfileChallengeAuthority(request: CustomerBiteSaverCombinedUseRequest,
  context: CustomerBiteSaverDeviceUseContext, document: CustomerBiteSaverStoredDocument, now: number) {
  const {session} = authenticate(request, context, document, now, false);
  return {guestSessionId: session.sessionId, recoveryExpiresAtMillis: session.absoluteExpiresAt.getTime()};
}

export async function readCustomerBiteSaverProfileUseAuthority(request: CustomerBiteSaverCombinedUseRequest,
  context: CustomerBiteSaverDeviceUseContext, transaction: CustomerBiteSaverTransaction,
  document: CustomerBiteSaverStoredDocument, now: number): Promise<CustomerBiteSaverFreshUseAuthorityDecision> {
  const {session, token} = authenticate(request, context, document, now, true);
  const base = {origin: "discovery" as const, signedUserId: internals.requireAuthUid(context.identity),
    restaurantId: request.restaurantId, offerId: request.offerId,
    freshUseExpiresAtMillis: token.freshExpiresAtMillis as number,
    recoveryExpiresAtMillis: session.absoluteExpiresAt.getTime()};
  const parent = await resolveCustomerBiteSaverPublicProfile(session, context, transaction);
  const target = {authoritativeAccountId: token.authoritativeAccountId as string,
    sourceDocumentId: token.sourceDocumentId as string, restaurantId: request.restaurantId, offerId: request.offerId};
  const coupon = await transaction.getDocument(`restaurant_accounts/${target.authoritativeAccountId}/coupons/${target.sourceDocumentId}`);
  const source = parent.state !== "available" || parent.account.id !== target.authoritativeAccountId ||
    parent.account.data.biteSaverCatalogBindingId !== token.bindingId ? null :
    currentSavedRedemptionSource({context, target, parentDocument: parent.account, offerDocument: coupon, now: new Date(now)});
  return source === null ? {...base, kind: "denied", reason: "offerUnavailable"} : {
    ...base, kind: "authorized", source: {offer: source.offer, usagePolicy: source.usagePolicy,
      restaurantCoordinates: source.restaurantCoordinates, locationMode: "current",
      timeZone: request.timeZone, utcOffsetMinutes: request.utcOffsetMinutes,
      currentCoordinates: request.currentCoordinates}};
}
