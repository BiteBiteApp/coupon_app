"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");
const indexPath = path.join(repositoryRoot, "firestore.indexes.json");
const firebasePath = path.join(repositoryRoot, "firebase.json");

const ascending = (...fieldPaths) =>
  fieldPaths.map((fieldPath) => ({ fieldPath, order: "ASCENDING" }));
const descending = (...fieldPaths) =>
  fieldPaths.map((fieldPath) => ({ fieldPath, order: "DESCENDING" }));
const contains = (fieldPath) => ({ fieldPath, arrayConfig: "CONTAINS" });

const requiredIndex = (id, phase, sources, collectionGroup, fields) => ({
  id,
  phase,
  sources,
  collectionGroup,
  queryScope: "COLLECTION",
  fields,
});

const REQUIRED_INDEX_CONTRACT = [
  // Phase P2: Admin user, claimed-restaurant, and user-points directories.
  requiredIndex(
    "people.claimed-restaurant-name-search",
    "P2",
    ["functions/src/rating_admin_people_paging.ts"],
    "admin_user_claimed_restaurant_index",
    [
      ...ascending("claimedRestaurantVersion", "isClaimed", "isActive"),
      contains("restaurantNamePrefixTokens"),
      ...ascending(
        "ownerUid",
        "normalizedRestaurantName",
        "sourceRestaurantId",
      ),
    ],
  ),
  requiredIndex(
    "people.claimed-restaurant-preview",
    "P2",
    ["functions/src/rating_admin_people_paging.ts"],
    "admin_user_claimed_restaurant_index",
    [
      ...ascending(
        "claimedRestaurantVersion",
        "ownerUid",
        "isClaimed",
        "isActive",
        "normalizedRestaurantName",
        "sourceRestaurantId",
      ),
    ],
  ),
  requiredIndex(
    "people.display-name-search",
    "P2",
    ["functions/src/rating_admin_people_paging.ts"],
    "admin_user_directory",
    [contains("displayNamePrefixTokens"), ...ascending("normalizedDisplayName")],
  ),
  requiredIndex(
    "people.email-search",
    "P2",
    ["functions/src/rating_admin_people_paging.ts"],
    "admin_user_directory",
    [...ascending("normalizedEmail", "normalizedDisplayName")],
  ),
  requiredIndex(
    "people.phone-search",
    "P2",
    ["functions/src/rating_admin_people_paging.ts"],
    "admin_user_directory",
    [...ascending("normalizedPhone", "normalizedDisplayName")],
  ),
  requiredIndex(
    "people.points-descending",
    "P2",
    ["functions/src/rating_admin_people_paging.ts"],
    "admin_user_directory",
    [
      ...ascending("includedInUserPointsDirectory"),
      ...descending("contributionPoints"),
      ...ascending("normalizedUserPointsDisplayName"),
    ],
  ),
  requiredIndex(
    "people.points-ascending",
    "P2",
    ["functions/src/rating_admin_people_paging.ts"],
    "admin_user_directory",
    [
      ...ascending(
        "includedInUserPointsDirectory",
        "contributionPoints",
        "normalizedUserPointsDisplayName",
      ),
    ],
  ),
  requiredIndex(
    "people.points-display-name",
    "P2",
    ["functions/src/rating_admin_people_paging.ts"],
    "admin_user_directory",
    [
      ...ascending(
        "includedInUserPointsDirectory",
        "normalizedUserPointsDisplayName",
      ),
    ],
  ),
  requiredIndex(
    "people.points-recent-contribution",
    "P2",
    ["functions/src/rating_admin_people_paging.ts"],
    "admin_user_directory",
    [
      ...ascending("includedInUserPointsDirectory"),
      ...descending("lastContributionAt", "contributionPoints"),
      ...ascending("normalizedUserPointsDisplayName"),
    ],
  ),

  // BiteSaver Discovery Stage 1: bounded offer candidate preparation/paging.
  requiredIndex(
    "bitesaver-discovery.offer-geographic-preparation",
    "BITESAVER_STAGE_1",
    ["functions/src/customer_bitesaver_search_worker.ts"],
    "bitesaver_offer_index",
    [
      ...ascending(
        "source",
        "customerOfferProjectionVersion",
        "customerDiscoverable",
        "geohash",
        "indexDocumentId",
      ),
    ],
  ),
  requiredIndex(
    "bitesaver-discovery.parent-offer-page",
    "BITESAVER_STAGE_1",
    ["functions/src/customer_bitesaver_search_session.ts"],
    "bitesaver_offer_index",
    [
      ...ascending(
        "source",
        "customerOfferProjectionVersion",
        "customerDiscoverable",
        "restaurantAccountId",
        "presentationTypeRank",
      ),
      ...descending("sourceCreatedAtOrderKey", "sourceDocumentId"),
    ],
  ),

  // Phase P2: queues, ledgers, and retained legacy geohash coverage.
  requiredIndex(
    "coupon-admin.open-bitesaver-reports",
    "P2",
    ["functions/src/coupon_admin_paging.ts"],
    "bitesaver_reports",
    [...ascending("status"), ...descending("createdAt")],
  ),
  requiredIndex(
    "people.contribution-ledger",
    "P2",
    ["functions/src/rating_admin_people_paging.ts"],
    "bitescore_contribution_point_ledger",
    [...ascending("userId"), ...descending("createdAt")],
  ),
  requiredIndex(
    "legacy.bitescore-status-geohash",
    "LEGACY",
    ["functions/src/index.ts", "functions/src/admin_restaurant_search_helpers.ts"],
    "bitescore_restaurants",
    [...ascending("isActive", "geohash")],
  ),
  requiredIndex(
    "user-directory.bitescore-owner-updated",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "bitescore_restaurants",
    [...ascending("ownerUserId"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.bitescore-owner-created",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "bitescore_restaurants",
    [...ascending("ownerUserId"), ...descending("createdAt")],
  ),

  // Phase P2/P3: user-directory maintenance and dish workflows.
  requiredIndex(
    "user-directory.dish-proposal-user-updated",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "dish_edit_proposals",
    [...ascending("userId"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.dish-proposal-user-created",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "dish_edit_proposals",
    [...ascending("userId"), ...descending("createdAt")],
  ),
  requiredIndex(
    "user-directory.dish-proposal-creator-updated",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "dish_edit_proposals",
    [...ascending("createdByUserId"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.dish-proposal-creator-created",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "dish_edit_proposals",
    [...ascending("createdByUserId"), ...descending("createdAt")],
  ),
  requiredIndex(
    "rating-admin.pending-dish-reports",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "dish_reports",
    [...ascending("status"), ...descending("createdAt")],
  ),
  requiredIndex(
    "user-directory.dish-report-updated",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "dish_reports",
    [...ascending("reportingUserId"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.dish-report-created",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "dish_reports",
    [...ascending("reportingUserId"), ...descending("createdAt")],
  ),
  requiredIndex(
    "user-directory.dish-review-updated",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "dish_reviews",
    [...ascending("userId"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.dish-review-created",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "dish_reviews",
    [...ascending("userId"), ...descending("createdAt")],
  ),
  requiredIndex(
    "rating-admin.dish-directory",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "dish_search_index",
    [
      ...ascending(
        "source",
        "adminVisible",
        "restaurantSourceDocumentId",
        "normalizedName",
        "sourceDocumentId",
      ),
    ],
  ),
  requiredIndex(
    "rating-admin.dish-directory-name",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "dish_search_index",
    [
      ...ascending("source", "adminVisible", "restaurantSourceDocumentId"),
      contains("namePrefixTokens"),
      ...ascending("normalizedName", "sourceDocumentId"),
    ],
  ),
  requiredIndex(
    "rating-admin.dish-directory-status",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "dish_search_index",
    [
      ...ascending(
        "source",
        "adminVisible",
        "restaurantSourceDocumentId",
        "dishActive",
        "normalizedName",
        "sourceDocumentId",
      ),
    ],
  ),
  requiredIndex(
    "rating-admin.dish-directory-status-name",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "dish_search_index",
    [
      ...ascending(
        "source",
        "adminVisible",
        "restaurantSourceDocumentId",
        "dishActive",
      ),
      contains("namePrefixTokens"),
      ...ascending("normalizedName", "sourceDocumentId"),
    ],
  ),
  requiredIndex(
    "rating-admin.pending-duplicate-reports",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "duplicate_restaurant_reports",
    [...ascending("status"), ...descending("createdAt")],
  ),
  requiredIndex(
    "user-directory.duplicate-report-updated",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "duplicate_restaurant_reports",
    [...ascending("reportingUserId"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.duplicate-report-created",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "duplicate_restaurant_reports",
    [...ascending("reportingUserId"), ...descending("createdAt")],
  ),
  requiredIndex(
    "bitesaver-discovery.ordered-result-page",
    "BITESAVER_STAGE_1",
    ["functions/src/customer_bitesaver_search_session.ts"],
    "private_bitesaver_search_results",
    [
      ...ascending(
        "sessionId",
        "attemptGeneration",
        "eligibleAtPreparation",
        "exactPreferenceRank",
        "distanceSortMiles",
        "lowercaseDisplayNameOrderKey",
        "authoritativeAccountIdOrderKey",
      ),
    ],
  ),
  requiredIndex(
    "dish-workflow.active-application-jobs",
    "LATER",
    ["functions/src/dish_proposal_runtime_integration.ts"],
    "private_dish_edit_application_jobs",
    [...ascending("status", "updatedAt")],
  ),
  requiredIndex(
    "dish-workflow.pending-members-by-time",
    "LATER",
    ["functions/src/dish_proposal_private_maintenance.ts"],
    "private_dish_edit_proposal_group_members",
    [...ascending("groupId", "currentPending", "trustedServerCreateTime")],
  ),
  requiredIndex(
    "dish-workflow.pending-members-by-generation",
    "LATER",
    ["functions/src/dish_proposal_resolution_jobs.ts"],
    "private_dish_edit_proposal_group_members",
    [...ascending("groupId", "currentPending", "membershipGeneration")],
  ),
  requiredIndex(
    "dish-workflow.group-suggestion-paging",
    "P2",
    ["functions/src/rating_admin_dish_suggestions_paging.ts"],
    "private_dish_edit_proposal_groups",
    [...ascending("resolutionIdentitiesValid", "oldestTrustedServerCreateTime")],
  ),
  requiredIndex(
    "dish-workflow.due-groups",
    "LATER",
    ["functions/src/dish_proposal_runtime_integration.ts"],
    "private_dish_edit_proposal_groups",
    [...ascending("resolutionIdentitiesValid", "autoEligible", "dueAt")],
  ),
  requiredIndex(
    "destructive-workflow.active-jobs",
    "LATER",
    ["functions/src/rating_destructive_scheduler.ts"],
    "private_rating_destructive_jobs",
    [...ascending("status", "updatedAt")],
  ),

  // Phase P2: Coupon/Rating Admin queues and restaurant directories.
  requiredIndex(
    "legacy.bitesaver-approval-geohash",
    "LEGACY",
    [],
    "restaurant_accounts",
    [...ascending("approvalStatus", "geohash")],
  ),
  requiredIndex(
    "coupon-admin.pending-applications",
    "P2",
    ["functions/src/coupon_admin_paging.ts"],
    "restaurant_accounts",
    [...ascending("approvalStatus"), ...descending("createdAt")],
  ),
  requiredIndex(
    "rating-admin.pending-claim-requests",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "restaurant_claim_requests",
    [...ascending("status"), ...descending("createdAt")],
  ),
  requiredIndex(
    "rating-admin.latest-approved-claim",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "restaurant_claim_requests",
    [...ascending("restaurantId", "status"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.claim-request-updated",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "restaurant_claim_requests",
    [...ascending("requesterUserId"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.claim-request-created",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "restaurant_claim_requests",
    [...ascending("requesterUserId"), ...descending("createdAt")],
  ),
  requiredIndex(
    "admin.invite-history",
    "P2",
    ["functions/src/coupon_admin_paging.ts", "functions/src/rating_admin_paging.ts"],
    "restaurant_invites",
    [...ascending("side"), ...descending("createdAt")],
  ),
  requiredIndex(
    "coupon-admin.pending-name-changes",
    "P2",
    ["functions/src/coupon_admin_paging.ts"],
    "restaurant_name_change_requests",
    [...ascending("status"), ...descending("createdAt")],
  ),
  requiredIndex(
    "rating-admin.pending-restaurant-reports",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "restaurant_reports",
    [...ascending("status"), ...descending("createdAt")],
  ),
  requiredIndex(
    "user-directory.restaurant-report-updated",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "restaurant_reports",
    [...ascending("reportingUserId"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.restaurant-report-created",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "restaurant_reports",
    [...ascending("reportingUserId"), ...descending("createdAt")],
  ),
  requiredIndex(
    "admin.restaurant-exact-zip",
    "P2",
    ["functions/src/coupon_admin_paging.ts", "functions/src/rating_admin_paging.ts"],
    "restaurant_search_index",
    [...ascending("source", "adminDirectoryVisible", "zip5", "normalizedName", "sourceDocumentId")],
  ),
  requiredIndex(
    "admin.restaurant-exact-zip-name",
    "P2",
    ["functions/src/coupon_admin_paging.ts", "functions/src/rating_admin_paging.ts"],
    "restaurant_search_index",
    [
      ...ascending("source", "adminDirectoryVisible", "zip5"),
      contains("namePrefixTokens"),
      ...ascending("normalizedName", "sourceDocumentId"),
    ],
  ),
  requiredIndex(
    "admin.restaurant-exact-city-state",
    "P2",
    ["functions/src/coupon_admin_paging.ts", "functions/src/rating_admin_paging.ts"],
    "restaurant_search_index",
    [...ascending("source", "adminDirectoryVisible", "cityStateKey", "normalizedName", "sourceDocumentId")],
  ),
  requiredIndex(
    "admin.restaurant-exact-city-state-name",
    "P2",
    ["functions/src/coupon_admin_paging.ts", "functions/src/rating_admin_paging.ts"],
    "restaurant_search_index",
    [
      ...ascending("source", "adminDirectoryVisible", "cityStateKey"),
      contains("namePrefixTokens"),
      ...ascending("normalizedName", "sourceDocumentId"),
    ],
  ),
  requiredIndex(
    "admin.restaurant-radius",
    "P2",
    ["functions/src/coupon_admin_radius_sessions.ts", "functions/src/rating_admin_radius_sessions.ts"],
    "restaurant_search_index",
    [...ascending("source", "adminDirectoryVisible", "geohash", "sourceDocumentId")],
  ),
  requiredIndex(
    "admin.restaurant-radius-name",
    "P2",
    ["functions/src/coupon_admin_radius_sessions.ts", "functions/src/rating_admin_radius_sessions.ts"],
    "restaurant_search_index",
    [
      ...ascending("source", "adminDirectoryVisible"),
      contains("namePrefixTokens"),
      ...ascending("geohash", "sourceDocumentId"),
    ],
  ),
  requiredIndex(
    "rating-admin.claimed-restaurants",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "restaurant_search_index",
    [...ascending("source", "adminDirectoryVisible", "isClaimed", "normalizedName", "sourceDocumentId")],
  ),
  requiredIndex(
    "rating-admin.claimed-restaurants-name",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "restaurant_search_index",
    [
      ...ascending("source", "adminDirectoryVisible", "isClaimed"),
      contains("namePrefixTokens"),
      ...ascending("normalizedName", "sourceDocumentId"),
    ],
  ),
  requiredIndex(
    "rating-admin.restaurant-exact-zip-status",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "restaurant_search_index",
    [...ascending("source", "adminDirectoryVisible", "zip5", "isActive", "normalizedName", "sourceDocumentId")],
  ),
  requiredIndex(
    "rating-admin.restaurant-exact-zip-status-name",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "restaurant_search_index",
    [
      ...ascending("source", "adminDirectoryVisible", "zip5", "isActive"),
      contains("namePrefixTokens"),
      ...ascending("normalizedName", "sourceDocumentId"),
    ],
  ),
  requiredIndex(
    "rating-admin.restaurant-exact-city-state-status",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "restaurant_search_index",
    [...ascending("source", "adminDirectoryVisible", "cityStateKey", "isActive", "normalizedName", "sourceDocumentId")],
  ),
  requiredIndex(
    "rating-admin.restaurant-exact-city-state-status-name",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "restaurant_search_index",
    [
      ...ascending("source", "adminDirectoryVisible", "cityStateKey", "isActive"),
      contains("namePrefixTokens"),
      ...ascending("normalizedName", "sourceDocumentId"),
    ],
  ),
  requiredIndex(
    "rating-admin.restaurant-radius-status",
    "P2",
    ["functions/src/rating_admin_radius_sessions.ts"],
    "restaurant_search_index",
    [...ascending("source", "adminDirectoryVisible", "isActive", "geohash", "sourceDocumentId")],
  ),
  requiredIndex(
    "rating-admin.restaurant-radius-status-name",
    "P2",
    ["functions/src/rating_admin_radius_sessions.ts"],
    "restaurant_search_index",
    [
      ...ascending("source", "adminDirectoryVisible", "isActive"),
      contains("namePrefixTokens"),
      ...ascending("geohash", "sourceDocumentId"),
    ],
  ),
  requiredIndex(
    "bitesaver-discovery.restaurant-geographic-preparation",
    "BITESAVER_STAGE_1",
    ["functions/src/customer_bitesaver_search_worker.ts"],
    "restaurant_search_index",
    [
      ...ascending(
        "source",
        "publicProjectionVersion",
        "publicVisible",
        "geohash",
        "sourceDocumentId",
      ),
    ],
  ),
  requiredIndex(
    "user-directory.feedback-vote-updated",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "review_feedback_votes",
    [...ascending("userId"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.feedback-vote-created",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "review_feedback_votes",
    [...ascending("userId"), ...descending("createdAt")],
  ),
  requiredIndex(
    "rating-admin.pending-review-reports",
    "P2",
    ["functions/src/rating_admin_paging.ts"],
    "review_reports",
    [...ascending("status"), ...descending("createdAt")],
  ),
  requiredIndex(
    "user-directory.review-report-updated",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "review_reports",
    [...ascending("reportingUserId"), ...descending("updatedAt")],
  ),
  requiredIndex(
    "user-directory.review-report-created",
    "P2",
    ["functions/src/admin_user_directory_maintenance.ts"],
    "review_reports",
    [...ascending("reportingUserId"), ...descending("createdAt")],
  ),
  requiredIndex(
    "admin.radius-results",
    "P2",
    ["functions/src/coupon_admin_radius_sessions.ts", "functions/src/rating_admin_radius_sessions.ts"],
    "results",
    [...ascending("distanceMillimeters", "normalizedName", "sourceDocumentId")],
  ),
  requiredIndex(
    "admin-link.radius-results",
    "P2",
    ["functions/src/admin_link_restaurant_radius_sessions.ts"],
    "results",
    [
      ...ascending(
        "distanceMillimeters",
        "normalizedName",
        "sourceDocumentId",
        "source",
      ),
    ],
  ),
  // BiteScore opt-in source specialization. Keep this independent inventory
  // explicit: it records query contracts, not a copy generated from the manifest.
  requiredIndex(
    "bitescore.restaurant-geographic-preparation",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_search.ts"],
    "restaurant_search_index",
    ascending("source", "publicVisible", "customerPublicProjectionVersion", "geohash", "__name__"),
  ),
  requiredIndex(
    "bitescore.restaurant-global-preparation",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_search.ts"],
    "restaurant_search_index",
    ascending("source", "publicVisible", "customerPublicProjectionVersion", "__name__"),
  ),
  requiredIndex(
    "bitescore.restaurant-dish-preparation",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_search.ts"],
    "dish_search_index",
    ascending("source", "publicVisible", "customerPublicProjectionVersion", "restaurantSourceDocumentId", "__name__"),
  ),
  requiredIndex(
    "bitescore.dish-global-preparation",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_search.ts"],
    "dish_search_index",
    ascending("source", "publicVisible", "customerPublicProjectionVersion", "__name__"),
  ),
  requiredIndex(
    "bitescore.global-search-and-profile-results",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_search.ts", "functions/src/customer_bitescore_profile_search.ts"],
    "private_bitescore_search_results",
    ascending("sessionId", "attempt", "rank0", "rank1", "rank2", "nameKey", "idKey0", "idKey1", "__name__"),
  ),
  requiredIndex(
    "bitescore.current-logical-review-winner",
    "BITESCORE_STAGE_1",
    ["functions/src/bitescore_review_aggregate.ts"],
    "dish_reviews",
    [...ascending("dishId", "userId"), ...descending("updatedAt", "aggregateReviewOrder0", "aggregateReviewOrder1")],
  ),
  requiredIndex(
    "bitescore.aggregate-bounded-reconciliation",
    "BITESCORE_STAGE_1",
    ["functions/src/bitescore_review_aggregate.ts"],
    "private_bitescore_review_aggregates",
    ascending("status", "updatedAt"),
  ),
  requiredIndex(
    "bitescore.dish-reviews-most-helpful",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_reads.ts"],
    "private_bitescore_review_index",
    [...ascending("dishId", "publicVisible"), ...descending("writtenText", "helpfulScore", "createdAtMicros"),
      ...ascending("reviewOrder0", "reviewOrder1")],
  ),
  requiredIndex(
    "bitescore.dish-reviews-most-recent",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_reads.ts"],
    "private_bitescore_review_index",
    [...ascending("dishId", "publicVisible"), ...descending("createdAtMicros"), ...ascending("reviewOrder0", "reviewOrder1")],
  ),
  requiredIndex(
    "bitescore.dish-reviews-highest-score",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_reads.ts"],
    "private_bitescore_review_index",
    [...ascending("dishId", "publicVisible"), ...descending("overallBiteScore", "createdAtMicros"), ...ascending("reviewOrder0", "reviewOrder1")],
  ),
  requiredIndex(
    "bitescore.dish-reviews-lowest-score",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_reads.ts"],
    "private_bitescore_review_index",
    [...ascending("dishId", "publicVisible", "overallBiteScore"), ...descending("createdAtMicros"), ...ascending("reviewOrder0", "reviewOrder1")],
  ),
  requiredIndex(
    "bitescore.current-review-report",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_reads.ts"],
    "review_reports",
    ascending("reviewId", "reportingUserId", "status"),
  ),
  requiredIndex(
    "bitescore.new-restaurant-exact-duplicate-check",
    "BITESCORE_STAGE_1",
    ["lib/services/bitescore_service.dart", "functions/src/customer_bitescore_creation.ts"],
    "bitescore_restaurants",
    ascending("zipCode", "normalizedName"),
  ),
  requiredIndex(
    "bitescore.restaurant-active-dish-check",
    "BITESCORE_STAGE_1",
    ["lib/services/bitescore_service.dart", "functions/src/customer_bitescore_creation.ts"],
    "bitescore_dishes",
    ascending("restaurantId", "isActive", "mergedIntoDishId"),
  ),
  requiredIndex(
    "bitescore.new-dish-exact-duplicate-check",
    "BITESCORE_STAGE_1",
    ["lib/services/bitescore_service.dart", "functions/src/customer_bitescore_creation.ts"],
    "bitescore_dishes",
    ascending("restaurantId", "isActive", "mergedIntoDishId", "normalizedName"),
  ),
  requiredIndex(
    "bitescore.current-restaurant-report",
    "BITESCORE_STAGE_1",
    ["lib/services/bitescore_service.dart"],
    "restaurant_reports",
    ascending("reportingUserId", "restaurantId", "status"),
  ),
  requiredIndex(
    "bitescore.current-dish-report",
    "BITESCORE_STAGE_1",
    ["lib/services/bitescore_service.dart"],
    "dish_reports",
    ascending("reportingUserId", "dishId", "status"),
  ),
  requiredIndex(
    "bitescore.current-duplicate-restaurant-report",
    "BITESCORE_STAGE_1",
    ["lib/services/bitescore_service.dart"],
    "duplicate_restaurant_reports",
    ascending("reportingUserId", "restaurantId", "status"),
  ),
  requiredIndex(
    "bitescore.profile-review-preparation",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_profile_search.ts"],
    "private_bitescore_review_index",
    ascending("userId", "publicVisible", "__name__"),
  ),
  requiredIndex(
    "bitescore.public-profile-oldest-review",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_profile_summary.ts"],
    "private_bitescore_review_index",
    ascending("userId", "publicVisible", "createdAtMs"),
  ),
  requiredIndex(
    "bitescore.restaurant-dish-suggestions",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_suggestions.ts"],
    "dish_search_index",
    ascending("source", "restaurantSourceDocumentId", "publicVisible", "__name__"),
  ),
  requiredIndex(
    "bitescore.dish-image-gallery-ranking",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_reads.ts"],
    "private_bitescore_image_state",
    [...ascending("dishId"), ...descending("helpfulCount"), ...ascending("sortOrder", "createdAtMicros", "imageOrder0", "imageOrder1")],
  ),
  requiredIndex(
    "bitescore.review-primary-image",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_reads.ts"],
    "private_bitescore_image_state",
    ascending("reviewId", "dishId", "sortOrder", "createdAtMicros", "imageOrder0", "imageOrder1"),
  ),
  requiredIndex(
    "bitescore.globally-ordered-menu-results",
    "BITESCORE_STAGE_1",
    ["functions/src/customer_bitescore_menu_search.ts"],
    "private_bitescore_search_results",
    ascending("sessionId", "attempt", "kindRank", "categoryRank", "categoryKey", "sortOrder", "titleKey", "idKey0", "idKey1", "__name__"),
  ),
  requiredIndex(
    "bitescore.pending-rename-existence", "BITESCORE_STAGE_2",
    ["lib/services/dish_edit_proposal_duplicate_lookup.dart"],
    "dish_edit_proposals",
    ascending("userId", "status", "type", "restaurantId", "canonicalSourceDishId", "normalizedProposedName"),
  ),
  requiredIndex(
    "bitescore.pending-merge-existence", "BITESCORE_STAGE_2",
    ["lib/services/dish_edit_proposal_duplicate_lookup.dart"],
    "dish_edit_proposals",
    ascending("userId", "status", "type", "restaurantId", "canonicalSourceDishId", "mergeTargetDishId"),
  ),
  requiredIndex(
    "bitescore.pending-long-rename-continuation", "BITESCORE_STAGE_2",
    ["lib/services/dish_edit_proposal_duplicate_lookup.dart"],
    "dish_edit_proposals",
    ascending("userId", "status", "type", "restaurantId", "canonicalSourceDishId", "__name__"),
  ),
  requiredIndex(
    "bitescore.pending-claim-existence", "BITESCORE_STAGE_2",
    ["functions/src/customer_bitescore_creation.ts"],
    "restaurant_claim_requests",
    ascending("restaurantId", "requesterUserId", "status"),
  ),
  requiredIndex(
    "bitescore.owned-claimed-restaurants", "BITESCORE_STAGE_2",
    ["lib/services/bitescore_owner_queries.dart"],
    "bitescore_restaurants",
    ascending("ownerUserId", "isClaimed"),
  ),
];

const AUTOMATIC_INDEX_CONTRACT = [
  {
    id: "bitescore.long-restaurant-name-continuation",
    phase: "BITESCORE_STAGE_2",
    source: "functions/src/customer_bitescore_creation.ts",
    reason: "ZIP equality with ascending document identity uses its automatic single-field index",
  },
  {
    id: "customer.public-restaurant-projection",
    phase: "P1",
    source: "lib/services/restaurant_account_service.dart",
    reason: "equality-only filters use Firestore single-field index merging",
  },
  {
    id: "customer.public-restaurant-projection-by-source-id",
    phase: "P1",
    source: "lib/services/restaurant_account_service.dart",
    reason: "equality-only filters use Firestore single-field index merging",
  },
  {
    id: "admin.geohash-without-status",
    phase: "P2",
    source: "functions/src/index.ts",
    reason: "one ordered field uses its automatic single-field index",
  },
  {
    id: "customer.child-collections-created-at",
    phase: "P1",
    source: "lib/services/restaurant_account_service.dart",
    reason: "one ordered field uses its automatic single-field index",
  },
  {
    id: "rating.reviews-created-at",
    phase: "P2",
    source: "lib/services/bitescore_service.dart",
    reason: "one ordered field uses its automatic single-field index",
  },
  {
    id: "maintenance.identity-and-document-id-lookups",
    phase: "LATER",
    source: "functions/src/search_index_maintenance.ts",
    reason: "equality filters plus document ID use automatic indexes",
  },
  {
    id: "destructive.admin-status-page",
    phase: "P2",
    source: "functions/src/rating_destructive_status_paging.ts",
    reason: "one ordered field uses its automatic single-field index",
  },
];

const REQUIRED_FIELD_OVERRIDE_CONTRACT = [
  {
    collectionGroup: "bitesaver_offer_index",
    fieldPath: "searchMatchValues",
    indexes: [],
  },
  ...[
    "private_search_index_jobs",
    "private_bitesaver_search_active_sessions",
    "private_bitesaver_guest_offer_checks",
    "private_bitesaver_search_candidates",
    "private_bitesaver_search_jobs",
    "private_bitesaver_search_results",
    "private_bitesaver_search_sessions",
  ].map((collectionGroup) => ({
    collectionGroup,
    fieldPath: "expiresAt",
    ttl: true,
    indexes: [],
  })),
  {
    collectionGroup: "private_bitesaver_device_challenges",
    fieldPath: "deleteAfter",
    ttl: true,
    indexes: [],
  },
  ...[
    "private_bitescore_search_sessions",
    "private_bitescore_search_results",
    "private_bitescore_search_admission",
    "private_bitescore_suggestion_sessions",
    "private_bitescore_suggestion_admission",
  ].map((collectionGroup) => ({
    collectionGroup,
    fieldPath: "expiresAt",
    ttl: true,
    indexes: [],
  })),
];

const loadIndexConfiguration = () =>
  JSON.parse(fs.readFileSync(indexPath, "utf8"));

const indexSignature = (index) =>
  `${index.collectionGroup}|${index.queryScope}|${index.fields
    .map(
      (field) =>
        `${field.fieldPath}:${field.order ?? field.arrayConfig}`,
    )
    .join(",")}`;

test("Firestore composite indexes exactly match the current production query contract", () => {
  const configuration = loadIndexConfiguration();
  const expectedIndexes = REQUIRED_INDEX_CONTRACT.map(
    ({ collectionGroup, queryScope, fields }) => ({
      collectionGroup,
      queryScope,
      fields,
    }),
  );

  assert.deepEqual(Object.keys(configuration).sort(), [
    "fieldOverrides",
    "indexes",
  ]);
  assert.deepEqual(
    configuration.fieldOverrides,
    REQUIRED_FIELD_OVERRIDE_CONTRACT,
  );
  assert.deepEqual(configuration.indexes, expectedIndexes);
});

test("Firestore composite index contract is unique, scoped, and structurally valid", () => {
  const configuration = loadIndexConfiguration();
  const signatures = configuration.indexes.map(indexSignature);
  const contractIds = REQUIRED_INDEX_CONTRACT.map(({ id }) => id);

  assert.equal(new Set(signatures).size, signatures.length);
  assert.equal(new Set(contractIds).size, contractIds.length);
  assert.equal(configuration.indexes.length, 101);
  assert.equal(
    REQUIRED_INDEX_CONTRACT.filter(({ phase }) => phase === "LEGACY").length,
    2,
  );
  assert.equal(
    REQUIRED_INDEX_CONTRACT.filter(({ phase }) => phase === "P2").length,
    61,
  );
  assert.equal(
    REQUIRED_INDEX_CONTRACT.filter(({ phase }) => phase === "LATER").length,
    5,
  );
  assert.equal(
    REQUIRED_INDEX_CONTRACT.filter(
      ({ phase }) => phase === "BITESAVER_STAGE_1",
    ).length,
    4,
  );
  assert.equal(REQUIRED_INDEX_CONTRACT.filter(({phase}) => phase === "BITESCORE_STAGE_1").length, 24);
  assert.equal(REQUIRED_INDEX_CONTRACT.filter(({phase}) => phase === "BITESCORE_STAGE_2").length, 5);

  for (const index of configuration.indexes) {
    assert.deepEqual(Object.keys(index).sort(), [
      "collectionGroup",
      "fields",
      "queryScope",
    ]);
    assert.equal(index.queryScope, "COLLECTION");
    assert.ok(index.fields.length >= 2);
    assert.ok(index.fields.length <= 10);

    for (const [position, field] of index.fields.entries()) {
      if (field.fieldPath === "__name__") {
        assert.equal(position, index.fields.length - 1, "document identity is the final order field");
        assert.equal(field.order, "ASCENDING");
        assert.ok(["BITESCORE_STAGE_1", "BITESCORE_STAGE_2"].includes(
          REQUIRED_INDEX_CONTRACT.find((contract) => indexSignature(contract) === indexSignature(index))?.phase),
        "only the explicit BiteScore contracts introduce document-ID ordering");
      }
      assert.equal(
        Number(Object.hasOwn(field, "order")) +
          Number(Object.hasOwn(field, "arrayConfig")),
        1,
      );
      if (Object.hasOwn(field, "order")) {
        assert.ok(["ASCENDING", "DESCENDING"].includes(field.order));
      } else {
        assert.equal(field.arrayConfig, "CONTAINS");
      }
    }
  }
});

test("every explicit and automatic query contract points to current source", () => {
  for (const contract of REQUIRED_INDEX_CONTRACT) {
    assert.ok(
      ["LEGACY", "P2", "LATER", "BITESAVER_STAGE_1", "BITESCORE_STAGE_1", "BITESCORE_STAGE_2"].includes(
        contract.phase,
      ),
    );
    if (contract.phase !== "LEGACY") {
      assert.ok(contract.sources.length > 0);
    }
    for (const source of contract.sources) {
      assert.equal(fs.existsSync(path.join(repositoryRoot, source)), true, source);
    }
  }

  for (const contract of AUTOMATIC_INDEX_CONTRACT) {
    assert.ok(["P1", "P2", "LATER", "BITESCORE_STAGE_2"].includes(contract.phase));
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, contract.source)),
      true,
      contract.source,
    );
    assert.match(contract.reason, /automatic|index merging/);
  }
});

test("Firestore TTL and single-field exemptions exactly match the BiteSaver and BiteScore contracts", () => {
  const { fieldOverrides } = loadIndexConfiguration();
  const firebaseConfiguration = JSON.parse(
    fs.readFileSync(firebasePath, "utf8"),
  );
  const signatures = fieldOverrides.map(
    ({ collectionGroup, fieldPath }) => `${collectionGroup}|${fieldPath}`,
  );

  assert.equal(firebaseConfiguration.firestore.indexes, "firestore.indexes.json");
  assert.equal(firebaseConfiguration.firestore.rules, "firestore.rules");
  assert.equal(fieldOverrides.length, 14);
  assert.equal(new Set(signatures).size, fieldOverrides.length);
  assert.equal(fieldOverrides.filter(({ ttl }) => ttl === true).length, 13);

  for (const override of fieldOverrides) {
    assert.deepEqual(override.indexes, []);
    if (override.fieldPath === "expiresAt") {
      assert.deepEqual(Object.keys(override).sort(), [
        "collectionGroup",
        "fieldPath",
        "indexes",
        "ttl",
      ]);
      assert.equal(override.ttl, true);
      assert.ok([
        "private_search_index_jobs",
        "private_bitesaver_search_active_sessions",
        "private_bitesaver_guest_offer_checks",
        "private_bitesaver_search_candidates",
        "private_bitesaver_search_jobs",
        "private_bitesaver_search_results",
        "private_bitesaver_search_sessions",
        "private_bitescore_search_sessions",
        "private_bitescore_search_results",
        "private_bitescore_search_admission",
        "private_bitescore_suggestion_sessions",
        "private_bitescore_suggestion_admission",
      ].includes(override.collectionGroup));
    } else if (override.fieldPath === "deleteAfter") {
      assert.deepEqual(Object.keys(override).sort(), [
        "collectionGroup",
        "fieldPath",
        "indexes",
        "ttl",
      ]);
      assert.equal(override.collectionGroup,
        "private_bitesaver_device_challenges");
      assert.equal(override.ttl, true);
    } else {
      assert.deepEqual(Object.keys(override).sort(), [
        "collectionGroup",
        "fieldPath",
        "indexes",
      ]);
      assert.equal(override.collectionGroup, "bitesaver_offer_index");
      assert.equal(override.fieldPath, "searchMatchValues");
      assert.equal(Object.hasOwn(override, "ttl"), false);
    }
  }
});

test("legacy public restaurant projection remains an automatic-index query", () => {
  const configuration = loadIndexConfiguration();
  const restaurantIndexes = configuration.indexes.filter(
    ({ collectionGroup }) => collectionGroup === "restaurant_search_index",
  );

  for (const index of restaurantIndexes) {
    assert.equal(
      index.fields.some(({ fieldPath }) => fieldPath === "entityType"),
      false,
    );
  }
});
