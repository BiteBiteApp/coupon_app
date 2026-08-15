"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");
const indexPath = path.join(repositoryRoot, "firestore.indexes.json");

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
];

const AUTOMATIC_INDEX_CONTRACT = [
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
  assert.deepEqual(configuration.fieldOverrides, []);
  assert.deepEqual(configuration.indexes, expectedIndexes);
});

test("Firestore composite index contract is unique, scoped, and structurally valid", () => {
  const configuration = loadIndexConfiguration();
  const signatures = configuration.indexes.map(indexSignature);
  const contractIds = REQUIRED_INDEX_CONTRACT.map(({ id }) => id);

  assert.equal(new Set(signatures).size, signatures.length);
  assert.equal(new Set(contractIds).size, contractIds.length);
  assert.equal(configuration.indexes.length, 67);
  assert.equal(
    REQUIRED_INDEX_CONTRACT.filter(({ phase }) => phase === "LEGACY").length,
    2,
  );
  assert.equal(
    REQUIRED_INDEX_CONTRACT.filter(({ phase }) => phase === "P2").length,
    60,
  );
  assert.equal(
    REQUIRED_INDEX_CONTRACT.filter(({ phase }) => phase === "LATER").length,
    5,
  );

  for (const index of configuration.indexes) {
    assert.deepEqual(Object.keys(index).sort(), [
      "collectionGroup",
      "fields",
      "queryScope",
    ]);
    assert.equal(index.queryScope, "COLLECTION");
    assert.ok(index.fields.length >= 2);

    for (const field of index.fields) {
      assert.notEqual(field.fieldPath, "__name__");
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
    assert.ok(["LEGACY", "P2", "LATER"].includes(contract.phase));
    if (contract.phase !== "LEGACY") {
      assert.ok(contract.sources.length > 0);
    }
    for (const source of contract.sources) {
      assert.equal(fs.existsSync(path.join(repositoryRoot, source)), true, source);
    }
  }

  for (const contract of AUTOMATIC_INDEX_CONTRACT) {
    assert.ok(["P1", "P2", "LATER"].includes(contract.phase));
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, contract.source)),
      true,
      contract.source,
    );
    assert.match(contract.reason, /automatic|index merging/);
  }
});

test("public restaurant projection remains an automatic-index query", () => {
  const configuration = loadIndexConfiguration();
  const explicitFieldPaths = new Set(
    configuration.indexes.flatMap(({ fields }) =>
      fields.map(({ fieldPath }) => fieldPath),
    ),
  );

  for (const fieldPath of [
    "entityType",
    "publicProjectionVersion",
    "publicVisible",
  ]) {
    assert.equal(explicitFieldPaths.has(fieldPath), false);
  }
});
