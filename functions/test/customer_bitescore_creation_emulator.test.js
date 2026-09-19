"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {randomUUID} = require("node:crypto");

if (process.env.BITESAVER_FIRESTORE_EMULATOR_TEST !== "1") {
  test("BiteScore trusted creation transactions require local Firestore emulator", {
    skip: "set BITESAVER_FIRESTORE_EMULATOR_TEST=1 with loopback/demo configuration",
  }, () => {});
} else {
  const loopback = (value) => {
    const match = /^(?:localhost|127\.0\.0\.1):([1-9][0-9]{0,4})$/u.exec(value ?? "") ??
      /^\[::1\]:([1-9][0-9]{0,4})$/u.exec(value ?? "");
    return match !== null && Number(match[1]) <= 65535;
  };
  assert.ok(loopback(process.env.FIRESTORE_EMULATOR_HOST));
  for (const name of ["FIREBASE_EMULATOR_HUB", "FIREBASE_EMULATOR_HUB_HOST"]) {
    if (process.env[name]) assert.ok(loopback(process.env[name]));
  }
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  assert.match(projectId ?? "", /^demo-bs-adapter-[a-z0-9-]+$/u);
  if (process.env.GCLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT) {
    assert.equal(process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT);
  }
  assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const {initializeApp, deleteApp} = require("firebase-admin/app");
  const {getFirestore} = require("firebase-admin/firestore");
  const {createFirestoreRatingDestructivePrivateDatabase} = require("../lib/rating_destructive_job_store.js");
  const {OpaqueCursorCodec} = require("../lib/opaque_cursor.js");
  const api = require("../lib/customer_bitescore_creation.js");

  test("real Firestore creation retries, pending claim contention and provenance completion use bounded transactions", async () => {
    const token = randomUUID();
    const apps = [0, 1].map((i) => initializeApp({projectId}, `bitescore-creation-${token}-${i}`));
    const stores = apps.map((app) => getFirestore(app));
    const dbs = stores.map(createFirestoreRatingDestructivePrivateDatabase);
    const context = {cursorCodec: new OpaqueCursorCodec({key: Buffer.alloc(32, 7)}), userId: `creator-${token}`, email: "creator@example.test", emailVerified: true, isAnonymous: false};
    let restaurantId, dishId;
    const extraPaths = [];
    try {
      const input = {schemaVersion: 1, expectedUserId: context.userId, requestId: token, name: `Creation ${token}`, address: "1 Main St",
        city: "New York", state: "NY", zipCode: "10001", location: {latitude: 40.75, longitude: -73.99}};
      const restaurants = await Promise.all([0, 1, 0].map((i) => api.resolveCustomerBiteScoreRestaurantCreationHandler(dbs[i], input, context)));
      assert.equal(new Set(restaurants.map((r) => r.restaurant.id)).size, 1);
      restaurantId = restaurants[0].restaurant.id;
      assert.equal(restaurants[0].restaurant.ownerUserId, undefined);
      const request = {schemaVersion: 1, expectedUserId: context.userId, requestId: token, restaurantId, dishName: "BBQ-smash BURGER", category: "Burgers",
        subcategory: "Beef", categoryTags: ["burgers", "burger"], priceLabel: "$8", allowExistingMatch: false};
      const dishes = await Promise.all([0, 1, 0].map((i) => api.resolveCustomerBiteScoreDishCreationHandler(dbs[i], request, context)));
      assert.equal(new Set(dishes.map((r) => r.dish.id)).size, 1);
      dishId = dishes[0].dish.id;
      const completion = {schemaVersion: 1, expectedUserId: context.userId, restaurantId, dishId, expectedRestaurantRevision: 0};
      const completions = await Promise.all(dbs.map((db) => api.completeCustomerBiteScoreRestaurantProvenanceHandler(db, completion, context)));
      assert.ok(completions.every((r) => r.restaurant.restaurantWriteRevision === 1));
      const source = (await stores[0].doc(`bitescore_restaurants/${restaurantId}`).get()).data();
      assert.equal(source.createdByUserId, context.userId); assert.equal(source.createdFromDishId, dishId);
      assert.equal(source.location.latitude, 40.75); assert.equal(source.isClaimed, false);
      const longName = "é".repeat(750) + " wanted";
      const isolatedZip = String(20000 + Math.floor(Math.random() * 70000));
      const batch = stores[0].batch();
      let expectedLongRestaurantId;
      for (let i = 0; i < 53; i++) {
        const rowId = `creation-long-${token}-${String(i).padStart(3, "0")}-${"x".repeat(350)}`;
        const name = i === 52 ? longName : i === 51 ? "é".repeat(750) + " alias" : `Other ${i}`;
        const path = `bitescore_restaurants/${rowId}`;
        extraPaths.push(path);
        batch.set(stores[0].doc(path), {...source, id: rowId, name, normalizedName: name.toLowerCase(), zipCode: isolatedZip, zip: isolatedZip});
        if (i === 52) expectedLongRestaurantId = rowId;
      }
      await batch.commit();
      const longInput = {...input, requestId: randomUUID(), name: longName, zipCode: isolatedZip};
      let continuation = null, steps = 0, matched;
      do {
        matched = await api.resolveCustomerBiteScoreRestaurantCreationHandler(dbs[steps % 2],
          {...longInput, ...(continuation ? {cursor: continuation} : {})}, context);
        continuation = matched.nextCursor ?? null;
        steps++;
      } while (continuation);
      assert.equal(steps, 3);
      assert.equal(matched.restaurant.id, expectedLongRestaurantId);
      assert.equal(matched.restaurant.name, longName);
      assert.equal(matched.wasCreated, false);
      const claims = await Promise.allSettled([0, 1, 0].map((i) => api.submitCustomerBiteScoreRestaurantClaimHandler(dbs[i], {
        schemaVersion: 1, expectedUserId: context.userId, restaurantId, claimantName: "Owner", phone: "555-0100", message: "Review me",
      }, context)));
      assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1);
      assert.ok(claims.filter((r) => r.status === "rejected").every((r) => r.reason.code === "already-exists"));
      const pending = await stores[0].collection("restaurant_claim_requests").where("restaurantId", "==", restaurantId).limit(10).get();
      assert.equal(pending.size, 1); assert.equal(pending.docs[0].data().email, context.email);
      await stores[0].doc(`private_rating_dish_operation_locks/${dishId}`).set({jobId: "local-test"});
      await assert.rejects(api.resolveCustomerBiteScoreDishCreationHandler(dbs[0], request, context), {code: "failed-precondition"});
      await assert.rejects(api.completeCustomerBiteScoreRestaurantProvenanceHandler(dbs[0], completion, context), {code: "failed-precondition"});
    } finally {
      await Promise.all(extraPaths.map((path) => stores[0].doc(path).delete()));
      if (restaurantId) {
        const claims = await stores[0].collection("restaurant_claim_requests").where("restaurantId", "==", restaurantId).limit(10).get();
        await Promise.all(claims.docs.map((doc) => doc.ref.delete()));
        await stores[0].doc(`bitescore_restaurants/${restaurantId}`).delete();
      }
      if (dishId) {
        await stores[0].doc(`bitescore_dishes/${dishId}`).delete();
        await stores[0].doc(`private_rating_dish_operation_locks/${dishId}`).delete();
      }
      await Promise.all(apps.map(deleteApp));
    }
  });
}
