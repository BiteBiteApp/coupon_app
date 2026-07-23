import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import {
  requireAuthenticatedRestaurantAccountActor,
  requireRestaurantAccountAdminAccess,
  type RestaurantAccountActorContext,
} from "./admin_authorization.js";
import {
  createRestaurantAddressFingerprint,
  normalizeStructuredUsRestaurantAddress,
  RestaurantGeocodingError,
  type StrictRestaurantGeocodingResult,
  type StructuredUsRestaurantAddress,
} from "./restaurant_geocoding.js";
import { validRestaurantCoordinates } from "./restaurant_geo_helpers.js";

export const biteSaverLocationSource = "google_geocoding";

const allowedRequestKeys = new Set([
  "intent",
  "documentId",
  "requestId",
  "expectedProfileVersion",
  "profile",
]);
const allowedProfileKeys = new Set([
  "restaurantName",
  "streetAddress",
  "city",
  "state",
  "zipCode",
  "phone",
  "website",
  "bio",
  "mainImageUrl",
  "businessHours",
]);
const allowedReviewRequestKeys = new Set([
  "documentId",
  "decision",
  "expectedProfileVersion",
]);
const profileIntents = new Set([
  "submitApplication",
  "ownerUpdate",
  "adminUpdate",
]);
const reviewDecisions = new Set(["approve", "reject"]);
const controlledApprovalStatuses = new Set([
  "pending",
  "approved",
  "rejected",
]);
const unsupportedControlCharacterPattern = /[\p{Cc}\p{Cf}]/u;
const unsupportedMultilineCharacterPattern =
  /[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const safeRequestIdPattern = /^[\p{L}\p{N}._:@+-]+$/u;
const lowercaseSha256FingerprintPattern = /^[0-9a-f]{64}$/;
const profileRequestFingerprintDomain =
  "bitesaver-restaurant-profile-request";
const profileRequestFingerprintVersion = "v1";

const maximumRestaurantNameLength = 120;
const maximumPhoneLength = 50;
const maximumWebsiteLength = 500;
const maximumBioLength = 2_000;
const maximumMainImageUrlLength = 2_000;
const maximumBusinessHoursTimeLength = 40;
const maximumRequestIdLength = 128;
const maximumDocumentIdLength = 256;
const businessDayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const businessDayNameSet = new Set<string>(businessDayNames);
const allowedBusinessHoursKeys = new Set([
  "day",
  "opensAt",
  "closesAt",
  "closed",
]);

export type BiteSaverProfileIntent =
  | "submitApplication"
  | "ownerUpdate"
  | "adminUpdate";

export type BiteSaverApplicationDecision = "approve" | "reject";

export type BiteSaverRestaurantProfile = StructuredUsRestaurantAddress & {
  restaurantName: string;
  phone: string;
  website: string | null;
  bio?: string | null;
  mainImageUrl?: string | null;
  businessHours?: BiteSaverBusinessHoursEntry[];
};

export type BiteSaverBusinessHoursEntry = {
  day: string;
  opensAt: string;
  closesAt: string;
  closed: boolean;
};

export type ValidatedBiteSaverProfileRequest = {
  intent: BiteSaverProfileIntent;
  documentId: string | null;
  requestId: string;
  expectedProfileVersion: number | null;
  profile: BiteSaverRestaurantProfile;
};

export type BiteSaverProfileRequestFingerprintInput = {
  actorUid: string;
  documentId: string;
  request: ValidatedBiteSaverProfileRequest;
};

export type ValidatedBiteSaverReviewRequest = {
  documentId: string;
  decision: BiteSaverApplicationDecision;
  expectedProfileVersion: number;
};

export type BiteSaverAccountSnapshot = {
  exists: boolean;
  data: Record<string, unknown>;
};

export type BiteSaverProfileResponse = {
  documentId: string;
  approvalStatus: string | null;
  profileVersion: number;
};

export type BiteSaverReviewResponse = {
  documentId: string;
  approvalStatus: "approved" | "rejected";
  profileVersion: number;
};

export type BiteSaverTransactionDecision<T> =
  | {
      operation: "none";
      response: T;
    }
  | {
      operation: "create" | "update";
      data: Record<string, unknown>;
      response: T;
    };

export type BiteSaverProfileDependencies = {
  getAccount: (documentId: string) => Promise<BiteSaverAccountSnapshot>;
  runAccountTransaction: <T>(
    documentId: string,
    evaluate: (
      latest: BiteSaverAccountSnapshot,
    ) => BiteSaverTransactionDecision<T>,
  ) => Promise<T>;
  geocodeAddress: (
    address: StructuredUsRestaurantAddress,
  ) => Promise<StrictRestaurantGeocodingResult>;
  serverTimestamp: () => unknown;
};

export type BiteSaverReviewDependencies = {
  runAccountTransaction: <T>(
    documentId: string,
    evaluate: (
      latest: BiteSaverAccountSnapshot,
    ) => BiteSaverTransactionDecision<T>,
  ) => Promise<T>;
  serverTimestamp: () => unknown;
};

type CallableLikeRequest = {
  auth?: unknown;
  data: unknown;
};

type TrustedLocation = {
  address: StructuredUsRestaurantAddress;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  addressFingerprint: string;
  locationValidatedAt: unknown;
  locationSource: string;
  locationVersion: number;
  locationValidationFingerprint: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function invalidArgument(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

function failedPrecondition(message: string): never {
  throw new HttpsError("failed-precondition", message);
}

function aborted(message: string): never {
  throw new HttpsError("aborted", message);
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    invalidArgument(`${label} contains unsupported fields.`);
  }
}

function normalizedText(
  value: unknown,
  params: {
    label: string;
    maximumLength: number;
    required: boolean;
  },
): string | null {
  if (typeof value !== "string") {
    invalidArgument(`${params.label} must be a string.`);
  }
  if (unsupportedControlCharacterPattern.test(value)) {
    invalidArgument(`${params.label} contains unsupported characters.`);
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized) {
    if (params.required) {
      invalidArgument(`${params.label} is required.`);
    }
    return null;
  }
  if (normalized.length > params.maximumLength) {
    invalidArgument(`${params.label} is too long.`);
  }
  return normalized;
}

function requiredText(
  value: unknown,
  params: { label: string; maximumLength: number },
): string {
  const normalized = normalizedText(value, {
    ...params,
    required: true,
  });
  if (normalized === null) {
    invalidArgument(`${params.label} is required.`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  params: { label: string; maximumLength: number },
): string | null {
  return normalizedText(value, {
    ...params,
    required: false,
  });
}

function optionalMultilineText(
  value: unknown,
  params: { label: string; maximumLength: number },
): string | null {
  if (typeof value !== "string") {
    invalidArgument(`${params.label} must be a string.`);
  }
  if (unsupportedMultilineCharacterPattern.test(value)) {
    invalidArgument(`${params.label} contains unsupported characters.`);
  }
  const normalized = value
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[^\S\n]+/gu, " "))
    .join("\n")
    .trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > params.maximumLength) {
    invalidArgument(`${params.label} is too long.`);
  }
  return normalized;
}

function normalizedDocumentId(value: unknown): string {
  const documentId = requiredText(value, {
    label: "Document ID",
    maximumLength: maximumDocumentIdLength,
  });
  if (documentId.includes("/")) {
    invalidArgument("Document ID is invalid.");
  }
  return documentId;
}

function normalizedRequestId(value: unknown): string {
  const requestId = requiredText(value, {
    label: "Request ID",
    maximumLength: maximumRequestIdLength,
  });
  if (!safeRequestIdPattern.test(requestId)) {
    invalidArgument("Request ID contains unsupported characters.");
  }
  return requestId;
}

function expectedVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalidArgument(`${label} must be a nonnegative integer.`);
  }
  return value as number;
}

function normalizedProfile(value: unknown): BiteSaverRestaurantProfile {
  if (!isRecord(value)) {
    invalidArgument("Profile must be an object.");
  }
  requireExactKeys(value, allowedProfileKeys, "Profile");

  for (const requiredKey of [
    "restaurantName",
    "streetAddress",
    "city",
    "state",
    "zipCode",
    "phone",
  ]) {
    if (!hasOwn(value, requiredKey)) {
      invalidArgument("Profile is missing required fields.");
    }
  }

  const restaurantName = requiredText(value.restaurantName, {
    label: "Restaurant name",
    maximumLength: maximumRestaurantNameLength,
  });
  const phone = requiredText(value.phone, {
    label: "Phone",
    maximumLength: maximumPhoneLength,
  });
  const website = hasOwn(value, "website")
    ? optionalText(value.website, {
        label: "Website",
        maximumLength: maximumWebsiteLength,
      })
    : null;
  const bio = hasOwn(value, "bio")
    ? optionalMultilineText(value.bio, {
        label: "Bio",
        maximumLength: maximumBioLength,
      })
    : undefined;
  const mainImageUrl = hasOwn(value, "mainImageUrl")
    ? optionalText(value.mainImageUrl, {
        label: "Main image URL",
        maximumLength: maximumMainImageUrlLength,
      })
    : undefined;
  const businessHours = hasOwn(value, "businessHours")
    ? normalizedBusinessHours(value.businessHours)
    : undefined;

  let address: StructuredUsRestaurantAddress;
  try {
    address = normalizeStructuredUsRestaurantAddress({
      streetAddress: value.streetAddress,
      city: value.city,
      state: value.state,
      zipCode: value.zipCode,
    });
  } catch (error) {
    if (error instanceof RestaurantGeocodingError) {
      throw new HttpsError("invalid-argument", error.message);
    }
    throw error;
  }

  return {
    restaurantName,
    ...address,
    phone,
    website,
    ...(bio === undefined ? {} : { bio }),
    ...(mainImageUrl === undefined ? {} : { mainImageUrl }),
    ...(businessHours === undefined ? {} : { businessHours }),
  };
}

function normalizedBusinessHours(value: unknown): BiteSaverBusinessHoursEntry[] {
  if (!Array.isArray(value)) {
    invalidArgument("Business hours must be a list.");
  }
  if (value.length !== 0 && value.length !== businessDayNames.length) {
    invalidArgument("Business hours must be empty or contain all seven days.");
  }

  const entries: BiteSaverBusinessHoursEntry[] = [];
  const seenDays = new Set<string>();
  for (const rawEntry of value) {
    if (!isRecord(rawEntry)) {
      invalidArgument("Each business-hours entry must be an object.");
    }
    requireExactKeys(
      rawEntry,
      allowedBusinessHoursKeys,
      "Business-hours entry",
    );
    for (const key of allowedBusinessHoursKeys) {
      if (!hasOwn(rawEntry, key)) {
        invalidArgument("Business-hours entry is missing required fields.");
      }
    }

    const day = requiredText(rawEntry.day, {
      label: "Business-hours day",
      maximumLength: 16,
    });
    const opensAt = requiredText(rawEntry.opensAt, {
      label: "Business-hours opening time",
      maximumLength: maximumBusinessHoursTimeLength,
    });
    const closesAt = requiredText(rawEntry.closesAt, {
      label: "Business-hours closing time",
      maximumLength: maximumBusinessHoursTimeLength,
    });
    if (!businessDayNameSet.has(day) || seenDays.has(day)) {
      invalidArgument("Business hours contain an invalid or duplicate day.");
    }
    if (typeof rawEntry.closed !== "boolean") {
      invalidArgument("Business-hours closed status must be a boolean.");
    }
    seenDays.add(day);
    entries.push({
      day,
      opensAt,
      closesAt,
      closed: rawEntry.closed,
    });
  }

  if (
    entries.length === businessDayNames.length &&
    businessDayNames.some((day) => !seenDays.has(day))
  ) {
    invalidArgument("Business hours must contain each day exactly once.");
  }

  return entries;
}

export function validateBiteSaverProfileRequest(
  value: unknown,
): ValidatedBiteSaverProfileRequest {
  if (!isRecord(value)) {
    invalidArgument("Request data must be an object.");
  }
  requireExactKeys(value, allowedRequestKeys, "Request");

  if (typeof value.intent !== "string" || !profileIntents.has(value.intent)) {
    invalidArgument("Intent is invalid.");
  }
  const intent = value.intent as BiteSaverProfileIntent;
  const requestId = normalizedRequestId(value.requestId);
  const profile = normalizedProfile(value.profile);

  if (intent === "submitApplication") {
    if (hasOwn(value, "documentId") || hasOwn(value, "expectedProfileVersion")) {
      invalidArgument(
        "Submission requests cannot include a document ID or expected version.",
      );
    }
    return {
      intent,
      documentId: null,
      requestId,
      expectedProfileVersion: null,
      profile,
    };
  }

  if (!hasOwn(value, "expectedProfileVersion")) {
    invalidArgument("Expected profile version is required for updates.");
  }
  const parsedExpectedVersion = expectedVersion(
    value.expectedProfileVersion,
    "Expected profile version",
  );

  if (intent === "ownerUpdate") {
    if (hasOwn(value, "documentId")) {
      invalidArgument("Owner updates cannot include a document ID.");
    }
    return {
      intent,
      documentId: null,
      requestId,
      expectedProfileVersion: parsedExpectedVersion,
      profile,
    };
  }

  if (!hasOwn(value, "documentId")) {
    invalidArgument("Document ID is required for an admin update.");
  }
  return {
    intent,
    documentId: normalizedDocumentId(value.documentId),
    requestId,
    expectedProfileVersion: parsedExpectedVersion,
    profile,
  };
}

function normalizedFingerprintText(
  value: unknown,
  params: {
    maximumLength: number;
    multiline?: boolean;
    nullable?: boolean;
  },
): string | null {
  if (value === null && params.nullable === true) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }
  const normalized = params.multiline === true
    ? value
        .normalize("NFKC")
        .replace(/\r\n?/gu, "\n")
        .split("\n")
        .map((line) => line.trim().replace(/[^\S\n]+/gu, " "))
        .join("\n")
        .trim()
    : value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const unsupportedCharacters = params.multiline === true
    ? unsupportedMultilineCharacterPattern.test(value)
    : unsupportedControlCharacterPattern.test(value);
  if (
    unsupportedCharacters ||
    normalized !== value ||
    !normalized ||
    normalized.length > params.maximumLength
  ) {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }
  return value;
}

function normalizedFingerprintBusinessHours(
  value: unknown,
): BiteSaverBusinessHoursEntry[] {
  if (
    !Array.isArray(value) ||
    (value.length !== 0 && value.length !== businessDayNames.length)
  ) {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }

  const entries: BiteSaverBusinessHoursEntry[] = [];
  const seenDays = new Set<string>();
  for (const rawEntry of value) {
    if (!isRecord(rawEntry)) {
      throw new TypeError(
        "A normalized BiteSaver profile request is required.",
      );
    }
    const keys = Object.keys(rawEntry);
    if (
      keys.length !== allowedBusinessHoursKeys.size ||
      keys.some((key) => !allowedBusinessHoursKeys.has(key)) ||
      [...allowedBusinessHoursKeys].some((key) => !hasOwn(rawEntry, key))
    ) {
      throw new TypeError(
        "A normalized BiteSaver profile request is required.",
      );
    }
    const day = normalizedFingerprintText(rawEntry.day, {
      maximumLength: 16,
    });
    const opensAt = normalizedFingerprintText(rawEntry.opensAt, {
      maximumLength: maximumBusinessHoursTimeLength,
    });
    const closesAt = normalizedFingerprintText(rawEntry.closesAt, {
      maximumLength: maximumBusinessHoursTimeLength,
    });
    if (
      day === null ||
      opensAt === null ||
      closesAt === null ||
      !businessDayNameSet.has(day) ||
      seenDays.has(day) ||
      typeof rawEntry.closed !== "boolean"
    ) {
      throw new TypeError(
        "A normalized BiteSaver profile request is required.",
      );
    }
    seenDays.add(day);
    entries.push({
      day,
      opensAt,
      closesAt,
      closed: rawEntry.closed,
    });
  }
  if (
    entries.length === businessDayNames.length &&
    businessDayNames.some((day) => !seenDays.has(day))
  ) {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }
  return entries;
}

/**
 * Creates the versioned idempotency binding for an already-normalized logical
 * save request. Request IDs and server/provider results are intentionally not
 * part of the binding.
 */
export function createBiteSaverProfileRequestFingerprint(
  input: BiteSaverProfileRequestFingerprintInput,
): string {
  if (!isRecord(input) || !isRecord(input.request)) {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }
  const inputKeys = Object.keys(input);
  if (
    inputKeys.length !== 3 ||
    inputKeys.some(
      (key) => !new Set(["actorUid", "documentId", "request"]).has(key),
    )
  ) {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }

  const actorUid = input.actorUid;
  const documentId = input.documentId;
  const request = input.request;
  const requestKeys = Object.keys(request);
  if (
    typeof actorUid !== "string" ||
    !actorUid ||
    actorUid.trim() !== actorUid ||
    typeof documentId !== "string" ||
    !documentId ||
    documentId.trim() !== documentId ||
    requestKeys.length !== allowedRequestKeys.size ||
    requestKeys.some((key) => !allowedRequestKeys.has(key)) ||
    !profileIntents.has(request.intent) ||
    typeof request.requestId !== "string" ||
    normalizedRequestId(request.requestId) !== request.requestId ||
    !isRecord(request.profile)
  ) {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }

  if (request.intent === "submitApplication") {
    if (
      request.documentId !== null ||
      request.expectedProfileVersion !== null ||
      documentId !== actorUid
    ) {
      throw new TypeError(
        "A normalized BiteSaver profile request is required.",
      );
    }
  } else {
    if (
      !Number.isSafeInteger(request.expectedProfileVersion) ||
      (request.expectedProfileVersion as number) < 0
    ) {
      throw new TypeError(
        "A normalized BiteSaver profile request is required.",
      );
    }
    if (request.intent === "ownerUpdate") {
      if (request.documentId !== null || documentId !== actorUid) {
        throw new TypeError(
          "A normalized BiteSaver profile request is required.",
        );
      }
    } else if (
      typeof request.documentId !== "string" ||
      request.documentId !== documentId ||
      normalizedDocumentId(request.documentId) !== request.documentId
    ) {
      throw new TypeError(
        "A normalized BiteSaver profile request is required.",
      );
    }
  }

  const profile = request.profile;
  const profileKeys = Object.keys(profile);
  if (
    profileKeys.some((key) => !allowedProfileKeys.has(key)) ||
    [
      "restaurantName",
      "streetAddress",
      "city",
      "state",
      "zipCode",
      "phone",
      "website",
    ].some((key) => !hasOwn(profile, key))
  ) {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }

  const restaurantName = normalizedFingerprintText(profile.restaurantName, {
    maximumLength: maximumRestaurantNameLength,
  });
  const phone = normalizedFingerprintText(profile.phone, {
    maximumLength: maximumPhoneLength,
  });
  const website = normalizedFingerprintText(profile.website, {
    maximumLength: maximumWebsiteLength,
    nullable: true,
  });
  if (restaurantName === null || phone === null) {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }

  let normalizedAddress: StructuredUsRestaurantAddress;
  try {
    normalizedAddress = normalizeStructuredUsRestaurantAddress({
      streetAddress: profile.streetAddress,
      city: profile.city,
      state: profile.state,
      zipCode: profile.zipCode,
    });
  } catch (_) {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }
  if (
    normalizedAddress.streetAddress !== profile.streetAddress ||
    normalizedAddress.city !== profile.city ||
    normalizedAddress.state !== profile.state ||
    normalizedAddress.zipCode !== profile.zipCode
  ) {
    throw new TypeError("A normalized BiteSaver profile request is required.");
  }

  const components = [
    "domain",
    profileRequestFingerprintDomain,
    "formatVersion",
    profileRequestFingerprintVersion,
    "actorUid",
    actorUid,
    "intent",
    request.intent,
    "targetDocumentId",
    documentId,
    "expectedProfileVersion.kind",
    request.expectedProfileVersion === null ? "absent" : "integer",
    "expectedProfileVersion.value",
    request.expectedProfileVersion === null
      ? ""
      : String(request.expectedProfileVersion),
    "profile.restaurantName",
    restaurantName,
    "profile.streetAddress",
    normalizedAddress.streetAddress,
    "profile.city",
    normalizedAddress.city,
    "profile.state",
    normalizedAddress.state,
    "profile.zipCode",
    normalizedAddress.zipCode,
    "profile.phone",
    phone,
    "profile.website.kind",
    website === null ? "null" : "string",
    "profile.website.value",
    website ?? "",
  ];

  for (const field of ["bio", "mainImageUrl"] as const) {
    const present = hasOwn(profile, field);
    const value = present
      ? normalizedFingerprintText(profile[field], {
          maximumLength:
            field === "bio" ? maximumBioLength : maximumMainImageUrlLength,
          multiline: field === "bio",
          nullable: true,
        })
      : null;
    components.push(
      `profile.${field}.presence`,
      present ? "present" : "omitted",
      `profile.${field}.kind`,
      present ? (value === null ? "null" : "string") : "absent",
      `profile.${field}.value`,
      value ?? "",
    );
  }

  const businessHoursPresent = hasOwn(profile, "businessHours");
  const businessHours = businessHoursPresent
    ? normalizedFingerprintBusinessHours(profile.businessHours)
    : [];
  components.push(
    "profile.businessHours.presence",
    businessHoursPresent ? "present" : "omitted",
    "profile.businessHours.length",
    String(businessHours.length),
  );
  for (const [index, entry] of businessHours.entries()) {
    components.push(
      `profile.businessHours.${index}.day`,
      entry.day,
      `profile.businessHours.${index}.opensAt`,
      entry.opensAt,
      `profile.businessHours.${index}.closesAt`,
      entry.closesAt,
      `profile.businessHours.${index}.closed`,
      entry.closed ? "true" : "false",
    );
  }

  const hash = createHash("sha256");
  for (const component of components) {
    hash.update(String(Buffer.byteLength(component, "utf8")));
    hash.update(":");
    hash.update(component);
    hash.update("|");
  }
  return hash.digest("hex");
}

export function validateBiteSaverReviewRequest(
  value: unknown,
): ValidatedBiteSaverReviewRequest {
  if (!isRecord(value)) {
    invalidArgument("Request data must be an object.");
  }
  requireExactKeys(value, allowedReviewRequestKeys, "Request");

  if (
    typeof value.decision !== "string" ||
    !reviewDecisions.has(value.decision)
  ) {
    invalidArgument("Decision must be approve or reject.");
  }
  if (!hasOwn(value, "expectedProfileVersion")) {
    invalidArgument("Expected profile version is required.");
  }

  return {
    documentId: normalizedDocumentId(value.documentId),
    decision: value.decision as BiteSaverApplicationDecision,
    expectedProfileVersion: expectedVersion(
      value.expectedProfileVersion,
      "Expected profile version",
    ),
  };
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readVersion(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : 0;
}

function readProfileVersion(data: Record<string, unknown>): number {
  if (data.profileVersion === undefined || data.profileVersion === null) {
    return 0;
  }
  if (
    !Number.isSafeInteger(data.profileVersion) ||
    (data.profileVersion as number) < 0
  ) {
    failedPrecondition("Restaurant profile version metadata is invalid.");
  }
  return data.profileVersion as number;
}

function readPositiveVersion(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : null;
}

function approvalStatus(data: Record<string, unknown>): string | null {
  return readString(data.approvalStatus)?.toLowerCase() ?? null;
}

function profileResponse(
  documentId: string,
  data: Record<string, unknown>,
): BiteSaverProfileResponse {
  return {
    documentId,
    approvalStatus: controlledApprovalStatus(data),
    profileVersion: readProfileVersion(data),
  };
}

function controlledApprovalStatus(
  data: Record<string, unknown>,
): string | null {
  const status = approvalStatus(data);
  return status !== null && controlledApprovalStatuses.has(status)
    ? status
    : null;
}

function storedAddress(
  data: Record<string, unknown>,
): StructuredUsRestaurantAddress | null {
  try {
    return normalizeStructuredUsRestaurantAddress({
      streetAddress: data.streetAddress,
      city: data.city,
      state: data.state,
      zipCode: data.zipCode,
    });
  } catch (error) {
    if (error instanceof RestaurantGeocodingError) {
      return null;
    }
    throw error;
  }
}

function profileAddress(
  profile: BiteSaverRestaurantProfile,
): StructuredUsRestaurantAddress {
  return {
    streetAddress: profile.streetAddress,
    city: profile.city,
    state: profile.state,
    zipCode: profile.zipCode,
  };
}

function timestampStateKey(value: unknown): unknown {
  if (!isRecord(value)) {
    return value ?? null;
  }
  const toMillis = value.toMillis;
  if (typeof toMillis === "function") {
    try {
      return toMillis.call(value);
    } catch (_) {
      return null;
    }
  }
  const seconds = value.seconds;
  const nanoseconds = value.nanoseconds;
  if (typeof seconds === "number" && typeof nanoseconds === "number") {
    return [seconds, nanoseconds];
  }
  return null;
}

function trustedLocationForAddress(
  data: Record<string, unknown>,
  address: StructuredUsRestaurantAddress,
): TrustedLocation | null {
  const currentAddress = storedAddress(data);
  if (!currentAddress) {
    return null;
  }

  const expectedFingerprint = createRestaurantAddressFingerprint(address);
  const storedFingerprint = readString(data.addressFingerprint);
  if (
    !storedFingerprint ||
    storedFingerprint !== expectedFingerprint ||
    createRestaurantAddressFingerprint(currentAddress) !== storedFingerprint
  ) {
    return null;
  }

  const coordinates = validRestaurantCoordinates(
    data.latitude,
    data.longitude,
  );
  const formattedAddress = readString(data.formattedAddress);
  const locationSource = readString(data.locationSource);
  const locationVersion = readPositiveVersion(data.locationVersion);
  const locationValidationFingerprint = readString(
    data.locationValidationFingerprint,
  );
  if (
    !coordinates ||
    !formattedAddress ||
    formattedAddress.length > 500 ||
    unsupportedControlCharacterPattern.test(formattedAddress) ||
    locationSource !== biteSaverLocationSource ||
    locationVersion === null ||
    data.locationValidatedAt == null ||
    locationValidationFingerprint !==
      createBiteSaverLocationValidationFingerprint({
        addressFingerprint: storedFingerprint,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        locationSource,
      })
  ) {
    return null;
  }

  return {
    address: currentAddress,
    formattedAddress,
    ...coordinates,
    addressFingerprint: storedFingerprint,
    locationValidatedAt: data.locationValidatedAt,
    locationSource,
    locationVersion,
    locationValidationFingerprint,
  };
}

export function createBiteSaverLocationValidationFingerprint(value: {
  addressFingerprint: string;
  latitude: number;
  longitude: number;
  locationSource: string;
}): string {
  const coordinates = validRestaurantCoordinates(
    value.latitude,
    value.longitude,
  );
  const addressFingerprint = readString(value.addressFingerprint);
  const locationSource = readString(value.locationSource);
  if (!coordinates || !addressFingerprint || !locationSource) {
    throw new RangeError("A complete validated location is required.");
  }

  const components = [
    addressFingerprint,
    String(coordinates.latitude),
    String(coordinates.longitude),
    locationSource,
  ];
  const hash = createHash("sha256");
  for (const component of components) {
    hash.update(String(Buffer.byteLength(component, "utf8")));
    hash.update(":");
    hash.update(component);
    hash.update("|");
  }
  return hash.digest("hex");
}

export function hasCompleteTrustedBiteSaverLocation(
  data: Record<string, unknown>,
): boolean {
  const address = storedAddress(data);
  return address !== null && trustedLocationForAddress(data, address) !== null;
}

export function canApproveBiteSaverApplication(
  data: Record<string, unknown>,
): boolean {
  return (
    data.couponApplicationSubmitted === true &&
    readString(data.restaurantName) !== null &&
    readString(data.phone) !== null &&
    hasCompleteTrustedBiteSaverLocation(data)
  );
}

function actorOwnsExistingAccount(
  actor: RestaurantAccountActorContext,
  documentId: string,
  snapshot: BiteSaverAccountSnapshot,
  allowMissingStoredUid: boolean,
): void {
  if (!snapshot.exists) {
    return;
  }
  const storedUid = readString(snapshot.data.uid);
  if (
    documentId !== actor.uid ||
    (storedUid !== null && storedUid !== actor.uid) ||
    (!allowMissingStoredUid && storedUid === null)
  ) {
    throw new HttpsError(
      "permission-denied",
      "This restaurant account does not belong to the signed-in user.",
    );
  }
}

type ProfileRequestIdempotencyState = "new-request" | "exact-retry";

function profileRequestIdCollision(): never {
  failedPrecondition(
    "This request ID was already used for a different profile request.",
  );
}

function classifyProfileRequestIdempotency(
  data: Record<string, unknown>,
  requestId: string,
  requestFingerprint: string,
): ProfileRequestIdempotencyState {
  if (data.lastProfileRequestId !== requestId) {
    return "new-request";
  }
  const storedFingerprint = data.lastProfileRequestFingerprint;
  if (
    typeof storedFingerprint !== "string" ||
    !lowercaseSha256FingerprintPattern.test(storedFingerprint) ||
    storedFingerprint !== requestFingerprint
  ) {
    profileRequestIdCollision();
  }
  return "exact-retry";
}

function ensureSubmittable(snapshot: BiteSaverAccountSnapshot): void {
  if (!snapshot.exists) {
    return;
  }
  if (
    snapshot.data.couponApplicationSubmitted === true ||
    approvalStatus(snapshot.data) !== null ||
    looksLikeLegacySubmittedApplication(snapshot.data)
  ) {
    failedPrecondition(
      "This BiteSaver application has already been submitted and cannot be resubmitted.",
    );
  }
}

function looksLikeLegacySubmittedApplication(
  data: Record<string, unknown>,
): boolean {
  return [
    data.restaurantName,
    data.streetAddress,
    data.city,
    data.state,
    data.zipCode,
    data.phone,
  ].every((value) => readString(value) !== null);
}

function ensureExistingBiteSaverProfile(
  data: Record<string, unknown>,
): void {
  if (
    data.couponApplicationSubmitted !== true &&
    approvalStatus(data) === null &&
    !looksLikeLegacySubmittedApplication(data)
  ) {
    failedPrecondition(
      "A submitted BiteSaver restaurant profile is required for updates.",
    );
  }
}

function normalizeComparableProfileText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  if (unsupportedControlCharacterPattern.test(value)) {
    return null;
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized || null;
}

function ensureOwnerNameUnchanged(
  data: Record<string, unknown>,
  submittedName: string,
): void {
  const existingName = normalizeComparableProfileText(data.restaurantName);
  if (!existingName || existingName !== submittedName) {
    failedPrecondition(
      "Restaurant name changes require the separate name-change approval workflow.",
    );
  }
}

function concurrentStateKey(snapshot: BiteSaverAccountSnapshot): string {
  if (!snapshot.exists) {
    return "missing";
  }
  const data = snapshot.data;
  return JSON.stringify([
    readString(data.uid),
    readString(data.restaurantName),
    readString(data.streetAddress),
    readString(data.city),
    readString(data.state),
    readString(data.zipCode),
    readString(data.phone),
    readString(data.website),
    readString(data.bio),
    readString(data.mainImageUrl),
    JSON.stringify(data.businessHours ?? null),
    data.couponApplicationSubmitted === true,
    approvalStatus(data),
    readProfileVersion(data),
    readString(data.addressFingerprint),
    data.latitude ?? null,
    data.longitude ?? null,
    readString(data.formattedAddress),
    readString(data.locationSource),
    readVersion(data.locationVersion),
    readString(data.locationValidationFingerprint),
    timestampStateKey(data.locationValidatedAt),
    data.lastProfileRequestId ?? null,
    data.lastProfileRequestFingerprint ?? null,
  ]);
}

function validatedGeocodingResult(
  result: StrictRestaurantGeocodingResult,
  requestedAddress: StructuredUsRestaurantAddress,
): StrictRestaurantGeocodingResult {
  const expectedFingerprint =
    createRestaurantAddressFingerprint(requestedAddress);
  const coordinates = validRestaurantCoordinates(
    result.latitude,
    result.longitude,
  );
  const formattedAddress = readString(result.formattedAddress);
  if (
    !coordinates ||
    result.addressFingerprint !== expectedFingerprint ||
    !formattedAddress ||
    formattedAddress.length > 500 ||
    unsupportedControlCharacterPattern.test(formattedAddress)
  ) {
    throw new HttpsError(
      "internal",
      "Restaurant address validation returned an invalid result.",
    );
  }
  return result;
}

async function geocodeSafely(
  address: StructuredUsRestaurantAddress,
  dependency: BiteSaverProfileDependencies["geocodeAddress"],
): Promise<StrictRestaurantGeocodingResult> {
  try {
    return validatedGeocodingResult(await dependency(address), address);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    if (error instanceof RestaurantGeocodingError) {
      throw new HttpsError(error.code, error.message);
    }
    throw new HttpsError(
      "unavailable",
      "Restaurant address lookup is temporarily unavailable.",
    );
  }
}

function profileWriteData(
  request: ValidatedBiteSaverProfileRequest,
  requestFingerprint: string,
  latest: BiteSaverAccountSnapshot,
  actor: RestaurantAccountActorContext,
  geocoded: StrictRestaurantGeocodingResult | null,
  reusedLocation: TrustedLocation | null,
  serverTimestamp: () => unknown,
): Record<string, unknown> {
  const currentVersion = readProfileVersion(latest.data);
  const write: Record<string, unknown> = {
    restaurantName: request.profile.restaurantName,
    streetAddress: request.profile.streetAddress,
    city: request.profile.city,
    state: request.profile.state,
    zipCode: request.profile.zipCode,
    phone: request.profile.phone,
    website: request.profile.website,
    profileVersion: currentVersion + 1,
    lastProfileRequestId: request.requestId,
    lastProfileRequestFingerprint: requestFingerprint,
    updatedAt: serverTimestamp(),
  };
  if (request.profile.bio !== undefined) {
    write.bio = request.profile.bio;
  }
  if (request.profile.mainImageUrl !== undefined) {
    write.mainImageUrl = request.profile.mainImageUrl;
  }
  if (request.profile.businessHours !== undefined) {
    write.businessHours = request.profile.businessHours;
  }

  if (request.intent === "submitApplication") {
    write.uid = actor.uid;
    if (actor.email !== null) {
      write.email = actor.email;
      write.emailVerified = actor.emailVerified;
    }
    write.couponApplicationSubmitted = true;
    write.approvalStatus = "pending";
    if (!latest.exists || latest.data.createdAt == null) {
      write.createdAt = serverTimestamp();
    }
  } else if (request.intent === "ownerUpdate" && actor.email !== null) {
    write.email = actor.email;
    write.emailVerified = actor.emailVerified;
  }

  if (geocoded !== null) {
    write.formattedAddress = geocoded.formattedAddress;
    write.latitude = geocoded.latitude;
    write.longitude = geocoded.longitude;
    write.addressFingerprint = geocoded.addressFingerprint;
    write.locationValidatedAt = serverTimestamp();
    write.locationSource = biteSaverLocationSource;
    write.locationVersion = readVersion(latest.data.locationVersion) + 1;
    write.locationValidationFingerprint =
      createBiteSaverLocationValidationFingerprint({
        addressFingerprint: geocoded.addressFingerprint,
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
        locationSource: biteSaverLocationSource,
      });
  } else if (reusedLocation === null) {
    throw new HttpsError(
      "internal",
      "A trusted restaurant location is required.",
    );
  }

  return write;
}

function resultDataAfterWrite(
  current: Record<string, unknown>,
  write: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, ...write };
}

export async function saveBiteSaverRestaurantProfileHandler(
  request: CallableLikeRequest,
  dependencies: BiteSaverProfileDependencies,
): Promise<BiteSaverProfileResponse> {
  const rawIntent = isRecord(request.data) ? request.data.intent : null;
  const actor =
    rawIntent === "adminUpdate"
      ? requireRestaurantAccountAdminAccess(request)
      : requireAuthenticatedRestaurantAccountActor(request);

  const parsed = validateBiteSaverProfileRequest(request.data);
  if (parsed.intent === "adminUpdate" && rawIntent !== "adminUpdate") {
    throw new HttpsError(
      "permission-denied",
      "Restaurant account administrator access is required.",
    );
  }

  const documentId =
    parsed.intent === "adminUpdate" ? parsed.documentId! : actor.uid;
  const requestFingerprint = createBiteSaverProfileRequestFingerprint({
    actorUid: actor.uid,
    documentId,
    request: parsed,
  });
  const initial = await dependencies.getAccount(documentId);

  if (parsed.intent === "submitApplication") {
    actorOwnsExistingAccount(actor, documentId, initial, true);
  } else if (!initial.exists) {
    throw new HttpsError("not-found", "Restaurant account was not found.");
  } else if (parsed.intent === "ownerUpdate") {
    actorOwnsExistingAccount(actor, documentId, initial, false);
  }

  const initialIdempotencyState = initial.exists
    ? classifyProfileRequestIdempotency(
        initial.data,
        parsed.requestId,
        requestFingerprint,
      )
    : "new-request";
  const isInitialIdempotentRetry =
    initialIdempotencyState === "exact-retry";
  if (!isInitialIdempotentRetry) {
    if (parsed.intent === "submitApplication") {
      ensureSubmittable(initial);
    } else {
      ensureExistingBiteSaverProfile(initial.data);
      if (parsed.intent === "ownerUpdate") {
        ensureOwnerNameUnchanged(initial.data, parsed.profile.restaurantName);
      }
    }
  }

  if (
    !isInitialIdempotentRetry &&
    parsed.expectedProfileVersion !== null &&
    readProfileVersion(initial.data) !== parsed.expectedProfileVersion
  ) {
    aborted("The restaurant profile changed. Reload it and try again.");
  }

  const requestedAddress = profileAddress(parsed.profile);
  const initialTrustedLocation = initial.exists
    ? trustedLocationForAddress(initial.data, requestedAddress)
    : null;
  const geocoded =
    !isInitialIdempotentRetry && initialTrustedLocation === null
      ? await geocodeSafely(requestedAddress, dependencies.geocodeAddress)
      : null;
  const initialStateKey = concurrentStateKey(initial);

  return dependencies.runAccountTransaction(documentId, (latest) => {
    const latestActor =
      parsed.intent === "adminUpdate"
        ? requireRestaurantAccountAdminAccess(request)
        : requireAuthenticatedRestaurantAccountActor(request);

    if (latest.exists && parsed.intent !== "adminUpdate") {
      actorOwnsExistingAccount(
        latestActor,
        documentId,
        latest,
        parsed.intent === "submitApplication",
      );
    }
    const latestIdempotencyState = latest.exists
      ? classifyProfileRequestIdempotency(
          latest.data,
          parsed.requestId,
          requestFingerprint,
        )
      : "new-request";
    if (latestIdempotencyState === "exact-retry") {
      return {
        operation: "none",
        response: profileResponse(documentId, latest.data),
      };
    }
    if (isInitialIdempotentRetry) {
      aborted(
        "The restaurant profile changed while the request was being retried.",
      );
    }

    if (parsed.intent === "submitApplication") {
      ensureSubmittable(latest);
    } else if (!latest.exists) {
      throw new HttpsError("not-found", "Restaurant account was not found.");
    } else if (parsed.intent === "ownerUpdate") {
      ensureExistingBiteSaverProfile(latest.data);
      ensureOwnerNameUnchanged(latest.data, parsed.profile.restaurantName);
    } else {
      ensureExistingBiteSaverProfile(latest.data);
    }

    if (
      parsed.expectedProfileVersion !== null &&
      readProfileVersion(latest.data) !== parsed.expectedProfileVersion
    ) {
      aborted("The restaurant profile changed. Reload it and try again.");
    }
    if (concurrentStateKey(latest) !== initialStateKey) {
      aborted(
        "The restaurant profile changed while its address was being validated.",
      );
    }

    const latestTrustedLocation =
      geocoded === null
        ? trustedLocationForAddress(latest.data, requestedAddress)
        : null;
    if (geocoded === null && latestTrustedLocation === null) {
      aborted(
        "The restaurant location changed. Reload the profile and try again.",
      );
    }

    const write = profileWriteData(
      parsed,
      requestFingerprint,
      latest,
      latestActor,
      geocoded,
      latestTrustedLocation,
      dependencies.serverTimestamp,
    );
    const resultingData = resultDataAfterWrite(latest.data, write);
    return {
      operation: latest.exists ? "update" : "create",
      data: write,
      response: profileResponse(documentId, resultingData),
    };
  });
}

export async function reviewBiteSaverApplicationHandler(
  request: CallableLikeRequest,
  dependencies: BiteSaverReviewDependencies,
): Promise<BiteSaverReviewResponse> {
  requireRestaurantAccountAdminAccess(request);
  const parsed = validateBiteSaverReviewRequest(request.data);

  return dependencies.runAccountTransaction(parsed.documentId, (latest) => {
    requireRestaurantAccountAdminAccess(request);
    if (!latest.exists) {
      throw new HttpsError("not-found", "Restaurant account was not found.");
    }
    if (latest.data.couponApplicationSubmitted !== true) {
      failedPrecondition("A submitted BiteSaver application is required.");
    }
    if (
      readProfileVersion(latest.data) !== parsed.expectedProfileVersion
    ) {
      aborted("The restaurant profile changed. Reload it and try again.");
    }
    if (approvalStatus(latest.data) !== "pending") {
      failedPrecondition(
        "Only a pending BiteSaver application can be reviewed.",
      );
    }
    if (
      parsed.decision === "approve" &&
      !canApproveBiteSaverApplication(latest.data)
    ) {
      failedPrecondition(
        "The BiteSaver application does not have a complete trusted location.",
      );
    }

    const nextStatus =
      parsed.decision === "approve" ? "approved" : "rejected";
    const write: Record<string, unknown> = {
      approvalStatus: nextStatus,
      updatedAt: dependencies.serverTimestamp(),
    };
    return {
      operation: "update",
      data: write,
      response: {
        documentId: parsed.documentId,
        approvalStatus: nextStatus,
        profileVersion: readProfileVersion(latest.data),
      },
    };
  });
}
