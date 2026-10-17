"use strict";

// Deliberately real Firestore, source journal, PostgreSQL/PostGIS and native
// handlers. The opt-in gate permits only this isolated local fixture target.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const {performance} = require("node:perf_hooks");
const enabled = process.env.BS_POSTGIS_INTEGRATION_TEST === "1";
const projectId = "demo-bs-postgis-integration";
const sql = {host: "127.0.0.1", port: 55441, database: "bsgate0_integration", user: "bsgate0"};
const epoch = "native-integration-v1";
const discoveryKey = Buffer.alloc(32, 71); // Local synthetic key, never production.
const scoreCursorRoot = Buffer.alloc(32, 73);
const report = process.env.BS_POSTGIS_INTEGRATION_REPORT;

test("real Firestore maintenance → journal → PostGIS → native customer delivery",
  {skip: !enabled, timeout: 180_000}, async t => {
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8088");
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
    assert.equal(process.env.GCLOUD_PROJECT, projectId);
    assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
    assert(!process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT === projectId);
    const {initializeApp, deleteApp} = require("firebase-admin/app");
    const {getFirestore} = require("firebase-admin/firestore");
    const {getAuth} = require("firebase-admin/auth");
    const F = require("./fixtures/postgis_gate0.cjs");
    const M = require("../lib/search_index_maintenance.js");
    const C = require("../lib/search_index_contract.js");
    const S = require("../lib/postgis_source_firestore.js");
    const {createLocalPostgisStagingRuntime, startLocalPostgisHttpHost} = require("../lib/postgis_staging_runtime.js");
    const {CustomerBiteSaverOfferOccurrenceCodec} = require("../lib/customer_bitesaver_search_cursor.js");
    const {customerBiteSaverOpaqueRestaurantId, customerBiteSaverOpaqueOfferId} = require("../lib/customer_bitesaver_public_identity.js");
    const fixture = F.dataset({saverParents: 35, scoreParents: 20, includeCases: false});
    const app = initializeApp({projectId}, "real-postgis-native-integration");
    const db = getFirestore(app);
    const auth = getAuth(app);
    const runtime = createLocalPostgisStagingRuntime({database: db, auth, projectId, allowedProjectIds: [projectId],
      epoch, sql, discoveryKey, identityKeyV1: F.identityKeyV1, scoreCursorRootKey: scoreCursorRoot});
    const {source, authority, model} = runtime;
    const maintenance = runtime.maintenanceDatabase;
    const host = await startLocalPostgisHttpHost(runtime);
    const tokens = new Map();
    const transportMeasurements = [];
    async function tokenFor(user) {
      if (user === null) return null;
      if (tokens.has(user)) return tokens.get(user);
      const email = `${user}@synthetic.invalid`, password = "LocalSyntheticPasswordOnly71!";
      try { await auth.createUser({uid: user, email, password}); }
      catch (error) { if (error.code !== "auth/uid-already-exists" && error.code !== "auth/email-already-exists") throw error; }
      const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-only",
        {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({email, password, returnSecureToken: true})});
      const result = await response.json();
      assert(response.ok && typeof result.idToken === "string", "real Auth emulator sign-in failed");
      const decoded = await auth.verifyIdToken(result.idToken);
      assert.equal(decoded.uid, user);
      tokens.set(user, result.idToken);
      return result.idToken;
    }
    async function call(name, data, user, tokenOverride) {
      const token = tokenOverride ?? await tokenFor(user);
      const requestBody = JSON.stringify({data});
      const startedAt = performance.now();
      const response = await fetch(`${host.url}/${name}`, {method: "POST", headers: {"content-type": "application/json",
        ...(token ? {authorization: `Bearer ${token}`} : {})}, body: requestBody});
      const responseBody = await response.text();
      assert(!responseBody.includes(F.privateCanary), "private source field leaked through HTTP");
      transportMeasurements.push({endpoint: name, caller: user === null ? "guest" : "signed",
        status: response.status, elapsedMs: performance.now() - startedAt,
        requestBytes: Buffer.byteLength(requestBody), responseBytes: Buffer.byteLength(responseBody)});
      const body = JSON.parse(responseBody);
      if (body.error) throw Object.assign(new Error(body.error.message), {code: body.error.status.toLowerCase().replaceAll("_", "-")});
      assert(response.ok);
      return body.result;
    }
    const api = new Proxy({}, {get: (_, name) => (data, ctx) => call(name, data, ctx.identity?.authUid ??
      (ctx.identity ? null : "integration-score-customer"))});
    const measurements = [], responses = [];
    let requestNumber = 0;
    const requestId = label => `integration-${label}-${String(++requestNumber).padStart(8, "0")}`;
    const instance = "integration-client-instance-0001";
    const uid = "integration-customer-one";
    const context = user => ({database: authority, discoveryKey, identityKeyV1: F.identityKeyV1,
      identity: {authUid: user, authIsAnonymous: false}});
    const signed = context(uid), guest = context(null);
    const saverStart = (text = "", overrides = {}) => ({schemaVersion: 1,
      clientRequestId: requestId("start"), clientInstanceId: instance, ...F.center, radiusMiles: 15,
      locationMode: "current", typedLocation: null, searchText: text, timeZone: "America/New_York",
      utcOffsetMinutes: -240, freshSearch: true, ...overrides});
    const bound = (state, overrides = {}) => ({schemaVersion: 1, clientRequestId: requestId("bound"),
      clientInstanceId: instance, sessionId: state.sessionId, capability: state.capability,
      criteriaFingerprint: state.criteriaFingerprint, ...overrides});
    const pageRequest = (state, overrides = {}) => bound(state, {cursor: null, guestStateRevision: null, ...overrides});
    async function retry(label, operation) {
      const startedAt = performance.now();
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          const result = await operation();
          measurements.push({operation: label, elapsedMs: performance.now() - startedAt, attempts: attempt + 1});
          assert(!JSON.stringify(result).includes(F.privateCanary), "private field leaked through native response");
          responses.push(result);
          return result;
        } catch (error) {
          if (error.code !== "unavailable" || !/preparation is continuing/u.test(error.message)) throw error;
        }
      }
      assert.fail("bounded membership refinement did not complete");
    }
    async function catchUp() {
      for (let pass = 0; pass < 100; pass++) {
        const result = await model.catchUp(75);
        if (result.ready) return result.revision;
      }
      assert.fail("bounded source delivery did not complete");
    }
    async function writeAll(entries) {
      for (let offset = 0; offset < entries.length; offset += 300) {
        const batch = db.batch();
        for (const entry of entries.slice(offset, offset + 300)) batch.set(db.doc(entry.path), entry.data);
        await batch.commit();
      }
    }
    async function editCoupon(parentId, offerId, changes) {
      await db.doc(`restaurant_accounts/${parentId}/coupons/${offerId}`).update(changes);
      await M.handleBiteSaverCouponOfferWrite(maintenance, {restaurantAccountId: parentId,
        couponId: offerId, now: new Date(), identityKeyV1: F.identityKeyV1});
    }
    const specialParentId = "integration-edit-parent", specialOfferId = "integration-same-offer";
    const hiddenParentId = "integration-hidden-parent";
    const publicParentId = customerBiteSaverOpaqueRestaurantId(F.identityKeyV1, specialParentId);
    const publicOfferId = customerBiteSaverOpaqueOfferId(F.identityKeyV1, specialParentId, "coupon", specialOfferId);
    let beforeIndex, afterIndex, bootstrapRevision;
    try {
      await t.test("isolated fixture enrollment uses actual projection writes and finite source fence", async () => {
        const cleared = await fetch(`http://127.0.0.1:8088/emulator/v1/projects/${projectId}/databases/(default)/documents`, {method: "DELETE"});
        assert(cleared.ok);
        await model.initializeLocalSchema();
        await model.pool.query("TRUNCATE receipts,admissions,sessions,revision_pins,refinement_work,projection_poison,inbox,entities,source_heads,ingestion_progress,bootstrap,publication,revisions CASCADE");
        await model.initializeLocalSchema();
        await writeAll([...fixture.sources, ...fixture.documents.map(row => ({path: `${row.collection}/${row.id}`, data: row.data}))]);
        await source.initialize();
        const now = new Date();
        // Keep the deterministic source identities, extending only temporal
        // coupon inputs via the real maintenance writer for repeatable runs.
        for (const row of fixture.sources.filter(row => row.path.includes("/coupons/"))) {
          const [, parentId, , offerId] = row.path.split("/");
          await editCoupon(parentId, offerId, {startTime: new Date(now.getTime() - 86_400_000),
            endTime: new Date(now.getTime() + 86_400_000), updatedAt: now});
        }
        for (const [parentId, hidden] of [[specialParentId, false], [hiddenParentId, true]]) {
          const parent = F.saverSource(1000, {...F.center, restaurantName: "Synthetic Integration Needle", adminHidden: hidden});
          await db.doc(`restaurant_accounts/${parentId}`).set(parent);
          await M.reconcileBiteSaverRestaurantIndex(maintenance, parentId, now, F.identityKeyV1);
          const offerId = hidden ? "integration-hidden-offer" : specialOfferId;
          await db.doc(`restaurant_accounts/${parentId}/coupons/${offerId}`).set(F.couponSource(offerId, 1,
            {title: "Needle original coupon", startTime: new Date(now.getTime() - 86_400_000),
              endTime: new Date(now.getTime() + 86_400_000), createdAt: new Date(now.getTime() - 100_000), updatedAt: now}));
          await M.handleBiteSaverCouponOfferWrite(maintenance, {restaurantAccountId: parentId, couponId: offerId, now,
            identityKeyV1: F.identityKeyV1});
        }
        let checkpoint = await source.beginEnrollment("integration-bootstrap");
        for (let pass = 0; checkpoint.phase !== "complete"; pass++) {
          assert(pass < 30);
          checkpoint = await source.advanceEnrollment("integration-bootstrap", 75);
        }
        assert.equal(checkpoint.endFence.enrolled, true);
        bootstrapRevision = await catchUp();
        const events = (await db.collection(S.postgisSourceEventsCollection).get()).docs.map(row => row.data());
        assert(events.length >= fixture.documents.length);
        assert(!JSON.stringify(events).includes(F.privateCanary));
        const stored = await model.pool.query("SELECT count(*)::int AS count FROM entities WHERE visible AND valid_to=9223372036854775807");
        assert(stored.rows[0].count > 100);
      });

      await t.test("native Saver pages and Menu use SQL membership with opaque independent identities", async () => {
        const state = await api.startCustomerBiteSaverSearchV2(saverStart(), context("integration-paging-user"));
        assert.equal(state.state, "ready");
        const ctx = context("integration-paging-user");
        const firstRequest = pageRequest(state);
        const first = await retry("saver-first-page", () => api.getCustomerBiteSaverSearchPageV2(firstRequest, ctx));
        assert.equal(first.restaurants.length, 25);
        assert.equal(first.hasMore, true);
        const secondRequest = pageRequest(state, {cursor: first.nextCursor});
        const second = await retry("saver-second-page", () => api.getCustomerBiteSaverSearchPageV2(secondRequest, ctx));
        assert.equal(second.restaurants.length, 6);
        assert.equal(second.hasMore, false);
        assert.equal(new Set([...first.restaurants, ...second.restaurants].map(row => row.restaurantId)).size, 31);
        assert([...first.restaurants, ...second.restaurants].every(row => /^bsr_/u.test(row.restaurantId)));
        const hiddenId = customerBiteSaverOpaqueRestaurantId(F.identityKeyV1, hiddenParentId);
        assert(![...first.restaurants, ...second.restaurants].some(row => row.restaurantId === hiddenId));
        const menu = await api.getCustomerBiteSaverMenuPage(bound(state, {restaurantId: first.restaurants[0].restaurantId, cursor: null}), ctx);
        assert.equal(menu.state, "available");
        assert(!JSON.stringify(menu).includes(F.privateCanary));
      });

      await t.test("HTTP verifies real Auth emulator tokens and rejects malformed client binding", async () => {
        await assert.rejects(call("startCustomerBiteSaverSearchV2", saverStart(), null, "synthetic.invalid.token"),
          error => error.code === "unauthenticated");
        await assert.rejects(call("startCustomerBiteScoreSearchV2", {schemaVersion: 1, criteria: {kind: "dish"}}, null),
          error => error.code === "invalid-argument");
        await assert.rejects(call("startCustomerBiteSaverSearchV2", saverStart("", {clientInstanceId: ""}), null),
          error => error.code === "invalid-argument");
      });

      await t.test("typed broad guest paging completes every native history challenge", async () => {
        const clientInstanceId = "integration-wide-guest-instance-0001";
        const state = await api.startCustomerBiteSaverSearchV2(saverStart("", {clientInstanceId,
          locationMode: "typed", typedLocation: {kind: "zip", zip: "33101"}}), guest);
        const request = pageRequest(state, {clientInstanceId, guestStateRevision: 41});
        let response = await retry("guest-broad-first-challenge", () => api.getCustomerBiteSaverSearchPageV2(request, guest));
        for (let pass = 0; response.outcome !== "complete"; pass++) {
          assert(pass < 75, "bounded broad guest page did not complete");
          if (response.outcome === "retryRequired") {
            assert.equal(response.reason, "workBudget");
            response = await api.getCustomerBiteSaverSearchPageV2(request, guest);
            continue;
          }
          assert.equal(response.outcome, "guestCheckRequired");
          assert(response.candidates.length > 0 && response.candidates.length <= 75);
          response = await api.continueCustomerBiteSaverGuestOfferCheckV2(bound(state, {clientInstanceId,
            operationRef: response.operationRef, checkToken: response.checkToken, batchSequence: response.batchSequence,
            guestStateRevision: response.guestStateRevision, entireBatchEvaluated: true, unavailableOfferIds: []}), guest);
        }
        assert.equal(response.result.restaurants.length, 25);
        assert.equal(response.result.hasMore, true);
      });

      await t.test("same-ID signed edit survives pinned membership, then current usage revokes it", async () => {
        const state = await api.startCustomerBiteSaverSearchV2(saverStart("needle"), signed);
        const projections = await db.collection(C.biteSaverOfferIndexCollection).get();
        beforeIndex = projections.docs.find(row => row.get("sourceDocumentId") === specialOfferId).data();
        assert(beforeIndex);
        const beforeFence = await source.readFence();
        await editCoupon(specialParentId, specialOfferId, {title: "Needle signed edited current coupon", updatedAt: new Date()});
        afterIndex = (await db.doc(`${C.biteSaverOfferIndexCollection}/${beforeIndex.indexDocumentId}`).get()).data();
        assert.notEqual(beforeIndex.sourceFingerprint, afterIndex.sourceFingerprint);
        assert.equal(beforeIndex.sourceCreatedAtOrderKey, afterIndex.sourceCreatedAtOrderKey);
        const afterFence = await source.readFence();
        assert(afterFence.shards.some((row, index) => row.seq > beforeFence.shards[index].seq));
        assert.notEqual(await catchUp(), bootstrapRevision);
        const request = pageRequest(state);
        const page = await retry("signed-edited-page", () => api.getCustomerBiteSaverSearchPageV2(request, signed));
        assert.equal(page.restaurants.length, 1);
        assert.equal(page.restaurants[0].restaurantId, publicParentId);
        assert.equal(page.restaurants[0].offers[0].title, "Needle signed edited current coupon");
        assert.equal(page.restaurants[0].offers[0].offerId, publicOfferId);
        const occurrence = new CustomerBiteSaverOfferOccurrenceCodec({key: discoveryKey}).open(page.restaurants[0].offers[0].offerOccurrence);
        assert.equal(occurrence.sourceFingerprint, afterIndex.catalogGenerationContribution);
        assert.equal(occurrence.sourceCreatedAtOrderKey, beforeIndex.sourceCreatedAtOrderKey);
        const offerRequest = pageRequest(state, {restaurantId: publicParentId});
        const offers = await retry("signed-edited-offer-page", () => api.getCustomerBiteSaverOfferPageV2(offerRequest, signed));
        assert.equal(offers.offers.length, 1);
        assert.equal(offers.offers[0].title, "Needle signed edited current coupon");
        await assert.rejects(api.getCustomerBiteSaverSearchPageV2(pageRequest(state), context("integration-other-user")),
          error => error.code === "permission-denied");
        const usedAt = new Date(Date.now() - 10 * 60_000);
        await db.doc(`customer_redemptions/${uid}/coupon_redemptions/${publicOfferId}`).set({schemaVersion: 1,
          userId: uid, restaurantId: publicParentId, offerId: publicOfferId, offerType: "coupon",
          redemptionId: `bsrd_${Buffer.alloc(32, 31).toString("base64url")}`, timerStartedAt: usedAt,
          timerExpiresAt: new Date(usedAt.getTime() + 5 * 60_000), createdAt: usedAt, updatedAt: usedAt});
        const revokedRequest = pageRequest(state);
        const revoked = await retry("signed-current-usage-revocation", () => api.getCustomerBiteSaverSearchPageV2(revokedRequest, signed));
        assert.equal(revoked.restaurants.length, 0);
      });

      await t.test("guest same-ID edit retains bounded history challenges and history suppression", async () => {
        const state = await api.startCustomerBiteSaverSearchV2(saverStart("needle"), guest);
        await editCoupon(specialParentId, specialOfferId, {title: "Needle guest edited current coupon", updatedAt: new Date()});
        await catchUp();
        const answer = (challenge, unavailableOfferIds) => bound(state, {operationRef: challenge.operationRef,
          checkToken: challenge.checkToken, batchSequence: challenge.batchSequence,
          guestStateRevision: challenge.guestStateRevision, entireBatchEvaluated: true, unavailableOfferIds});
        const request = pageRequest(state, {guestStateRevision: 1});
        const challenge = await retry("guest-edited-challenge", () => api.getCustomerBiteSaverSearchPageV2(request, guest));
        assert.equal(challenge.outcome, "guestCheckRequired", JSON.stringify({outcome: challenge.outcome, reason: challenge.reason, restartFrom: challenge.restartFrom}));
        assert(challenge.candidates.length > 0 && challenge.candidates.length <= 75);
        assert(challenge.candidates.some(row => row.offerId === publicOfferId));
        const visible = await api.continueCustomerBiteSaverGuestOfferCheckV2(answer(challenge, []), guest);
        assert.equal(visible.outcome, "complete");
        assert.equal(visible.result.restaurants[0].offers[0].title, "Needle guest edited current coupon");
        const offerRequest = pageRequest(state, {restaurantId: publicParentId, guestStateRevision: 1});
        const offerChallenge = await api.getCustomerBiteSaverOfferPageV2(offerRequest, guest);
        assert.equal(offerChallenge.outcome, "guestCheckRequired");
        const offerPage = await api.continueCustomerBiteSaverGuestOfferCheckV2(answer(offerChallenge, []), guest);
        assert.equal(offerPage.outcome, "complete");
        assert.equal(offerPage.result.offers[0].title, "Needle guest edited current coupon");
        const delivered = offerPage.result.offers[0];
        const validationRequest = bound(state, {restaurantId: publicParentId, offerId: publicOfferId,
          offerOccurrence: delivered.offerOccurrence, redemptionRequestId: requestId("validation"),
          currentCoordinates: null, guestStateRevision: 1});
        const validationChallenge = await api.validateCustomerBiteSaverOfferRedemptionStart(validationRequest, guest);
        assert.equal(validationChallenge.outcome, "guestCheckRequired");
        assert.equal(validationChallenge.operation, "redemptionStart");
        const validation = await api.continueCustomerBiteSaverGuestOfferCheckV2(answer(validationChallenge, []), guest);
        assert.equal(validation.outcome, "complete", JSON.stringify({outcome: validation.outcome, reason: validation.reason}));
        assert.equal(validation.result.allowed, true);
        assert.equal(validation.result.offerId, publicOfferId);
        // Preparation only: never invoke redemption execution or device use.
        const nextRequest = pageRequest(state, {guestStateRevision: 2});
        const nextChallenge = await retry("guest-history-challenge", () => api.getCustomerBiteSaverSearchPageV2(nextRequest, guest));
        const suppressed = await api.continueCustomerBiteSaverGuestOfferCheckV2(answer(nextChallenge, [publicOfferId]), guest);
        assert.equal(suppressed.outcome, "complete");
        assert.equal(suppressed.result.restaurants.length, 0);
        const pendingRequest = pageRequest(state, {guestStateRevision: 3});
        const pending = await retry("guest-negative-race-challenge", () => api.getCustomerBiteSaverSearchPageV2(pendingRequest, guest));
        assert.equal(pending.outcome, "guestCheckRequired");
        await editCoupon(specialParentId, specialOfferId, {title: "Needle changed during guest answer", updatedAt: new Date()});
        const raced = await api.continueCustomerBiteSaverGuestOfferCheckV2(answer(pending, []), guest);
        assert.equal(raced.outcome, "retryRequired");
        assert.equal(raced.reason, "sourceChanged");
        const replay = await api.validateCustomerBiteSaverOfferRedemptionStart({...validationRequest,
          clientRequestId: requestId("validation-replay")}, guest);
        assert(replay.outcome === "retryRequired" || (replay.outcome === "complete" && !replay.result.allowed));
        await catchUp();
      });

      await t.test("current withdrawal suppresses pinned membership and journaled SQL publication", async () => {
        const ctx = context("integration-withdrawal-user");
        const state = await api.startCustomerBiteSaverSearchV2(saverStart("needle"), ctx);
        await editCoupon(specialParentId, specialOfferId, {isActive: false, updatedAt: new Date()});
        await catchUp();
        const request = pageRequest(state);
        const page = await retry("withdrawn-offer-page", () => api.getCustomerBiteSaverSearchPageV2(request, ctx));
        assert.equal(page.restaurants.length, 0);
        assert.equal(page.hasMore, false);
      });

      await t.test("actual Score and Finder native protocols consume SQL pages without private fields", async () => {
        const ctx = {};
        const start = criteria => api.startCustomerBiteScoreSearchV2({schemaVersion: 1, clientInstanceId: instance,
          clientRequestId: requestId("score"), queryGeneration: ++requestNumber, criteria}, ctx);
        const pageInput = (state, cursor = null) => ({schemaVersion: 1, clientInstanceId: instance, sessionId: state.sessionId,
          queryFingerprint: state.queryFingerprint, cursor});
        const state = await start({kind: "dish", center: F.center, radiusMiles: 15, text: "", sort: "Closest"});
        const first = await retry("score-first-page", () => api.getCustomerBiteScoreSearchPageV2(pageInput(state), ctx));
        const second = await retry("score-second-page", () => api.getCustomerBiteScoreSearchPageV2(pageInput(state, first.nextCursor), ctx));
        assert.equal(first.items.length, 25);
        assert.equal(second.items.length, 15);
        assert.equal(second.hasMore, false);
        assert.equal(new Set([...first.items, ...second.items].map(row => row.sourceDocumentId)).size, 40);
        const finder = await start({kind: "restaurant", text: "Synthetic", finder: {state: "FL", location: "Miami", mode: "suggestions"}});
        const suggestions = await retry("finder-first-page", () => api.getCustomerBiteScoreSearchPageV2(pageInput(finder), ctx));
        assert.equal(suggestions.items.length, 8);
        assert.equal(suggestions.hasMore, false);
      });
      if (report) fs.writeFileSync(report, JSON.stringify({syntheticOnly: true, projectId, sql, epoch,
        source: "actual Firestore maintenance + durable journal", membership: "actual PostgreSQL/PostGIS",
        delivery: "loopback HTTP, verified Auth emulator tokens, native handler protocols", fixture: fixture.manifest,
        measurements, transportMeasurements,
        privateCanaryExcluded: responses.every(row => !JSON.stringify(row).includes(F.privateCanary))}, null, 2));
    } finally {
      await host.close();
      await runtime.close();
      await deleteApp(app);
    }
  });
