"use strict";

const {createCipheriv} = require("node:crypto");
const {
  canonicalCustomerBiteSaverCriteria,
  createCustomerBiteSaverCriteriaFingerprint,
  createCustomerBiteSaverMembershipFingerprint,
  customerBiteSaverSearchProtocolVersion,
  parseCustomerBiteSaverStartRequest,
} = require("../../lib/customer_bitesaver_search_contract.js");
const {
  customerBiteSaverCallerBinding,
  customerBiteSaverCallerCapabilityBinding,
  customerBiteSaverCapabilityForSession,
  customerBiteSaverCapabilityHash,
  customerBiteSaverDeterministicId,
  CustomerBiteSaverOfferOccurrenceCodec,
} = require("../../lib/customer_bitesaver_search_cursor.js");
const {
  customerBiteSaverOpaqueOfferId,
  customerBiteSaverOpaqueRestaurantId,
} = require("../../lib/customer_bitesaver_public_identity.js");
const {createQueryFingerprint} = require("../../lib/query_fingerprint.js");
const {customerBiteSaverTimestampOrderKey} = require(
  "../../lib/search_index_builders.js",
);

// Test-only trusted authority producer; authentication is exercised with real
// capability HMACs and encrypted tokens, never an admission/verifier bypass.
function challengeAuthorityFixture({
  database,
  nowMillis = Date.parse("2026-09-18T16:00:00.000Z"),
  discoveryKey = Buffer.alloc(32, 41),
  identityKeyV1 = Buffer.alloc(32, 59),
  actor = {uid: null, isAnonymous: false},
  logicalRequestId = "challenge-authority-operation-0001",
  origin = "discovery",
  accountId = "challenge-authority-restaurant",
  sourceId = "challenge-authority-coupon",
  sessionId = `bss_${Buffer.alloc(32, 91).toString("base64url")}`,
  clientInstanceId = "challenge-authority-client-0001",
} = {}) {
  const userId = actor.uid !== null && !actor.isAnonymous ? actor.uid : null;
  const scope = userId === null ? "guest" : "authenticated";
  const restaurantId = customerBiteSaverOpaqueRestaurantId(identityKeyV1, accountId);
  const offerId = customerBiteSaverOpaqueOfferId(identityKeyV1, accountId, "coupon", sourceId);
  const criteria = canonicalCustomerBiteSaverCriteria(parseCustomerBiteSaverStartRequest({
    schemaVersion: 1,
    clientRequestId: "challenge-authority-search-0001",
    clientInstanceId,
    latitude: 28.5383,
    longitude: -81.3792,
    radiusMiles: 10,
    locationMode: "current",
    typedLocation: null,
    searchText: "",
    timeZone: "America/New_York",
    utcOffsetMinutes: -240,
    freshSearch: true,
  }));
  const callerBindingHash = customerBiteSaverCallerBinding(discoveryKey, {
    scope, uid: userId, clientInstanceId,
  });
  const capability = customerBiteSaverCapabilityForSession(discoveryKey, sessionId, callerBindingHash);
  const capabilityHash = customerBiteSaverCapabilityHash(discoveryKey, capability);
  const vector = Array(16).fill(0);
  const session = {
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: 1,
    sessionId,
    state: "ready",
    failureCode: null,
    callerScope: scope,
    callerBindingHash,
    authenticatedUidHash: userId === null ? null :
      customerBiteSaverDeterministicId(discoveryKey, "uid", "authenticatedUid", [userId]).slice(4),
    capabilityHash,
    criteria,
    criteriaFingerprint: createCustomerBiteSaverCriteriaFingerprint(criteria),
    queryFingerprint: createCustomerBiteSaverMembershipFingerprint({
      criteria, attemptGeneration: 0, catalogGenerationVector: vector,
    }),
    attemptGeneration: 0,
    catalogRestartCount: 0,
    catalogGenerationVector: vector,
    phase: "ready",
    restaurantRanges: [],
    offerRanges: [],
    finalizeAfterCandidateDocumentId: null,
    currentJobId: `bsj_${Buffer.alloc(32, 92).toString("base64url")}`,
    workerLeaseId: null,
    workerLeaseExpiresAt: null,
    progress: {processedSourceDocuments: 0, completedRestaurantRanges: 0,
      completedOfferRanges: 0, finalizedCandidates: 0},
    createdAt: new Date(nowMillis),
    lastAccessAt: new Date(nowMillis),
    logicalExpiresAt: new Date(nowMillis + 15 * 60_000),
    absoluteExpiresAt: new Date(nowMillis + 60 * 60_000),
    expiresAt: new Date(nowMillis + 60 * 60_000),
  };
  const guestStateRevision = userId === null ? 0 : null;
  const occurrenceInput = {
    pagePurpose: "restaurantPage",
    sessionId,
    attemptGeneration: 0,
    queryFingerprint: session.queryFingerprint,
    pageGenerationFingerprint: "1".repeat(64),
    callerCapabilityBinding: customerBiteSaverCallerCapabilityBinding(
      discoveryKey, callerBindingHash, capabilityHash,
    ),
    restaurantPublicId: restaurantId,
    offerPublicId: offerId,
    authoritativeAccountId: accountId,
    offerType: "coupon",
    sourceDocumentId: sourceId,
    indexDocumentId: "challenge-authority-index",
    sourceCreatedAtMs: nowMillis - 1_000,
    sourceCreatedAtOrderKey: customerBiteSaverTimestampOrderKey(new Date(nowMillis - 1_000)),
    sourceFingerprint: "2".repeat(64),
    matchingMode: null,
    availabilityAtMs: nowMillis,
    guestStateFingerprint: createQueryFingerprint({guestStateRevision}),
    usageGeneration: "3".repeat(64),
    offerCatalogFingerprint: null,
    expiresAtMs: nowMillis + 15 * 60_000,
  };
  const mintOccurrence = (overrides = {}) => new CustomerBiteSaverOfferOccurrenceCodec({
    key: discoveryKey, now: () => nowMillis,
  }).encode({...occurrenceInput, ...overrides});
  const savedPayload = {
    version: 1, purpose: "savedAccess", userId, section: "coupons",
    restaurantId, offerId, authoritativeAccountId: accountId,
    issuedAtMillis: nowMillis, expiresAtMillis: nowMillis + 24 * 60 * 60_000,
  };
  const mintSavedToken = (overrides = {}, nonceSeed = 93) => {
    const nonce = Buffer.alloc(12, nonceSeed);
    const cipher = createCipheriv("aes-256-gcm", discoveryKey, nonce);
    cipher.setAAD(Buffer.from("bssv1.", "ascii"));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify({...savedPayload, ...overrides}), "utf8"),
      cipher.final(),
    ]);
    return "bssv1." + Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
  };
  const sessionPath = `private_bitesaver_search_sessions/${sessionId}`;
  if (origin === "discovery") {
    if (database.documents instanceof Map) database.documents.set(sessionPath, session);
    else if (database.records instanceof Map) database.records.set(sessionPath, session);
    else if (typeof database.set === "function") database.set(sessionPath, session);
    else throw new Error("Authority fixture needs a writable test document map.");
  }
  const request = {
    schemaVersion: 1, logicalRequestId, restaurantId, offerId,
    timeZone: "America/New_York", utcOffsetMinutes: -240, currentCoordinates: null,
    origin: origin === "saved"
      ? {kind: "saved", accessToken: mintSavedToken()}
      : {kind: "discovery", clientInstanceId, sessionId, capability,
        criteriaFingerprint: session.criteriaFingerprint,
        offerOccurrence: mintOccurrence(), guestStateRevision},
  };
  const context = {
    database, discoveryKey, identityKeyV1,
    identity: {authUid: actor.uid, authIsAnonymous: actor.isAnonymous},
    now: () => nowMillis,
  };
  return {request, context, actor, session, sessionPath, mintOccurrence, mintSavedToken};
}

module.exports = {challengeAuthorityFixture};
