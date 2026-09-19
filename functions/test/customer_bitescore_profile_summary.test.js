"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {createHash} = require("node:crypto");
const {getCustomerBiteScoreProfileSummaryHandler, customerBiteScoreProfileBadge,
  customerBiteScoreFallbackUsername} = require("../lib/customer_bitescore_profile_summary.js");
function fakeDb(userId) {
  const documents = new Map([
    [`public_reviewer_profiles/${userId}`, {chosenUsername: "pizzaFan", fallbackUsername: "anon111", createdAt: new Date("2026-01-01"), email: "NEVER"}],
    [`private_bitescore_reviewer_stats/${createHash("sha256").update(userId).digest("hex")}`, {publicReviewCount: 50, publicHelpfulVotesReceived: 100}],
    [`user_profiles/${userId}`, {contributionPoints: 99, email: "NEVER", stripeCustomerId: "NEVER", authUid: "NEVER"}],
  ]);
  documents.set(`user_profiles/${userId}/local_expert_badges/burger`, {
    expertTypeId: "burger", displayName: "Burger", level: "level1", totalRestaurantCount: 5,
    localClusterRestaurantCount: 4, qualificationMethod: "localCluster", earnedAt: new Date("2026-01-01"),
    email: "NEVER", internalAdminNote: "NEVER",
  });
  const limits = [];
  const query = {where() {return this;}, orderBy() {return this;}, limit(n) {limits.push(n); return this;},
    async get() {return {docs: [{data: () => ({createdAtMs: Date.parse("2025-01-01")})}]};}};
  return {documents, limits, getAll(...refs) {assert.equal(refs.length, 23); return Promise.all(refs.map(ref => ref.get()));}, doc(path) {return {async get() {return {data: () => documents.get(path)};}};}, collection() {return query;}};
}
test("public profile header preserves totals/badge and never returns private fields", async () => {
  const db = fakeDb("user-1");
  const response = await getCustomerBiteScoreProfileSummaryHandler(db, {userId: "user-1"}, {userId: "viewer"}, {
    now: new Date("2026-09-19"), ownAccountCreatedAt: async () => {throw Error("public reads must not read Auth");},
  });
  assert.equal(response.publicDisplayName, "pizzaFan");
  assert.equal(response.reviewCount, 50);
  assert.equal(response.helpfulVotesReceived, 100);
  assert.equal(response.badgeLabel, "Top Contributor");
  assert.equal(response.contributionPoints, 99);
  assert.equal(response.badges.length, 1);
  assert.equal(response.badges[0].expertTypeId, "burger");
  assert.equal(response.badges[0].earnedAtMs, Date.parse("2026-01-01"));
  assert.equal(response.accountAgeDays, 626);
  assert.deepEqual(db.limits, [1]);
  assert.equal(JSON.stringify(response).includes("NEVER"), false);
});
test("own profile age comes from trusted Auth metadata without returning it", async () => {
  const db = fakeDb("user-1");
  const response = await getCustomerBiteScoreProfileSummaryHandler(db, {userId: "user-1"}, {userId: "user-1"}, {
    now: new Date("2026-09-19"), ownAccountCreatedAt: async (uid) => {
      assert.equal(uid, "user-1"); return Date.parse("2026-09-18");
    },
  });
  assert.equal(response.accountAgeDays, 1);
  assert.equal(response.badgeLabel, "Active Reviewer");
  assert.equal(Object.hasOwn(response, "createdAt"), false);
});
test("established badge thresholds and fallback username remain deterministic", () => {
  assert.equal(customerBiteScoreProfileBadge({reviewCount: 0, helpfulVotesReceived: 0, accountAgeDays: 999}), "New Reviewer");
  assert.equal(customerBiteScoreProfileBadge({reviewCount: 5, helpfulVotesReceived: 0, accountAgeDays: 0}), "Active Reviewer");
  assert.equal(customerBiteScoreProfileBadge({reviewCount: 15, helpfulVotesReceived: 25, accountAgeDays: 30}), "Trusted Reviewer");
  assert.equal(customerBiteScoreProfileBadge({reviewCount: 50, helpfulVotesReceived: 100, accountAgeDays: 90}), "Top Contributor");
  assert.equal(customerBiteScoreFallbackUsername("user-1"), "anon151824");
});
