"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {challengeAuthorityFixture} = require(
  "./helpers/customer_bitesaver_challenge_authority_fixture.js",
);
const {
  authenticateCustomerBiteSaverDiscoveryChallengeAuthority,
} = require("../lib/customer_bitesaver_search_session.js");
const {
  authenticateCustomerBiteSaverSavedChallengeAuthority,
} = require("../lib/customer_bitesaver_saved.js");
const {CustomerBiteSaverOfferOccurrenceCodec} = require(
  "../lib/customer_bitesaver_search_cursor.js",
);
const {
  CustomerBiteSaverContractError,
  createCustomerBiteSaverMembershipFingerprint,
} = require("../lib/customer_bitesaver_search_contract.js");

function database() {
  const documents = new Map();
  const reads = [];
  const forbidden = () => assert.fail("Authority authentication must not query or write");
  return {
    documents, reads,
    async getDocument(path) {
      reads.push(path);
      const data = documents.get(path);
      return data === undefined ? null : {id: path.split("/").at(-1), path, data};
    },
    getDocuments: forbidden, queryDocuments: forbidden,
    createDocument: forbidden, setDocument: forbidden, deleteDocument: forbidden,
  };
}

function fixture(options = {}) {
  return challengeAuthorityFixture({database: database(), ...options});
}

const contractError = (error) => error instanceof CustomerBiteSaverContractError;
const browse = (value, request = value.request, context = value.context, at = context.now()) =>
  authenticateCustomerBiteSaverDiscoveryChallengeAuthority(request, context, context.database, at);

test("Browse admission authenticates guest, anonymous guest and signed authority using one point read", async () => {
  for (const actor of [
    {uid: null, isAnonymous: false},
    {uid: "anonymous-fixture", isAnonymous: true},
    {uid: "signed-fixture", isAnonymous: false},
  ]) {
    const value = fixture({actor});
    assert.deepEqual(await browse(value), {
      guestSessionId: value.session.sessionId,
      recoveryExpiresAtMillis: value.session.absoluteExpiresAt.getTime(),
    });
    assert.deepEqual(value.context.database.reads, [value.sessionPath]);
  }
});

test("Browse admission retains immutable authority after idle, occurrence and catalog freshness expire", async () => {
  const value = fixture();
  const later = value.context.now() + 20 * 60_000;
  value.session.state = "expired";
  value.session.attemptGeneration += 1;
  value.session.catalogGenerationVector[0] += 1;
  value.session.queryFingerprint = createCustomerBiteSaverMembershipFingerprint({
    criteria: value.session.criteria,
    attemptGeneration: value.session.attemptGeneration,
    catalogGenerationVector: value.session.catalogGenerationVector,
  });
  const codec = new CustomerBiteSaverOfferOccurrenceCodec({
    key: value.context.discoveryKey, now: () => later,
  });
  assert.throws(() => codec.open(value.request.origin.offerOccurrence), contractError);
  assert.equal(
    codec.authenticateForChallengeAdmission(value.request.origin.offerOccurrence).offerPublicId,
    value.request.offerId,
  );
  assert.equal((await browse(value, value.request, value.context, later)).recoveryExpiresAtMillis,
    value.session.absoluteExpiresAt.getTime());
  await assert.rejects(browse(value, value.request, value.context,
    value.session.absoluteExpiresAt.getTime()), contractError);
});

test("Browse admission rejects forged or mismatched authority without reading sources", async () => {
  const value = fixture();
  for (const request of [
    {...value.request, origin: {...value.request.origin, capability: "a".repeat(43)}},
    {...value.request, origin: {...value.request.origin, clientInstanceId: "other-client-instance-0001"}},
    {...value.request, origin: {...value.request.origin, criteriaFingerprint: "0".repeat(64)}},
    {...value.request, origin: {...value.request.origin, guestStateRevision: 1}},
    {...value.request, offerId: `bso_${"a".repeat(43)}`},
    {...value.request, restaurantId: `bsr_${"b".repeat(43)}`},
    {...value.request, origin: {...value.request.origin, offerOccurrence: "not-an-occurrence"}},
    {...value.request, origin: {...value.request.origin, offerOccurrence:
      value.mintOccurrence({offerType: "dailySpecial"})}},
    {...value.request, origin: {...value.request.origin, offerOccurrence:
      value.mintOccurrence({sourceDocumentId: "other-private-coupon"})}},
    {...value.request, origin: {...value.request.origin, offerOccurrence:
      value.mintOccurrence({authoritativeAccountId: "other-private-account"})}},
  ]) {
    await assert.rejects(browse(value, request), contractError);
  }
  const signed = fixture({actor: {uid: "signed-a", isAnonymous: false}});
  await assert.rejects(browse(signed, signed.request, {
    ...signed.context, identity: {authUid: "signed-b", authIsAnonymous: false},
  }), contractError);
  value.context.database.documents.delete(value.sessionPath);
  await assert.rejects(browse(value), contractError);
});

test("Browse admission rejects malformed session state and tampered expired ciphertext", async () => {
  const value = fixture();
  const token = value.request.origin.offerOccurrence;
  const index = token.indexOf(".") + 8;
  const tampered = token.slice(0, index) + (token[index] === "A" ? "B" : "A") + token.slice(index + 1);
  await assert.rejects(browse(value, {
    ...value.request, origin: {...value.request.origin, offerOccurrence: tampered},
  }, value.context, value.context.now() + 20 * 60_000), contractError);
  value.session.extraUntrustedField = true;
  await assert.rejects(browse(value), contractError);
});

test("Saved admission authenticates token ownership and exact identity without favorites or source reads", () => {
  const value = fixture({origin: "saved", actor: {uid: "saved-owner", isAnonymous: false}});
  assert.deepEqual(authenticateCustomerBiteSaverSavedChallengeAuthority(
    value.request, value.context, value.context.now(),
  ), {recoveryExpiresAtMillis: value.context.now() + 24 * 60 * 60_000});
  assert.equal(value.context.database.documents.size, 0);
  assert.deepEqual(value.context.database.reads, []);
  assert.doesNotThrow(() => authenticateCustomerBiteSaverSavedChallengeAuthority(
    value.request, value.context, value.context.now() + 24 * 60 * 60_000 - 1,
  ));
  assert.throws(() => authenticateCustomerBiteSaverSavedChallengeAuthority(
    value.request, value.context, value.context.now() + 24 * 60 * 60_000,
  ), contractError);
});

test("Saved admission rejects other actors, wrong coupons, restaurant tokens and unauthentic tokens", () => {
  const value = fixture({origin: "saved", actor: {uid: "saved-owner", isAnonymous: false}});
  for (const request of [
    {...value.request, offerId: `bso_${"a".repeat(43)}`},
    {...value.request, restaurantId: `bsr_${"b".repeat(43)}`},
    {...value.request, origin: {kind: "saved", accessToken: "forged"}},
    {...value.request, origin: {kind: "saved", accessToken:
      value.mintSavedToken({section: "restaurants", offerId: null})}},
    {...value.request, origin: {kind: "saved", accessToken:
      value.mintSavedToken({authoritativeAccountId: "wrong-private-account"})}},
    {...value.request, origin: {kind: "saved", accessToken:
      value.mintSavedToken({issuedAtMillis: value.context.now() + 1})}},
  ]) {
    assert.throws(() => authenticateCustomerBiteSaverSavedChallengeAuthority(
      request, value.context, value.context.now(),
    ), contractError);
  }
  for (const identity of [
    {authUid: null, authIsAnonymous: false},
    {authUid: "saved-owner", authIsAnonymous: true},
    {authUid: "different-owner", authIsAnonymous: false},
  ]) {
    assert.throws(() => authenticateCustomerBiteSaverSavedChallengeAuthority(
      value.request, {...value.context, identity}, value.context.now(),
    ), contractError);
  }
});
