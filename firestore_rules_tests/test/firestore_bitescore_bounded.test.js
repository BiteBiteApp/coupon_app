"use strict";
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {assertFails, assertSucceeds, initializeTestEnvironment} = require("@firebase/rules-unit-testing");

const privateCollections = [
  "private_bitescore_runtime", "private_bitescore_search_sessions",
  "private_bitescore_search_results", "private_bitescore_search_admission",
  "private_bitescore_catalog_generations", "private_bitescore_review_aggregates",
  "private_bitescore_review_index", "private_bitescore_review_stats",
  "private_bitescore_feedback_accounting", "private_bitescore_read_generations",
  "private_bitescore_reviewer_stats",
  "private_bitescore_image_state", "private_bitescore_profile_generations",
  "private_bitescore_suggestion_sessions", "private_bitescore_suggestion_admission",
  "private_bitescore_suggestion_generations",
  "private_bitescore_menu_generations",
];
let env;
const verified = {email: "customer@example.com", email_verified: true};
const review = {id: "review", userId: "customer", dishId: "dish", restaurantId: "restaurant",
  overallImpression: 8, overallBiteScore: 80, headline: "Tasty", createdAt: new Date(), updatedAt: new Date()};
const aggregate = {dishId: "dish", restaurantId: "restaurant", ratingCount: 1, overallBiteScore: 80};

test.before(async () => {
  env = await initializeTestEnvironment({projectId: "demo-coupon-app-bitescore-bounded",
    firestore: {rules: fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8")}});
});
test.after(async () => { if (env) await env.cleanup(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("bitescore_restaurants/restaurant").set({id: "restaurant", ownerUserId: "owner", isActive: true, active: true, restaurantWriteRevision: 0});
    await db.doc("bitescore_dishes/dish").set({id: "dish", restaurantId: "restaurant", name: "Dish", isActive: true});
    await db.doc("dish_reviews/review").set(review);
    await db.doc("dish_rating_aggregates/dish").set(aggregate);
  });
});
async function activate() {
  await env.withSecurityRulesDisabled((context) => context.firestore()
    .doc("private_bitescore_runtime/aggregation").set({enabled: true, version: 1, epoch: "post-wipe-demo"}));
}

test("all BiteScore private serving/accounting records deny customer and Admin access", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    for (const collection of privateCollections) await context.firestore().doc(`${collection}/record`).set({private: true});
    await context.firestore().doc("private_bitescore_review_aggregates/record/contributions/reviewer").set({private: true});
  });
  for (const actor of [env.unauthenticatedContext(), env.authenticatedContext("customer", verified),
    env.authenticatedContext("admin", {...verified, admin: true})]) {
    const db = actor.firestore();
    for (const collection of privateCollections) {
      await assertFails(db.doc(`${collection}/record`).get());
      await assertFails(db.collection(collection).limit(1).get());
      await assertFails(db.doc(`${collection}/forged`).set({enabled: true}));
      await assertFails(db.doc(`${collection}/record`).update({enabled: true}));
      await assertFails(db.doc(`${collection}/record`).delete());
    }
    await assertFails(db.doc("private_bitescore_review_aggregates/record/contributions/reviewer").get());
  }
});

test("absent runtime leaves existing client review and aggregate contracts unchanged", async () => {
  const db = env.authenticatedContext("customer", verified).firestore();
  await assertSucceeds(db.doc("dish_reviews/review").update({headline: "Edited"}));
  await assertSucceeds(db.doc("dish_reviews/new-review").set({...review, id: "new-review"}));
  await assertSucceeds(db.doc("dish_rating_aggregates/dish").set({...aggregate, ratingCount: 2}));
});

test("durable trusted mode blocks customer review totals while keeping moderation and own deletion", async () => {
  await activate();
  const customer = env.authenticatedContext("customer", verified).firestore();
  const admin = env.authenticatedContext("admin", {...verified, admin: true}).firestore();
  await assertFails(customer.doc("dish_reviews/new-review").set({...review, id: "new-review"}));
  await assertFails(customer.doc("dish_reviews/review").update({overallBiteScore: 100}));
  for (const db of [customer, admin]) {
    await assertFails(db.doc("dish_rating_aggregates/dish").update({overallBiteScore: 100}));
    await assertFails(db.doc("dish_rating_aggregates/dish").delete());
  }
  await assertSucceeds(admin.doc("dish_reviews/review").update({isPublic: false}));
  await assertSucceeds(admin.doc("dish_reviews/review").update({isPublic: true}));
  await assertFails(env.authenticatedContext("other", verified).firestore().doc("dish_reviews/review").delete());
  await assertSucceeds(customer.doc("dish_reviews/review").delete());
});
