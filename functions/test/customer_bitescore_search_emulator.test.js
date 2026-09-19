"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {randomBytes} = require("node:crypto");

// Check the explicit demo/loopback safety gate before initializing Firebase.
function emulatorConfiguration() {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
  const port = /^(?:localhost|127\.0\.0\.1):([1-9][0-9]{0,4})$/u.exec(host) ??
    /^\[::1\]:([1-9][0-9]{0,4})$/u.exec(host);
  if (!port || Number(port[1]) > 65535 || !/^demo-bs-adapter-[a-z0-9-]+$/u.test(project) ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      (process.env.GCLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT &&
        process.env.GCLOUD_PROJECT !== process.env.GOOGLE_CLOUD_PROJECT)) {
    throw new Error("BiteScore search emulator tests require a dedicated demo-bs-adapter-* project, explicit loopback emulator, and no credential file.");
  }
  return {project};
}

if (process.env.BITESAVER_FIRESTORE_EMULATOR_TEST !== "1") {
  test("real Firestore BiteScore search requires the explicit emulator gate", {
    skip: "set BITESAVER_FIRESTORE_EMULATOR_TEST=1 and use the dedicated local emulator",
  }, () => {});
} else {
  const safety = emulatorConfiguration();
  const {initializeApp, deleteApp} = require("firebase-admin/app");
  const {getFirestore, GeoPoint} = require("firebase-admin/firestore");
  const {createFirestoreCustomerBiteSaverSearchDatabase} = require("../lib/customer_bitesaver_search_store.js");
  const {OpaqueCursorCodec} = require("../lib/opaque_cursor.js");
  const {canonicalRestaurantGeohash} = require("../lib/restaurant_geo_helpers.js");
  const {buildBiteScoreRestaurantIndex, buildBiteScoreDishIndex} = require("../lib/search_index_builders.js");
  const contract = require("../lib/customer_bitescore_search_contract.js");
  const {startCustomerBiteScoreSearchHandler: start, advanceCustomerBiteScoreSearchHandler: advance,
    getCustomerBiteScoreSearchPageHandler: page} = require("../lib/customer_bitescore_search.js");
  const {startCustomerBiteScoreProfileListHandler: profileStart, advanceCustomerBiteScoreProfileListHandler: profileAdvance,
    getCustomerBiteScoreProfileListPageHandler: profilePage} = require("../lib/customer_bitescore_profile_search.js");
  const {buildCustomerBiteScoreReview, customerBiteScoreReviewIndex, biteScoreMenuSource} = require("../lib/customer_bitescore_reads.js");
  const {pageCustomerBiteScoreMenuWithDatabase: menuPage, reconcileCustomerBiteScoreMenuGeneration} = require("../lib/customer_bitescore_menu_search.js");
  const {reconcileCustomerBiteScoreFavoriteGeneration} = require("../lib/customer_bitescore_profile_generation.js");
  const {createHash} = require("node:crypto");
  const namespace = `bscore_search_${Date.now().toString(36)}_${randomBytes(5).toString("hex")}`;
  const app = initializeApp({projectId: safety.project}, namespace);
  const firestore = getFirestore(app);
  const real = createFirestoreCustomerBiteSaverSearchDatabase(firestore);
  const owned = new Set();
  const queries = [];
  const readBatches = [];
  const database = {
    getDocument: (path) => real.getDocument(path),
    getDocuments: (paths) => {readBatches.push(paths.length); return real.getDocuments(paths);},
    queryDocuments: (query) => {queries.push(query); return real.queryDocuments(query);},
    commitWrites: (writes) => {for (const w of writes) owned.add(w.path); return real.commitWrites(writes);},
    runTransaction: (operation) => real.runTransaction((transaction) => operation({
      getDocument: (path) => transaction.getDocument(path),
      getDocuments: (paths) => transaction.getDocuments(paths),
      createDocument: (path, data) => {owned.add(path); transaction.createDocument(path, data);},
      setDocument: (path, data) => {owned.add(path); transaction.setDocument(path, data);},
      deleteDocument: (path) => transaction.deleteDocument(path),
    })),
  };
  const nowMs = Date.now();
  const date = new Date(nowMs);
  const actorId = `${namespace}_actor`;
  const context = {actorId, nowMs, cursorCodec: new OpaqueCursorCodec({key: Buffer.alloc(32, 38), clock: () => nowMs})};
  function continuation(state, cursor = null) {
    return {schemaVersion: 1, sessionId: state.sessionId, queryFingerprint: state.queryFingerprint, cursor};
  }
  function request(criteria, generation = 1) {
    return {schemaVersion: 1, clientInstanceId: namespace, clientRequestId: `${namespace}_${generation}`,
      queryGeneration: generation, criteria};
  }
  async function ready(input) {
    let state = await start(database, input, context);
    let advances = 0;
    while (state.state === "preparing") {
      assert(++advances < 2000, "bounded preparation must eventually finish");
      state = await advance(database, continuation(state), context);
    }
    assert.equal(state.state, "ready");
    return {state, advances};
  }
  async function put(path, data) {
    owned.add(path);
    await firestore.doc(path).set(data);
  }
  test("real Firestore BiteScore search prepares bounded batches, globally pages binary ties and fences publication", async () => {
    try {
      const restaurantId = `${namespace}_restaurant`;
      const source = {name: namespace, normalizedName: namespace.toLowerCase(), city: "Miami", state: "FL", zipCode: "33101",
        streetAddress: "1 Synthetic Street", location: new GeoPoint(25.77, -80.19), isActive: true, active: true,
        isClaimed: false, restaurantWriteRevision: 0, geohash: canonicalRestaurantGeohash({latitude: 25.77, longitude: -80.19})};
      await put(`bitescore_restaurants/${restaurantId}`, source);
      await put(contract.customerBiteScoreIndexPath("restaurant", restaurantId),
        buildBiteScoreRestaurantIndex({sourceDocumentId: restaurantId, source, now: date}));
      const expected = [];
      for (let index = 0; index < 62; index++) {
        const id = `${namespace}_dish_${index.toString().padStart(3, "0")}`;
        const name = index % 3 === 0 ? "\u{10000} Equal" : index % 3 === 1 ? "\ue000 Equal" : "Burger";
        const dish = {restaurantId, restaurantName: source.name, name, normalizedName: name.toLowerCase(),
          category: "Burgers", categoryTags: ["burger"], isActive: true};
        const aggregate = {dishId: id, restaurantId, ratingCount: index % 5, overallBiteScore: index % 7,
          valueScoreAverage: 8, tastinessScoreAverage: 8, qualityScoreAverage: 8, overallImpressionAverage: 8};
        await put(`bitescore_dishes/${id}`, dish);
        await put(contract.customerBiteScoreIndexPath("dish", id), buildBiteScoreDishIndex({sourceDocumentId: id,
          dish, restaurantDocumentId: restaurantId, restaurant: source, aggregate, now: date}));
        expected.push({id, name, score: aggregate.overallBiteScore, count: aggregate.ratingCount});
      }
      expected.sort((a, b) => b.score - a.score || b.count - a.count ||
        (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const initial = await ready(request({kind: "dish", restaurantId, sort: "Highest BiteScore"}));
      assert.equal(initial.advances, 3, "62 dishes require three preparation requests of at most25 candidates");
      const first = await page(database, continuation(initial.state), context);
      assert.equal(first.items.length, 25);
      assert.equal(first.hasMore, true);
      assert.deepEqual(first.items.map((item) => item.sourceDocumentId), expected.slice(0, 25).map((item) => item.id));
      const repeated = await page(database, continuation(initial.state), context);
      assert.deepEqual({...repeated, nextCursor: null}, {...first, nextCursor: null}, "repeated pages are stable");
      assert.equal(typeof repeated.nextCursor, "string");
      assert.deepEqual((await page(database, continuation(initial.state, repeated.nextCursor), context)).items,
        (await page(database, continuation(initial.state, first.nextCursor), context)).items,
        "independently authenticated cursor nonces reach the same continuation");
      const second = await page(database, continuation(initial.state, first.nextCursor), context);
      const third = await page(database, continuation(initial.state, second.nextCursor), context);
      assert.deepEqual([...first.items, ...second.items, ...third.items].map((item) => item.sourceDocumentId), expected.map((item) => item.id));
      assert.equal(third.items.length, 12);
      assert.equal(third.hasMore, false);
      await assert.rejects(page(database, continuation(initial.state), {...context, actorId: `${actorId}_other`}));

      // Radius uses parent geography and parent-bound dishes, including a stale child-geohash fanout.
      const radius = await ready(request({kind: "dish", text: namespace, sort: "Closest",
        center: {latitude: 25.77, longitude: -80.19}, radiusMiles: 1}, 2));
      const radiusPage = await page(database, continuation(radius.state), context);
      assert.equal(radiusPage.items.length, 25);
      assert(radiusPage.items.every((item) => item.restaurantSourceDocumentId === restaurantId && item.distanceMiles === 0));
      await assert.rejects(page(database, continuation(initial.state, first.nextCursor), context), "superseded session is fenced");

      // Saved and Local Expert lists reuse the real adapter with their own exact comparators.
      const profileContext = {...context, userId: `${namespace}_reviewer`};
      for (const [index, row] of expected.entries()) {
        await put(`user_profiles/${profileContext.userId}/favorite_dishes/${row.id}`, {dishId: row.id});
        await reconcileCustomerBiteScoreFavoriteGeneration(database, profileContext.userId, "favorite_dishes", row.id);
        const reviewId = `${namespace}_review_${index}`;
        const raw = {userId: profileContext.userId, dishId: row.id, restaurantId,
          overallImpression: 8, overallBiteScore: index % 5, notes: "Synthetic public review",
          createdAt: new Date(nowMs + index % 7 * 1000)};
        await put(`dish_reviews/${reviewId}`, raw);
        await put(`${customerBiteScoreReviewIndex}/${createHash("sha256").update(reviewId).digest("hex")}`,
          buildCustomerBiteScoreReview(reviewId, raw));
      }
      async function profileList(criteria, generation) {
        const input = {schemaVersion: 1, clientInstanceId: `${namespace}_profile`, clientRequestId: `${namespace}_profile_${generation}`,
          queryGeneration: generation, criteria: {userId: profileContext.userId, ...criteria}};
        let state = await profileStart(database, input, profileContext);
        let advances = 0;
        while (state.state === "preparing") {
          assert(++advances < 100);
          state = await profileAdvance(database, continuation(state), profileContext);
        }
        assert.equal(state.state, "ready");
        const items = [];
        let cursor = null;
        do {
          const p = await profilePage(database, continuation(state, cursor), profileContext);
          assert(p.items.length <= 25);
          items.push(...p.items);
          cursor = p.nextCursor;
        } while (cursor);
        return items;
      }
      const saved = await profileList({kind: "savedDishes"}, 1);
      const savedExpected = [...expected].sort((a, b) => b.score - a.score ||
        (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      assert.deepEqual(saved.map((v) => v.dish.sourceDocumentId), savedExpected.map((v) => v.id));
      const expert = await profileList({kind: "localExpert", expertTypeId: "burger", sort: "highestRated"}, 2);
      assert.equal(expert.length, 62);
      const comparator = (a, b) => b.review.overallBiteScore - a.review.overallBiteScore ||
        a.review.createdAtMs - b.review.createdAtMs || (a.review.id < b.review.id ? -1 : a.review.id > b.review.id ? 1 : 0);
      assert.deepEqual(expert, [...expert].sort(comparator));

      // Shared menu relationship validation and globally ranked source preparation
      // use the same real Firestore adapter, without reading an entire menu.
      const menuId = `${namespace}_menu`;
      const ownerUserId = `${namespace}_owner`;
      const menuSource = {...source, isClaimed: true, ownerUserId, sharedMenuId: menuId};
      await put(`bitescore_restaurants/${restaurantId}`, menuSource);
      await put(contract.customerBiteScoreIndexPath("restaurant", restaurantId),
        buildBiteScoreRestaurantIndex({sourceDocumentId: restaurantId, source: menuSource, now: date}));
      await put(`restaurant_menus/${menuId}`, {bitescoreRestaurantId: restaurantId, createdByUserId: ownerUserId});
      const menuExpected = [];
      for (let i = 0; i < 61; i++) {
        const id = `menu-item-${61 - i}`;
        const raw = {category: i % 2 ? "Breakfast" : "Lunch", sortOrder: i % 4, name: `Name ${i % 3}`, price: "$5", description: "Synthetic"};
        await put(`restaurant_menus/${menuId}/menu_items/${id}`, raw);
        await reconcileCustomerBiteScoreMenuGeneration(database, `restaurant_menus/${menuId}`, "menu_items", id);
        menuExpected.push({id, ...raw});
      }
      const menuInput = {schemaVersion: 1, restaurantId, clientInstanceId: `${namespace}_menu_instance`,
        clientRequestId: `${namespace}_menu_request`, queryGeneration: 1};
      const resolve = (id) => biteScoreMenuSource(firestore, id);
      let menu = await menuPage(database, menuInput, context, resolve);
      let menuAdvances = 0;
      while (menu.state === "preparing") {
        assert(++menuAdvances < 20);
        menu = await menuPage(database, {...menuInput, sessionId: menu.sessionId, queryFingerprint: menu.queryFingerprint}, context, resolve);
      }
      assert.equal(menu.state, "available");
      const menuItems = [...menu.entries];
      let menuCursor = menu.nextCursor;
      while (menuCursor) {
        const next = await menuPage(database, {...menuInput, sessionId: menu.sessionId, queryFingerprint: menu.queryFingerprint, cursor: menuCursor}, context, resolve);
        menuItems.push(...next.entries);
        menuCursor = next.nextCursor;
      }
      const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
      menuExpected.sort((a, b) => compareText(a.category, b.category) || a.sortOrder - b.sortOrder || compareText(a.name, b.name) || compareText(a.id, b.id));
      assert.equal(menuItems.length, 61);
      assert.deepEqual(menuItems.map((v) => [v.category, v.sortOrder, v.name]), menuExpected.map((v) => [v.category, v.sortOrder, v.name]));
      await assert.rejects(menuPage(database, {...menuInput, sessionId: menu.sessionId, queryFingerprint: menu.queryFingerprint},
        {...context, actorId: "different-menu-actor"}, resolve));

      // Source visibility suppresses stale public projections immediately.
      await put(`bitescore_restaurants/${restaurantId}`, {...source, isActive: false});
      assert.equal((await page(database, continuation(radius.state), context)).items.length, 0);
      assert(queries.every((query) => query.limit <= 26));
      assert(readBatches.every((count) => count <= 75));
      const sessions = [...owned].filter((path) => path.startsWith(`${contract.customerBiteScoreSessionCollection}/`));
      const stored = await firestore.doc(sessions[sessions.length - 1]).get();
      assert(stored.data().expiresAt.toMillis() > nowMs, "stored sessions have TTL cleanup dates");
    } finally {
      const paths = [...owned];
      for (let offset = 0; offset < paths.length; offset += 400) {
        const batch = firestore.batch();
        for (const path of paths.slice(offset, offset + 400)) batch.delete(firestore.doc(path));
        await batch.commit();
      }
      await deleteApp(app);
    }
  });
}
