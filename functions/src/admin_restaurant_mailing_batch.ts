import type { Firestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import { readBiteScoreCatalogRestaurantId } from "./restaurant_invite_helpers.js";
import { supportedUsStateCodes } from "./search_normalization.js";

export const adminRestaurantMailingBatchSchemaVersion = 1 as const;
export const maximumAdminRestaurantMailingBatchRestaurants = 25 as const;

const biteScoreRestaurantCollection = "bitescore_restaurants" as const;
const unsupportedOneLineCharacterPattern = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const explicitlyRejectedOneLineCodePointPattern = /[\u17b4\u17b5]/u;
const zipCodePattern = /^\d{5}(?:-\d{4})?$/u;
const supportedUsStateCodeSet = new Set<string>(supportedUsStateCodes);

type AdminAuthorization = Readonly<{ uid: string; email: string }>;

type ParsedRequest = Readonly<{
  catalogRestaurantIds: readonly string[];
}>;

export type AdminRestaurantMailingProblemCode =
  | "restaurant_not_found"
  | "restaurant_ineligible"
  | "missing_mailing_component"
  | "invalid_state"
  | "invalid_zip"
  | "invalid_one_line_text"
  | "unsupported_address_shape"
  | "bounded_read_failed";

export type AdminRestaurantMailingReadyResult = Readonly<{
  catalogRestaurantId: string;
  outcome: "ready";
  restaurantName: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
}>;

export type AdminRestaurantMailingProblemResult = Readonly<{
  catalogRestaurantId: string;
  outcome: "unavailable" | "failed";
  restaurantName: string | null;
  code: AdminRestaurantMailingProblemCode;
  message: string;
}>;

export type AdminRestaurantMailingResult =
  | AdminRestaurantMailingReadyResult
  | AdminRestaurantMailingProblemResult;

export type AdminRestaurantMailingDocument = Readonly<{
  id: string;
  exists: boolean;
  data(): Readonly<Record<string, unknown>> | undefined;
}>;

export interface AdminRestaurantMailingBatchDatabase {
  getRestaurantDocuments(
    catalogRestaurantIds: readonly string[],
  ): Promise<readonly AdminRestaurantMailingDocument[]>;
}

export type AdminRestaurantMailingBatchCallableDependencies = Readonly<{
  database: AdminRestaurantMailingBatchDatabase;
  requireAdmin: (
    request: CallableRequest<unknown>,
  ) => AdminAuthorization;
}>;

type ValidatedText =
  | Readonly<{ valid: true; value: string }>
  | Readonly<{ valid: false; missing: boolean }>;

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length &&
    keys.every((key) => expected.includes(key));
}

function invalidRequest(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

function parseRequest(value: unknown): ParsedRequest {
  const data = readRecord(value);
  if (
    data === null ||
    !hasExactKeys(data, ["schemaVersion", "catalogRestaurantIds"]) ||
    !Number.isInteger(data.schemaVersion) ||
    data.schemaVersion !== adminRestaurantMailingBatchSchemaVersion ||
    !Array.isArray(data.catalogRestaurantIds) ||
    data.catalogRestaurantIds.length === 0 ||
    data.catalogRestaurantIds.length > maximumAdminRestaurantMailingBatchRestaurants
  ) {
    invalidRequest("The restaurant mailing batch request is invalid.");
  }

  const catalogRestaurantIds: string[] = [];
  const seen = new Set<string>();
  for (const value of data.catalogRestaurantIds) {
    const catalogRestaurantId = readBiteScoreCatalogRestaurantId(value);
    if (catalogRestaurantId === null || seen.has(catalogRestaurantId)) {
      invalidRequest("The restaurant mailing batch IDs are invalid.");
    }
    seen.add(catalogRestaurantId);
    catalogRestaurantIds.push(catalogRestaurantId);
  }
  return Object.freeze({
    catalogRestaurantIds: Object.freeze(catalogRestaurantIds),
  });
}

function hasWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const trailingCodeUnit = value.charCodeAt(index + 1);
      if (trailingCodeUnit < 0xdc00 || trailingCodeUnit > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validateOneLineText(value: unknown): ValidatedText {
  if (typeof value !== "string") {
    return Object.freeze({ valid: false, missing: value === null || value === undefined });
  }
  if (
    !hasWellFormedUtf16(value) ||
    explicitlyRejectedOneLineCodePointPattern.test(value) ||
    unsupportedOneLineCharacterPattern.test(value)
  ) {
    return Object.freeze({ valid: false, missing: false });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return Object.freeze({ valid: false, missing: true });
  }
  return Object.freeze({ valid: true, value: trimmed });
}

function selectedRestaurantName(
  data: Readonly<Record<string, unknown>>,
): unknown {
  for (const fieldName of ["name", "restaurantName", "restaurant_name"] as const) {
    if (
      Object.prototype.hasOwnProperty.call(data, fieldName) &&
      data[fieldName] !== null
    ) {
      return data[fieldName];
    }
  }
  return undefined;
}

function safeRestaurantName(
  data: Readonly<Record<string, unknown>> | undefined,
): string | null {
  if (data === undefined) return null;
  const result = validateOneLineText(selectedRestaurantName(data));
  return result.valid ? result.value : null;
}

function problem(
  catalogRestaurantId: string,
  data: Readonly<Record<string, unknown>> | undefined,
  outcome: "unavailable" | "failed",
  code: AdminRestaurantMailingProblemCode,
  message: string,
): AdminRestaurantMailingProblemResult {
  return Object.freeze({
    catalogRestaurantId,
    outcome,
    restaurantName: safeRestaurantName(data),
    code,
    message,
  });
}

function missingProblem(
  catalogRestaurantId: string,
  data: Readonly<Record<string, unknown>>,
): AdminRestaurantMailingProblemResult {
  return problem(
    catalogRestaurantId,
    data,
    "unavailable",
    "missing_mailing_component",
    "Restaurant mailing data is missing a required component.",
  );
}

function invalidTextProblem(
  catalogRestaurantId: string,
  data: Readonly<Record<string, unknown>>,
): AdminRestaurantMailingProblemResult {
  return problem(
    catalogRestaurantId,
    data,
    "unavailable",
    "invalid_one_line_text",
    "Restaurant mailing data contains invalid one-line text.",
  );
}

function selectedStreetAddress(
  data: Readonly<Record<string, unknown>>,
): Readonly<{ value: unknown; unsupportedShape: boolean }> {
  if (data.streetAddress !== undefined && data.streetAddress !== null) {
    return Object.freeze({ value: data.streetAddress, unsupportedShape: false });
  }
  const unsupportedShape =
    (data.formattedAddress !== undefined && data.formattedAddress !== null) ||
    (data.fullAddress !== undefined && data.fullAddress !== null);
  return Object.freeze({ value: undefined, unsupportedShape });
}

export function projectAdminRestaurantMailingResult(
  catalogRestaurantId: string,
  data: Readonly<Record<string, unknown>>,
): AdminRestaurantMailingResult {
  if (data.isActive !== true) {
    return problem(
      catalogRestaurantId,
      data,
      "unavailable",
      "restaurant_ineligible",
      "Restaurant is inactive or unavailable for mailing.",
    );
  }

  const restaurantName = validateOneLineText(selectedRestaurantName(data));
  if (!restaurantName.valid) {
    return restaurantName.missing
      ? missingProblem(catalogRestaurantId, data)
      : invalidTextProblem(catalogRestaurantId, data);
  }

  const selectedStreet = selectedStreetAddress(data);
  if (selectedStreet.unsupportedShape) {
    return problem(
      catalogRestaurantId,
      data,
      "unavailable",
      "unsupported_address_shape",
      "Restaurant mailing data has no supported authoritative street line.",
    );
  }
  const streetAddress = validateOneLineText(selectedStreet.value);
  const city = validateOneLineText(data.city);
  const state = validateOneLineText(data.state);
  const zipCode = validateOneLineText(data.zipCode);
  for (const value of [streetAddress, city, state, zipCode]) {
    if (!value.valid) {
      return value.missing
        ? missingProblem(catalogRestaurantId, data)
        : invalidTextProblem(catalogRestaurantId, data);
    }
  }

  if (!state.valid || !supportedUsStateCodeSet.has(state.value)) {
    return problem(
      catalogRestaurantId,
      data,
      "unavailable",
      "invalid_state",
      "Restaurant mailing data has an invalid state abbreviation.",
    );
  }
  if (!zipCode.valid || !zipCodePattern.test(zipCode.value)) {
    return problem(
      catalogRestaurantId,
      data,
      "unavailable",
      "invalid_zip",
      "Restaurant mailing data has an invalid ZIP code.",
    );
  }

  if (!streetAddress.valid || !city.valid) {
    return missingProblem(catalogRestaurantId, data);
  }
  return Object.freeze({
    catalogRestaurantId,
    outcome: "ready",
    restaurantName: restaurantName.value,
    streetAddress: streetAddress.value,
    city: city.value,
    state: state.value,
    zipCode: zipCode.value,
  });
}

function boundedReadFailure(): never {
  throw new HttpsError(
    "unavailable",
    "Restaurant mailing data could not be loaded. Try again.",
  );
}

export async function prepareAdminRestaurantMailingLabelBatchCallableHandler(
  request: CallableRequest<unknown>,
  dependencies: AdminRestaurantMailingBatchCallableDependencies,
): Promise<Readonly<{
  schemaVersion: 1;
  outcome: "complete" | "partialFailure";
  results: readonly AdminRestaurantMailingResult[];
}>> {
  dependencies.requireAdmin(request);
  const parsed = parseRequest(request.data);

  let documents: readonly AdminRestaurantMailingDocument[];
  try {
    documents = await dependencies.database.getRestaurantDocuments(
      parsed.catalogRestaurantIds,
    );
  } catch {
    boundedReadFailure();
  }
  if (documents.length !== parsed.catalogRestaurantIds.length) {
    boundedReadFailure();
  }

  const documentsById = new Map<string, AdminRestaurantMailingDocument>();
  const requestedIds = new Set(parsed.catalogRestaurantIds);
  for (const document of documents) {
    if (
      !requestedIds.has(document.id) ||
      documentsById.has(document.id)
    ) {
      boundedReadFailure();
    }
    documentsById.set(document.id, document);
  }

  const results = parsed.catalogRestaurantIds.map((catalogRestaurantId) => {
    const document = documentsById.get(catalogRestaurantId);
    if (document === undefined) boundedReadFailure();
    if (!document.exists) {
      return problem(
        catalogRestaurantId,
        undefined,
        "unavailable",
        "restaurant_not_found",
        "Restaurant was not found.",
      );
    }
    let data: Readonly<Record<string, unknown>> | undefined;
    try {
      data = document.data();
    } catch {
      return problem(
        catalogRestaurantId,
        undefined,
        "failed",
        "bounded_read_failed",
        "Restaurant mailing data could not be read.",
      );
    }
    if (data === undefined) {
      return problem(
        catalogRestaurantId,
        undefined,
        "failed",
        "bounded_read_failed",
        "Restaurant mailing data could not be read.",
      );
    }
    return projectAdminRestaurantMailingResult(catalogRestaurantId, data);
  });

  return Object.freeze({
    schemaVersion: adminRestaurantMailingBatchSchemaVersion,
    outcome: results.every((result) => result.outcome === "ready")
      ? "complete"
      : "partialFailure",
    results: Object.freeze(results),
  });
}

export function createFirestoreAdminRestaurantMailingBatchDatabase(
  database: Firestore,
): AdminRestaurantMailingBatchDatabase {
  return Object.freeze({
    async getRestaurantDocuments(
      catalogRestaurantIds: readonly string[],
    ): Promise<readonly AdminRestaurantMailingDocument[]> {
      const collection = database.collection(biteScoreRestaurantCollection);
      const references = catalogRestaurantIds.map((catalogRestaurantId) =>
        collection.doc(catalogRestaurantId)
      );
      return database.getAll(...references);
    },
  });
}
