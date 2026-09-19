"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {createHash} = require("node:crypto");
const test = require("node:test");
const {assertFails, assertSucceeds, initializeTestEnvironment} = require("@firebase/rules-unit-testing");
const firebase = require("firebase/compat/app");
require("firebase/compat/firestore");

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host ?? "", /^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/u,
  "Cutover tests require an explicit loopback Firestore emulator");
const verified = {email: "customer@example.com", email_verified: true, firebase: {sign_in_provider: "password"}};
let env;
const restaurant = {id: "restaurant", name: "Public restaurant", normalizedName: "public restaurant",
  ownerUserId: "owner", isClaimed: true, isActive: true, active: true, restaurantWriteRevision: 0,
  privateOwnerMarker: "must never reach customers", stripeCustomerId: "private-billing"};
const dish = {id: "dish", restaurantId: "restaurant", name: "Dish", normalizedName: "dish", isActive: true,
  mergedIntoDishId: null, privateModerationMarker: "private"};
const review = {id: "review", dishId: "dish", restaurantId: "restaurant", userId: "customer",
  overallImpression: 8, overallBiteScore: 80, headline: "Tasty", createdAt: new Date(), updatedAt: new Date()};
const image = {id: "image", dishId: "dish", restaurantId: "restaurant", uploadedByUserId: "uploader",
  imageUrl: "https://example.invalid/public.jpg", storagePath: "private-path", helpfulCount: 0};
function actor(uid) {
  if (uid === null) return env.unauthenticatedContext().firestore();
  return env.authenticatedContext(uid, {...verified, ...(uid === "admin" ? {admin: true} : {}),
    ...(uid === "email-admin" ? {email: "schuyler.cole@gmail.com"} : {}),
    ...(uid === "anonymous" ? {email_verified: false, firebase: {sign_in_provider: "anonymous"}} : {})}).firestore();
}
async function seed(target = env, active = true) {
  await target.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const values = {
      "bitescore_restaurants/restaurant": restaurant,
      "bitescore_restaurants/unclaimed": {...restaurant, id: "unclaimed", ownerUserId: null, isClaimed: false},
      "bitescore_dishes/dish": dish,
      "dish_rating_aggregates/dish": {dishId: "dish", restaurantId: "restaurant", ratingCount: 1, overallBiteScore: 80},
      "dish_reviews/review": review,
      "dish_catalog/catalog": {canonicalName: "Burger", privateImportMarker: "private"},
      "bitescore_dish_images/image": image,
      "review_feedback_votes/own": {id: "own", userId: "customer", reviewId: "review", dishId: "dish", restaurantId: "restaurant", voteType: "helpful"},
      "review_feedback_votes/other": {id: "other", userId: "other", reviewId: "review", voteType: "notHelpful"},
      "bitescore_dish_image_votes/image_customer": {id: "image_customer", userId: "customer", imageId: "image", voteType: "helpful"},
      "bitescore_dish_image_votes/image_other": {id: "image_other", userId: "other", imageId: "image", voteType: "notHelpful"},
      "restaurant_menus/menu": {id: "menu", createdByUserId: "owner", bitescoreRestaurantId: "restaurant", privateBillingMarker: "private"},
      "restaurant_menus/menu/menu_images/image": {imageUrl: "https://example.invalid/menu.jpg", privateMarker: "private"},
      "restaurant_menus/menu/menu_items/item": {name: "Item", price: "$5", privateMarker: "private"},
      "restaurant_menus/menu/menu_sections/section": {title: "Specials", privateMarker: "private"},
    };
    for (const [key, data] of Object.entries(values)) await db.doc(key).set(data);
    if (active) await db.doc("private_bitescore_runtime/aggregation").set({enabled: true, version: 1, epoch: "modern-local-cutover"});
  });
}
test.before(async () => {
  env = await initializeTestEnvironment({projectId: "demo-bitescore-final-cutover",
    firestore: {rules: fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8")}});
});
test.beforeEach(async () => {await env.clearFirestore(); await seed();});
test.after(async () => {if (env) await env.cleanup();});

test("complete final Rules deny mixed source gets and list queries to guests and ordinary customers", async () => {
  const paths = ["bitescore_restaurants/restaurant", "bitescore_restaurants/unclaimed", "bitescore_dishes/dish",
    "dish_rating_aggregates/dish", "dish_reviews/review", "dish_catalog/catalog", "bitescore_dish_images/image",
    "restaurant_menus/menu", "restaurant_menus/menu/menu_images/image", "restaurant_menus/menu/menu_items/item",
    "restaurant_menus/menu/menu_sections/section"];
  for (const uid of [null, "anonymous", "customer", "other"]) {
    const db = actor(uid);
    for (const doc of paths) {
      await assertFails(db.doc(doc).get());
      await assertFails(db.collection(doc.slice(0, doc.lastIndexOf("/"))).limit(25).get());
    }
  }
  // Authorship and a fabricated matching owner field in a request do not grant source access.
  await assertFails(actor("customer").doc("dish_reviews/review").get());
});

test("raw source cutoff stays closed even before the aggregate activation record exists", async () => {
  await env.withSecurityRulesDisabled(c => c.firestore().doc("private_bitescore_runtime/aggregation").delete());
  for (const uid of [null, "customer"]) {
    await assertFails(actor(uid).doc("bitescore_restaurants/restaurant").get());
    await assertFails(actor(uid).doc("bitescore_dishes/dish").get());
    await assertFails(actor(uid).doc("dish_reviews/review").get());
  }
});

test("exact owner and both existing Admin identities retain legitimate source management reads", async () => {
  for (const uid of ["owner", "admin", "email-admin"]) {
    const db = actor(uid);
    for (const doc of ["bitescore_restaurants/restaurant", "bitescore_dishes/dish", "dish_rating_aggregates/dish",
      "dish_reviews/review", "bitescore_dish_images/image", "restaurant_menus/menu", "restaurant_menus/menu/menu_items/item"]) {
      await assertSucceeds(db.doc(doc).get());
    }
    await assertSucceeds(db.collection("bitescore_dishes").where("restaurantId", "==", "restaurant").limit(25).get());
    await assertSucceeds(db.collection("bitescore_restaurants").where("ownerUserId", "==", "owner").where("isClaimed", "==", true).get());
    await assertSucceeds(db.collection("dish_reviews").where("dishId", "==", "dish").limit(25).get());
    await assertSucceeds(db.collection("dish_rating_aggregates").where("restaurantId", "==", "restaurant").get());
  }
  await assertFails(actor("owner").doc("bitescore_restaurants/unclaimed").get());
  await assertFails(actor("owner").doc("dish_catalog/catalog").get());
  await assertSucceeds(actor("admin").doc("dish_catalog/catalog").get());
  await assertSucceeds(actor("uploader").doc("bitescore_dish_images/image").get());
});

test("active authority rejects forged scores, ownership and direct photo counter writes", async () => {
  const customer = actor("customer");
  for (const uid of ["customer", "owner", "admin"]) {
    const db = actor(uid);
    await assertFails(db.doc("dish_rating_aggregates/dish").update({ratingCount: 100, overallBiteScore: 100}));
    await assertFails(db.doc("dish_rating_aggregates/new").set({dishId: "dish", restaurantId: "restaurant", ratingCount: 100}));
  }
  await assertFails(customer.doc("bitescore_restaurants/restaurant").update({ownerUserId: "customer", isClaimed: true,
    restaurantWriteRevision: 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp()}));
  await assertFails(actor("owner").doc("bitescore_restaurants/restaurant").update({ownerUserId: "customer", restaurantWriteRevision: 1}));
  await assertFails(customer.doc("dish_reviews/review").update({overallBiteScore: 100}));
  await assertFails(customer.doc("dish_reviews/new").set({...review, id: "new"}));
  await assertFails(customer.doc("bitescore_dish_images/forged").set({...image, uploadedByUserId: "customer"}));
  await assertFails(customer.doc("bitescore_dish_images/image").update({helpfulCount: 999}));
  await assertFails(customer.doc("bitescore_dishes/dish").update({imageCount: 999, primaryImageId: "forged"}));
  await assertSucceeds(actor("owner").doc("bitescore_dish_images/image").update({sortOrder: 1}));
  await assertFails(actor("other").doc("bitescore_dish_images/image").delete());
  await assertSucceeds(actor("uploader").doc("bitescore_dish_images/image").delete());
});

test("public review moderation and authorized own deletion retain operation-lock checks", async () => {
  const admin = actor("admin");
  await assertSucceeds(admin.doc("dish_reviews/review").update({isPublic: false}));
  await assertSucceeds(admin.doc("dish_reviews/review").update({isPublic: true}));
  await assertFails(actor("other").doc("dish_reviews/review").delete());
  await env.withSecurityRulesDisabled(c => c.firestore().doc("private_rating_dish_operation_locks/dish").set({state: "locked"}));
  await assertFails(admin.doc("dish_reviews/review").update({isPublic: false}));
  await assertFails(actor("customer").doc("dish_reviews/review").delete());
  await env.withSecurityRulesDisabled(c => c.firestore().doc("private_rating_dish_operation_locks/dish").delete());
  await assertSucceeds(actor("customer").doc("dish_reviews/review").delete());
});

test("own feedback and bounded gallery vote queries work without reading other voters or absent images", async () => {
  const db = actor("customer");
  await assertFails(actor(null).collection("review_feedback_votes").where("reviewId", "==", "review").get());
  await assertFails(db.doc("review_feedback_votes/other").get());
  await assertFails(db.collection("review_feedback_votes").where("reviewId", "==", "review").get());
  await assertSucceeds(db.doc("review_feedback_votes/own").get());
  await assertSucceeds(db.collection("review_feedback_votes").where("userId", "==", "customer").limit(25).get());
  const ref = db.doc("review_feedback_votes/new-own");
  await assertSucceeds(db.runTransaction(async tx => {
    const value = await tx.get(ref); assert.equal(value.exists, false);
    tx.set(ref, {userId: "customer", reviewId: "review", dishId: "dish", restaurantId: "restaurant", voteType: "helpful"});
  }));
  const votes = await assertSucceeds(db.collection("bitescore_dish_image_votes")
    .where(firebase.firestore.FieldPath.documentId(), "in", ["image_customer", "missing_customer"])
    .where("userId", "==", "customer").limit(25).get());
  assert.equal(votes.size, 1);
  await assertFails(db.doc("bitescore_dish_image_votes/image_other").get());
});

test("modern proposal metadata is consistent and complete before exact duplicate queries", async () => {
  const db = actor("customer");
  const rename = {id: "rename", userId: "customer", type: "rename", status: "pending", restaurantId: "restaurant",
    targetDishId: "dish", canonicalSourceDishId: "dish", proposedName: "  New Dish  ", normalizedProposedName: "new dish"};
  await assertSucceeds(db.doc("dish_edit_proposals/rename").set(rename));
  await assertFails(db.doc("dish_edit_proposals/bad-source").set({...rename, canonicalSourceDishId: "other"}));
  await assertFails(db.doc("dish_edit_proposals/bad-name").set({...rename, normalizedProposedName: "unrelated"}));
  const missing = {...rename}; delete missing.canonicalSourceDishId;
  await assertFails(db.doc("dish_edit_proposals/missing").set(missing));
  const merge = {...rename, id: "merge", type: "merge", mergeTargetDishId: "other-dish"};
  delete merge.proposedName; delete merge.normalizedProposedName;
  await assertSucceeds(db.doc("dish_edit_proposals/merge").set(merge));
  const aliasedRename = {...rename, type: null, targetType: "rename"};
  delete aliasedRename.normalizedProposedName;
  await assertFails(db.doc("dish_edit_proposals/alias-type").set(aliasedRename));
  const incompleteMerge = {...merge, sourceDishId: "dish", targetDishId: "other-dish"};
  delete incompleteMerge.mergeTargetDishId;
  await assertFails(db.doc("dish_edit_proposals/missing-merge-target").set(incompleteMerge));
  await assertFails(db.doc("dish_edit_proposals/null-merge-target").set({...incompleteMerge, mergeTargetDishId: null}));
  await assertSucceeds(actor("admin").doc("dish_edit_proposals/rename").update({status: "approved"}));

  await assertSucceeds(db.collection("dish_edit_proposals").where("userId", "==", "customer")
    .where("status", "==", "pending").where("type", "==", "rename").where("restaurantId", "==", "restaurant")
    .where("canonicalSourceDishId", "==", "dish").where("normalizedProposedName", "==", "new dish").limit(1).get());
  await assertFails(db.collection("dish_edit_proposals").where("userId", "==", "other").limit(1).get());
});

test("frozen preceding compatible Rules retain current default raw-read and legacy review behavior", async () => {
  const rules = fs.readFileSync(path.resolve(__dirname, "../fixtures/bitescore_pre_cutover.rules"), "utf8");
  assert.equal(createHash("sha256").update(rules).digest("hex"), "23988e7d5c217de62bf2f183cf0ea80f5af8707ed1ae80b60274671bda24e3d4");
  const compatible = await initializeTestEnvironment({projectId: "demo-bitescore-current-compatible", firestore: {rules}});
  try {
    await compatible.clearFirestore(); await seed(compatible, false);
    await assertSucceeds(compatible.unauthenticatedContext().firestore().doc("bitescore_restaurants/restaurant").get());
    const db = compatible.authenticatedContext("customer", verified).firestore();
    await assertSucceeds(db.doc("dish_reviews/review").get());
    await assertSucceeds(db.doc("dish_reviews/review").update({headline: "Current client edit"}));
    await assertSucceeds(db.doc("dish_rating_aggregates/dish").update({ratingCount: 2}));
  } finally {await compatible.cleanup();}
});
