"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {randomUUID} = require("node:crypto");

if (process.env.BITESAVER_FIRESTORE_EMULATOR_TEST !== "1") {
  test("BiteScore aggregate real transaction contention requires local Firestore emulator", {
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
  const {
    biteScoreReviewAggregationRuntimePath, biteScoreReviewAggregateStatePath,
    saveCustomerBiteScoreReview, reconcileBiteScoreReviewAggregateEvent,
    reconcileBiteScoreReviewAggregateDish, continueBiteScoreReviewAggregateRebuild,
  } = require("../lib/bitescore_review_aggregate.js");

  test("actual callable request auth binds normal create/edit and rejects stale-account or unverified submissions", async () => {
    const token = randomUUID();
    const app = initializeApp({projectId});
    const store = getFirestore(app);
    const callable = require("../lib/customer_bitescore_runtime.js").saveCustomerBiteScoreReview;
    const dishId = `callable-dish-${token}`, restaurantId = `callable-restaurant-${token}`;
    const uid = `callable-user-${token}`;
    const statePath = biteScoreReviewAggregateStatePath(dishId);
    const data = {schemaVersion: 1, expectedUserId: uid, dishId, restaurantId,
      headline: "Customer draft", notes: "Normal verified customer", overallImpression: 8,
      tastinessScore: 8, qualityScore: 8, valueScore: 8};
    let reviewId;
    try {
      await store.doc(biteScoreReviewAggregationRuntimePath).set({enabled: true, version: 1, epoch: token});
      await store.doc(`bitescore_restaurants/${restaurantId}`).set({id: restaurantId, isActive: true});
      await store.doc(`bitescore_dishes/${dishId}`).set({id: dishId, restaurantId, isActive: true});
      const auth = {uid, token: {email_verified: true, firebase: {sign_in_provider: "password"}}};
      const created = await callable.run({data, auth});
      reviewId = created.review.id;
      assert.equal(created.review.userId, uid);
      const edited = await callable.run({data: {...data, overallImpression: 10}, auth});
      assert.equal(edited.review.id, reviewId);
      const aggregateBefore = (await store.doc(`dish_rating_aggregates/${dishId}`).get()).data();
      const reviewBefore = (await store.doc(`dish_reviews/${reviewId}`).get()).data();
      assert.equal(aggregateBefore.ratingCount, 1);
      await assert.rejects(callable.run({data, auth: {...auth, uid: `${uid}-other`}}), {code: "permission-denied"});
      await assert.rejects(callable.run({data, auth: {uid, token: {email_verified: false}}}), {code: "permission-denied"});
      assert.deepEqual((await store.doc(`dish_reviews/${reviewId}`).get()).data(), reviewBefore);
      assert.deepEqual((await store.doc(`dish_rating_aggregates/${dishId}`).get()).data(), aggregateBefore);
      assert.equal((await store.collection("dish_reviews").where("dishId", "==", dishId).get()).size, 1);
    } finally {
      await store.recursiveDelete(store.doc(statePath));
      if (reviewId) await store.doc(`dish_reviews/${reviewId}`).delete();
      await Promise.all([biteScoreReviewAggregationRuntimePath, `bitescore_dishes/${dishId}`,
        `bitescore_restaurants/${restaurantId}`, `dish_rating_aggregates/${dishId}`]
        .map((path) => store.doc(path).delete()));
      await deleteApp(app);
    }
  });

  test("real Firestore concurrent create/edit, duplicate event and generation rebase preserve one logical contribution", async () => {
    const token = randomUUID();
    const apps = [0, 1].map(() => initializeApp({projectId}, `bitescore-aggregate-${token}-${Math.random()}`));
    const stores = apps.map((app) => getFirestore(app));
    const dbs = stores.map(createFirestoreRatingDestructivePrivateDatabase);
    const dishId = `aggregate-dish-${token}`, restaurantId = `aggregate-restaurant-${token}`;
    const statePath = biteScoreReviewAggregateStatePath(dishId);
    const request = {schemaVersion: 1, dishId, restaurantId, headline: "Tasty", notes: "Good",
      overallImpression: 8, tastinessScore: 8, qualityScore: 8, valueScore: 8};
    const now = new Date();
    const reviews = new Set();
    try {
      await stores[0].doc(biteScoreReviewAggregationRuntimePath).set({enabled: true, version: 1, epoch: token});
      await stores[0].doc(`bitescore_restaurants/${restaurantId}`).set({id: restaurantId, isActive: true});
      await stores[0].doc(`bitescore_dishes/${dishId}`).set({id: dishId, restaurantId, isActive: true});
      const responses = await Promise.all(Array.from({length: 6}, (_, i) => saveCustomerBiteScoreReview(
        dbs[i % 2], {uid: `aggregate-user-${token}-${i}`, emailVerified: true}, {...request, expectedUserId: `aggregate-user-${token}-${i}`}, now)));
      responses.forEach((response) => reviews.add(response.review.id));
      let aggregate = (await stores[0].doc(`dish_rating_aggregates/${dishId}`).get()).data();
      assert.equal(aggregate.ratingCount, 6);
      assert.ok(Math.abs(aggregate.overallBiteScore - 80) < 1e-10);
      const reviewId = responses[0].review.id;
      const before = (await stores[0].doc(`dish_reviews/${reviewId}`).get()).data();
      await Promise.all([0, 1].map((client) => saveCustomerBiteScoreReview(
        dbs[client], {uid: `aggregate-user-${token}-0`, emailVerified: true},
        {...request, expectedUserId: `aggregate-user-${token}-0`, overallImpression: client + 1}, new Date(now.getTime() + 1000 + client))));
      const after = (await stores[0].doc(`dish_reviews/${reviewId}`).get()).data();
      await Promise.all([0, 1].map((client) => reconcileBiteScoreReviewAggregateEvent(dbs[client], {
        reviewId, before: null, after: before, now: new Date(),
      })));
      aggregate = (await stores[0].doc(`dish_rating_aggregates/${dishId}`).get()).data();
      assert.equal(aggregate.ratingCount, 6);
      assert.ok(Math.abs(aggregate.overallBiteScore - (5 * 80 + after.overallBiteScore) / 6) < 1e-10);
      // Existing destructive operations advance this generation; maintenance must
      // keep their public output intact until the bounded rebuild is complete.
      await stores[0].doc(`bitescore_dishes/${dishId}`).update({aggregateWriteGeneration: 2});
      await reconcileBiteScoreReviewAggregateDish(dbs[0], dishId, new Date());
      await continueBiteScoreReviewAggregateRebuild(dbs[1], dishId, new Date());
      await continueBiteScoreReviewAggregateRebuild(dbs[0], dishId, new Date());
      aggregate = (await stores[0].doc(`dish_rating_aggregates/${dishId}`).get()).data();
      assert.equal(aggregate.ratingCount, 6);
      assert.equal(aggregate.aggregateWriteGeneration, 2);
      assert.equal((await stores[0].doc(statePath).get()).data().status, "ready");
    } finally {
      await stores[0].recursiveDelete(stores[0].doc(statePath));
      await Promise.all([...reviews].map((reviewId) => stores[0].doc(`dish_reviews/${reviewId}`).delete()));
      await Promise.all([biteScoreReviewAggregationRuntimePath, `bitescore_dishes/${dishId}`,
        `bitescore_restaurants/${restaurantId}`, `dish_rating_aggregates/${dishId}`]
        .map((path) => stores[0].doc(path).delete()));
      await Promise.all(apps.map(deleteApp));
    }
  });
}
