import {
  buildWordPrefixTokens,
  normalizeSearchName,
} from "./search_normalization.js";
import {
  adminUserClaimedRestaurantVersion,
  adminUserDirectoryVersion,
  adminUserSourceKinds,
  adminUserSourceSummaryVersion,
  createAdminUserFingerprint,
  requireAdminUserDocumentSize,
  type AdminUserClaimedRestaurantDocument,
  type AdminUserDirectoryDocument,
  type AdminUserSourceData,
  type AdminUserSourceKind,
  type AdminUserSourceSummary,
  type AdminUserStoredDocument,
} from "./admin_user_directory_contract.js";

const betaAdminEmails = new Set(["schuyler.cole@gmail.com"]);
const maximumIdentityTextLength = 320;
const maximumStatusLength = 64;

function readString(value: unknown, maximum = maximumIdentityTextLength): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || Array.from(trimmed).length > maximum) {
    return null;
  }
  return trimmed;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readAdminUserDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as {toDate?: unknown}).toDate === "function"
  ) {
    const converted = (value as {toDate(): unknown}).toDate();
    return converted instanceof Date && Number.isFinite(converted.getTime())
      ? new Date(converted.getTime())
      : null;
  }
  return null;
}

function dateFingerprint(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString();
}

function latestDate(values: Iterable<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (value !== null && value !== undefined && (latest === null || value > latest)) {
      latest = value;
    }
  }
  return latest === null ? null : new Date(latest.getTime());
}

function earliestDate(values: Iterable<Date | null | undefined>): Date | null {
  let earliest: Date | null = null;
  for (const value of values) {
    if (
      value !== null &&
      value !== undefined &&
      (earliest === null || value < earliest)
    ) {
      earliest = value;
    }
  }
  return earliest === null ? null : new Date(earliest.getTime());
}

function firstString(data: AdminUserSourceData, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = readString(data[field]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

export function normalizeAdminUserEmail(value: unknown): string | null {
  const email = readString(value)?.toLowerCase() ?? null;
  if (
    email === null ||
    !/^[^\s@]+@[^\s@]+$/u.test(email) ||
    email.startsWith("@") ||
    email.endsWith("@")
  ) {
    return null;
  }
  return email;
}

export function normalizeAdminUserPhone(value: unknown): string | null {
  const phone = readString(value, 64);
  if (phone === null) {
    return null;
  }
  const digits = phone.replace(/\D/gu, "");
  if (digits.length < 7 || digits.length > 15) {
    return null;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (phone.startsWith("+") && digits.length >= 8) {
    return `+${digits}`;
  }
  return digits;
}

export function effectiveAdminUserSourceUid(
  sourceKind: AdminUserSourceKind,
  sourceDocumentId: string,
  data: AdminUserSourceData | null,
): string | null {
  if (data === null) {
    return null;
  }
  switch (sourceKind) {
    case "restaurantAccount":
      return readString(data.uid) ?? readString(sourceDocumentId);
    case "userProfile":
    case "publicReviewerProfile":
      return readString(data.userId) ?? readString(sourceDocumentId);
    case "biteScoreRestaurant":
      return readString(data.ownerUserId);
    case "restaurantClaimRequest":
      return readString(data.requesterUserId);
    case "dishReview":
    case "reviewFeedbackVote":
      return readString(data.userId);
    case "reviewReport":
    case "restaurantReport":
    case "dishReport":
    case "duplicateRestaurantReport":
      return readString(data.reportingUserId);
    case "dishEditProposal":
      return readString(data.userId) ?? readString(data.createdByUserId);
  }
}

function hasLocation(data: AdminUserSourceData): boolean {
  const location = data.location;
  if (typeof location === "object" && location !== null) {
    const latitude = readNumber((location as {latitude?: unknown}).latitude);
    const longitude = readNumber((location as {longitude?: unknown}).longitude);
    if (latitude !== null && longitude !== null) {
      return true;
    }
  }
  return readNumber(data.latitude) !== null && readNumber(data.longitude) !== null;
}

function parseUsAddress(value: string): {
  city: string | null;
  state: string | null;
  zipCode: string | null;
} {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return {city: null, state: null, zipCode: null};
  }
  const normalizedParts = [...parts];
  const trailingPart = normalizedParts[normalizedParts.length - 1];
  if (
    ["USA", "US", "UNITED STATES", "UNITED STATES OF AMERICA"]
      .includes(trailingPart.toUpperCase())
  ) {
    normalizedParts.pop();
  }
  if (normalizedParts.length === 0) {
    return {city: null, state: null, zipCode: null};
  }
  const stateZip = /^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/u.exec(
    normalizedParts[normalizedParts.length - 1],
  );
  if (stateZip !== null) {
    return {
      city: normalizedParts.length >= 2
        ? normalizedParts[normalizedParts.length - 2]
        : null,
      state: stateZip[1],
      zipCode: stateZip[2],
    };
  }
  if (normalizedParts.length >= 2) {
    const cityStateZip = /^(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/u.exec(
      normalizedParts[normalizedParts.length - 1],
    );
    if (cityStateZip !== null) {
      return {
        city: cityStateZip[1].trim(),
        state: cityStateZip[2],
        zipCode: cityStateZip[3],
      };
    }
  }
  return {
    city: null,
    state: null,
    zipCode: /(\d{5}(?:-\d{4})?)/u.exec(value)?.[1] ?? null,
  };
}

function isInvalidFinderCity(
  value: string | null,
  state: string | null,
  zipCode: string,
): boolean {
  if (value === null) {
    return true;
  }
  const upper = value.toUpperCase();
  return ["USA", "US", "UNITED STATES", "UNITED STATES OF AMERICA"]
    .includes(upper) ||
    /^\d{5}(?:-\d{4})?$/u.test(value) ||
    /^[A-Z]{2}\s+\d{5}(?:-\d{4})?$/u.test(upper) ||
    (state !== null && upper === state.toUpperCase()) ||
    (zipCode !== "" && value === zipCode);
}

function isValidFinderRestaurant(data: AdminUserSourceData): boolean {
  if (firstString(data, ["name", "restaurantName", "restaurant_name"]) === null) {
    return false;
  }
  const address = firstString(data, [
    "address",
    "streetAddress",
    "formattedAddress",
    "fullAddress",
  ]) ?? "";
  const inferred = parseUsAddress(address);
  const explicitState = firstString(data, [
    "state",
    "stateCode",
    "state_name",
    "region",
    "province",
  ]);
  const explicitZip = firstString(data, [
    "zip",
    "zipCode",
    "zip_code",
    "postalCode",
    "postcode",
  ]);
  const state = explicitState ?? inferred.state;
  const zipCode = /(\d{5}(?:-\d{4})?)/u.exec(
    explicitZip ?? inferred.zipCode ?? "",
  )?.[1] ?? "";
  let city = firstString(data, ["city", "locality", "municipality", "town"]);
  if (city?.includes(",")) {
    city = parseUsAddress(city).city ?? city;
  }
  if (isInvalidFinderCity(city, state, zipCode)) {
    city = inferred.city;
  }
  return !isInvalidFinderCity(city, state, zipCode);
}

function isValidStrictBiteScoreRestaurant(data: AdminUserSourceData): boolean {
  return readString(data.name) !== null &&
    firstString(data, ["address", "streetAddress"]) !== null &&
    readString(data.city) !== null &&
    firstString(data, ["zip", "zipCode"]) !== null &&
    hasLocation(data);
}

function isValidBiteScoreRestaurant(data: AdminUserSourceData): boolean {
  return isValidStrictBiteScoreRestaurant(data) ||
    isValidFinderRestaurant(data);
}

function deriveCompatibleBiteScoreRestaurantActiveState(
  data: AdminUserSourceData,
): boolean | null {
  if (isValidStrictBiteScoreRestaurant(data)) {
    return typeof data.isActive === "boolean" ? data.isActive : true;
  }
  if (!isValidFinderRestaurant(data)) {
    return null;
  }
  if (typeof data.isActive === "boolean") {
    return data.isActive;
  }
  return typeof data.active === "boolean" ? data.active : true;
}

export function isValidAdminUserSourceDocument(
  sourceKind: AdminUserSourceKind,
  data: AdminUserSourceData,
): boolean {
  switch (sourceKind) {
    case "restaurantAccount":
    case "userProfile":
    case "publicReviewerProfile":
      return true;
    case "biteScoreRestaurant":
      return isValidBiteScoreRestaurant(data);
    case "restaurantClaimRequest":
      return firstString(data, ["restaurantId"]) !== null &&
        firstString(data, ["restaurantName"]) !== null &&
        firstString(data, ["claimantName"]) !== null &&
        firstString(data, ["email"]) !== null &&
        firstString(data, ["phone"]) !== null &&
        firstString(data, ["status"]) !== null;
    case "dishReview": {
      const directScore = readNumber(data.overallImpression) ??
        readNumber(data.qualityScore) ??
        readNumber(data.tastinessScore) ??
        readNumber(data.tasteScore);
      const overallBiteScore = readNumber(data.overallBiteScore) ?? 0;
      return firstString(data, ["dishId"]) !== null &&
        firstString(data, ["restaurantId"]) !== null &&
        (directScore !== null || overallBiteScore > 0);
    }
    case "reviewReport":
      return ["reviewId", "dishId", "restaurantId", "status"]
        .every((field) => readString(data[field]) !== null);
    case "restaurantReport":
    case "duplicateRestaurantReport":
      return ["restaurantId", "restaurantName", "status"]
        .every((field) => readString(data[field]) !== null);
    case "dishReport":
      return ["dishId", "dishName", "restaurantId", "status"]
        .every((field) => readString(data[field]) !== null);
    case "dishEditProposal": {
      const type = firstString(data, ["type", "targetType"]);
      const targetDishId = firstString(data, [
        "sourceDishId",
        "targetDishId",
        "targetId",
      ]);
      return type !== null &&
        firstString(data, ["restaurantId"]) !== null &&
        targetDishId !== null;
    }
    case "reviewFeedbackVote": {
      const voteType = readString(data.voteType);
      return ["reviewId", "dishId", "restaurantId"]
        .every((field) => readString(data[field]) !== null) &&
        (voteType === "helpful" || voteType === "not_helpful");
    }
  }
}

function sourceDates(data: AdminUserSourceData): {
  createdAt: Date | null;
  updatedAt: Date | null;
} {
  return {
    createdAt: readAdminUserDate(data.createdAt),
    updatedAt: readAdminUserDate(data.updatedAt),
  };
}

function normalizedIdentity(value: string | null): {
  display: string | null;
  normalized: string | null;
} {
  return {
    display: value,
    normalized: value === null ? null : normalizeAdminUserEmail(value),
  };
}

export function buildAdminUserSourceSummary(value: {
  uid: string;
  sourceKind: AdminUserSourceKind;
  representative: AdminUserStoredDocument | null;
  latestActivityAt?: Date | null;
  now: Date;
}): AdminUserSourceSummary | null {
  const uid = readString(value.uid);
  const representative = value.representative;
  if (
    uid === null ||
    representative === null ||
    effectiveAdminUserSourceUid(
      value.sourceKind,
      representative.id,
      representative.data,
    ) !== uid ||
    !isValidAdminUserSourceDocument(value.sourceKind, representative.data)
  ) {
    return null;
  }

  const data = representative.data;
  const dates = sourceDates(data);
  const latestActivityAt = latestDate([
    value.latestActivityAt,
    dates.updatedAt,
    dates.createdAt,
    value.sourceKind === "userProfile"
      ? readAdminUserDate(data.lastContributionAt)
      : null,
  ]);
  const contribution: Record<string, unknown> = {};

  switch (value.sourceKind) {
    case "restaurantAccount": {
      const displayName = firstString(data, ["restaurantName", "name"]);
      const email = normalizedIdentity(readString(data.email));
      const displayPhone = firstString(data, ["phoneNumber", "phone"]);
      Object.assign(contribution, {
        ...(displayName === null ? {} : {displayName}),
        ...(email.display === null ? {} : {displayEmail: email.display}),
        ...(email.normalized === null ? {} : {normalizedEmail: email.normalized}),
        ...(displayPhone === null ? {} : {displayPhone}),
        ...(normalizeAdminUserPhone(displayPhone) === null
          ? {}
          : {normalizedPhone: normalizeAdminUserPhone(displayPhone)}),
        couponAccountStatus: readString(data.approvalStatus, maximumStatusLength) ?? "none",
        emailVerified: data.emailVerified === true,
        hasCouponAccount: true,
      });
      break;
    }
    case "userProfile": {
      const displayName = readString(data.displayName, 100);
      const email = normalizedIdentity(readString(data.email));
      const displayPhone = readString(data.phoneNumber, 64);
      const points = readNumber(data.contributionPoints);
      const lastContributionAt = readAdminUserDate(data.lastContributionAt);
      Object.assign(contribution, {
        ...(displayName === null
          ? {}
          : {displayName, userPointsDisplayName: displayName}),
        ...(email.display === null ? {} : {displayEmail: email.display}),
        ...(email.normalized === null ? {} : {normalizedEmail: email.normalized}),
        ...(displayPhone === null ? {} : {displayPhone}),
        ...(normalizeAdminUserPhone(displayPhone) === null
          ? {}
          : {normalizedPhone: normalizeAdminUserPhone(displayPhone)}),
        contributionPoints: points === null ? 0 : Math.trunc(points),
        ...(lastContributionAt === null ? {} : {lastContributionAt}),
        hasProfileActivity: true,
      });
      break;
    }
    case "publicReviewerProfile": {
      const displayName = readString(data.publicDisplayName, 100);
      const userPointsDisplayName = firstString(data, [
        "publicDisplayName",
        "chosenUsername",
        "fallbackUsername",
      ]);
      const displayPhone = readString(data.phoneNumber, 64);
      Object.assign(contribution, {
        ...(displayName === null ? {} : {displayName}),
        ...(userPointsDisplayName === null ? {} : {userPointsDisplayName}),
        ...(displayPhone === null ? {} : {displayPhone}),
        ...(normalizeAdminUserPhone(displayPhone) === null
          ? {}
          : {normalizedPhone: normalizeAdminUserPhone(displayPhone)}),
        hasProfileActivity: true,
      });
      break;
    }
    case "biteScoreRestaurant":
      Object.assign(contribution, {hasBiteScoreOwnership: true});
      break;
    case "restaurantClaimRequest": {
      const displayName = readString(data.claimantName, 100);
      const email = normalizedIdentity(readString(data.email));
      const displayPhone = readString(data.phone, 64);
      Object.assign(contribution, {
        ...(displayName === null ? {} : {displayName}),
        ...(email.display === null ? {} : {displayEmail: email.display}),
        ...(email.normalized === null ? {} : {normalizedEmail: email.normalized}),
        ...(displayPhone === null ? {} : {displayPhone}),
        ...(normalizeAdminUserPhone(displayPhone) === null
          ? {}
          : {normalizedPhone: normalizeAdminUserPhone(displayPhone)}),
        hasClaimActivity: true,
      });
      break;
    }
    case "dishReview":
      Object.assign(contribution, {hasReviewActivity: true});
      break;
    case "reviewReport":
    case "restaurantReport":
    case "dishReport":
    case "duplicateRestaurantReport":
      Object.assign(contribution, {hasReportActivity: true});
      break;
    case "dishEditProposal":
      Object.assign(contribution, {hasDishSuggestionActivity: true});
      break;
    case "reviewFeedbackVote":
      Object.assign(contribution, {hasReviewFeedbackVoteActivity: true});
      break;
  }

  const fingerprint = createAdminUserFingerprint(
    adminUserSourceSummaryVersion,
    [
      uid,
      value.sourceKind,
      representative.id,
      contribution,
      dateFingerprint(dates.createdAt),
      dateFingerprint(dates.updatedAt),
      dateFingerprint(latestActivityAt),
    ],
  );
  const summary = Object.freeze({
    sourceSummaryVersion: adminUserSourceSummaryVersion,
    uid,
    sourceKind: value.sourceKind,
    present: true as const,
    ...contribution,
    ...(latestActivityAt === null ? {} : {latestActivityAt}),
    ...(dates.createdAt === null ? {} : {sourceCreatedAt: dates.createdAt}),
    ...(dates.updatedAt === null ? {} : {sourceUpdatedAt: dates.updatedAt}),
    sourceFingerprint: fingerprint,
    indexedAt: new Date(value.now.getTime()),
  }) as AdminUserSourceSummary;
  return requireAdminUserDocumentSize(summary);
}

function summaryByKind(
  summaries: readonly AdminUserSourceSummary[],
): Map<AdminUserSourceKind, AdminUserSourceSummary> {
  const byKind = new Map<AdminUserSourceKind, AdminUserSourceSummary>();
  for (const summary of summaries) {
    if (
      summary.sourceSummaryVersion === adminUserSourceSummaryVersion &&
      summary.present === true
    ) {
      byKind.set(summary.sourceKind, summary);
    }
  }
  return byKind;
}

function lastDefined(values: readonly (string | undefined)[]): string | null {
  let result: string | null = null;
  for (const value of values) {
    if (value !== undefined && value.trim()) {
      result = value.trim();
    }
  }
  return result;
}

function normalizedNameFields(displayName: string): {
  normalized: string;
  tokens: readonly string[];
} {
  try {
    return {
      normalized: normalizeSearchName(displayName),
      tokens: buildWordPrefixTokens(displayName),
    };
  } catch (_) {
    return {normalized: "", tokens: Object.freeze([])};
  }
}

export function buildAdminUserDirectoryDocument(value: {
  uid: string;
  summaries: readonly AdminUserSourceSummary[];
  now: Date;
}): AdminUserDirectoryDocument | null {
  const uid = readString(value.uid);
  if (uid === null) {
    return null;
  }
  const summaries = value.summaries.filter((summary) => summary.uid === uid);
  if (summaries.length === 0) {
    return null;
  }
  const byKind = summaryByKind(summaries);
  const account = byKind.get("restaurantAccount");
  const profile = byKind.get("userProfile");
  const publicProfile = byKind.get("publicReviewerProfile");
  const claim = byKind.get("restaurantClaimRequest");

  const displayName = lastDefined([
    account?.displayName,
    profile?.displayName,
    publicProfile?.displayName,
    claim?.displayName,
  ]) ?? uid;
  const displayNameFields = normalizedNameFields(displayName);
  const userPointsDisplayName =
    publicProfile?.userPointsDisplayName ??
    profile?.userPointsDisplayName ??
    uid;
  const userPointsNameFields = normalizedNameFields(userPointsDisplayName);
  const displayEmail = lastDefined([
    account?.displayEmail,
    profile?.displayEmail,
    claim?.displayEmail,
  ]);
  const normalizedEmail = normalizeAdminUserEmail(displayEmail);
  const displayPhone = lastDefined([
    account?.displayPhone,
    profile?.displayPhone,
    publicProfile?.displayPhone,
    claim?.displayPhone,
  ]);
  const normalizedPhone = normalizeAdminUserPhone(displayPhone);
  const contributionPoints = profile?.contributionPoints ?? 0;
  const lastContributionAt = profile?.lastContributionAt ?? null;
  const activityProfile = summaries.some((summary) => summary.hasProfileActivity === true);
  const activityClaims = summaries.some((summary) => summary.hasClaimActivity === true);
  const activityReviews = summaries.some((summary) => summary.hasReviewActivity === true);
  const activityReports = summaries.some((summary) => summary.hasReportActivity === true);
  const activityDishSuggestions = summaries.some(
    (summary) => summary.hasDishSuggestionActivity === true,
  );
  const activityReviewVotes = summaries.some(
    (summary) => summary.hasReviewFeedbackVoteActivity === true,
  );
  const roleCouponOwner = account?.hasCouponAccount === true;
  const roleBiteScoreOwner = summaries.some(
    (summary) => summary.hasBiteScoreOwnership === true,
  );
  const activityContributionPoints =
    contributionPoints !== 0 || lastContributionAt !== null;
  const sourceKinds = adminUserSourceKinds.filter((kind) => byKind.has(kind));
  const latestActivityAt = latestDate(
    summaries.map((summary) => summary.latestActivityAt),
  );
  const sourceCreatedAt = earliestDate(
    summaries.map((summary) => summary.sourceCreatedAt),
  );
  const sourceUpdatedAt = latestDate(
    summaries.map((summary) => summary.sourceUpdatedAt),
  );
  const content = {
    uid,
    displayName,
    normalizedDisplayName: displayNameFields.normalized,
    displayNamePrefixTokens: displayNameFields.tokens,
    userPointsDisplayName,
    normalizedUserPointsDisplayName: userPointsNameFields.normalized,
    displayEmail,
    normalizedEmail,
    displayPhone,
    normalizedPhone,
    contributionPoints,
    lastContributionAt,
    latestActivityAt,
    sourceCreatedAt,
    sourceUpdatedAt,
    couponAccountStatus: account?.couponAccountStatus ?? "none",
    emailVerified: account?.emailVerified === true,
    roleAdmin: normalizedEmail !== null && betaAdminEmails.has(normalizedEmail),
    roleCouponOwner,
    roleBiteScoreOwner,
    roleClaimant: activityClaims,
    roleCustomer: activityReviews || activityReports,
    activityProfile,
    activityClaims,
    activityReviews,
    activityReports,
    activityDishSuggestions,
    activityReviewVotes,
    activityContributionPoints,
    claimedRestaurantOwner: roleBiteScoreOwner,
    includedInUserPointsDirectory: activityContributionPoints,
    sourceKinds,
  };
  const sourceFingerprint = createAdminUserFingerprint(
    adminUserDirectoryVersion,
    [
      ...Object.entries(content).map(([key, entry]) => [
        key,
        entry instanceof Date ? entry.toISOString() : entry,
      ]),
      summaries.map((summary) => [summary.sourceKind, summary.sourceFingerprint]),
    ],
  );
  const document = Object.freeze({
    directoryVersion: adminUserDirectoryVersion,
    ...content,
    sourceFingerprint,
    indexedAt: new Date(value.now.getTime()),
  }) as AdminUserDirectoryDocument;
  return requireAdminUserDocumentSize(document);
}

export function buildAdminUserClaimedRestaurantDocument(value: {
  sourceRestaurantId: string;
  source: AdminUserSourceData | null;
  now: Date;
}): AdminUserClaimedRestaurantDocument | null {
  const sourceRestaurantId = readString(value.sourceRestaurantId);
  const source = value.source;
  const isActive = source === null
    ? null
    : deriveCompatibleBiteScoreRestaurantActiveState(source);
  if (
    sourceRestaurantId === null ||
    source === null ||
    isActive === null
  ) {
    return null;
  }
  const ownerUid = readString(source.ownerUserId);
  const displayRestaurantName = firstString(source, [
    "name",
    "restaurantName",
    "restaurant_name",
  ]);
  if (ownerUid === null || displayRestaurantName === null) {
    return null;
  }
  let normalizedRestaurantName: string;
  let restaurantNamePrefixTokens: readonly string[];
  try {
    normalizedRestaurantName = normalizeSearchName(displayRestaurantName);
    restaurantNamePrefixTokens = buildWordPrefixTokens(displayRestaurantName);
  } catch (_) {
    return null;
  }
  const content = {
    sourceRestaurantId,
    ownerUid,
    displayRestaurantName,
    normalizedRestaurantName,
    restaurantNamePrefixTokens,
    isClaimed: source.isClaimed === true,
    isActive,
  };
  const sourceFingerprint = createAdminUserFingerprint(
    adminUserClaimedRestaurantVersion,
    Object.entries(content),
  );
  const document = Object.freeze({
    claimedRestaurantVersion: adminUserClaimedRestaurantVersion,
    ...content,
    sourceFingerprint,
    indexedAt: new Date(value.now.getTime()),
  }) as AdminUserClaimedRestaurantDocument;
  return requireAdminUserDocumentSize(document);
}
