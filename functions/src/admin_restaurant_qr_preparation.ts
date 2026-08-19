import {
  FieldValue,
  type DocumentData,
  type Firestore,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import {
  biteSaverAccountCatalogBindingState,
  biteScoreCatalogBindingState,
  biteScoreCatalogRestaurantIdField,
  readBiteScoreCatalogRestaurantId,
} from "./restaurant_invite_helpers.js";
import {
  biteSaverCatalogBindingAdminState,
  biteScoreRestaurantClaimProjection,
  biteScoreRestaurantIsActive,
} from "./search_index_builders.js";

export const adminRestaurantQrPreparationCollection =
  "private_admin_restaurant_qr_preparation" as const;

export const adminRestaurantQrPreparationTypes = [
  "I",
  "C",
  "SA",
  "SR",
] as const;

export type AdminRestaurantQrPreparationType =
  (typeof adminRestaurantQrPreparationTypes)[number];

export type AdminRestaurantQrPreparationStatus =
  | "prepared"
  | "unprepared"
  | "notRequired"
  | "unavailable";

export type AdminRestaurantQrPreparationProjection = Readonly<{
  canonicalCatalogRestaurantId: string | null;
  i: AdminRestaurantQrPreparationStatus;
  c: AdminRestaurantQrPreparationStatus;
  sa: AdminRestaurantQrPreparationStatus;
  sr: AdminRestaurantQrPreparationStatus;
}>;

export type AdminRestaurantQrPreparedClaimValidation =
  | Readonly<{ state: "absent"; inviteId: null }>
  | Readonly<{
    state: "eligible" | "ineligible";
    inviteId: string;
  }>
  | Readonly<{
    state: "unavailable";
    inviteId: string | null;
  }>;

export type AdminRestaurantQrPreparedOwnerValidation =
  | Readonly<{ state: "absent"; inviteId: null }>
  | Readonly<{
    state: "eligible" | "ineligible";
    inviteId: string;
  }>
  | Readonly<{
    state: "unavailable";
    inviteId: string | null;
  }>;

export type AdminRestaurantQrPreparationPatch = Readonly<{
  set: Readonly<Record<string, unknown>>;
  deleteFields: readonly string[];
}>;

export type AdminRestaurantQrPreparationStoredDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

export interface AdminRestaurantQrPreparationTransaction {
  getDocument(
    path: string,
  ): Promise<AdminRestaurantQrPreparationStoredDocument | null>;
  queryRestaurantAccounts(
    catalogRestaurantId: string,
  ): Promise<readonly AdminRestaurantQrPreparationStoredDocument[]>;
  mergeDocument(
    path: string,
    patch: AdminRestaurantQrPreparationPatch,
  ): void;
}

export interface AdminRestaurantQrPreparationDatabase {
  runTransaction<T>(
    operation: (
      transaction: AdminRestaurantQrPreparationTransaction,
    ) => Promise<T>,
  ): Promise<T>;
  getPreparationDocuments(
    catalogRestaurantIds: readonly string[],
  ): Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>;
}

type ParsedInvitationAssociation = Readonly<{
  id: string;
  expiresAtMillis: number;
}>;

type ParsedPreparationDocument = Readonly<{
  saPrepared: boolean;
  srPrepared: boolean;
  iLatest: ParsedInvitationAssociation | null;
  iPrepared: ParsedInvitationAssociation | null;
  cLatest: ParsedInvitationAssociation | null;
  cPrepared: ParsedInvitationAssociation | null;
}>;

type BiteSaverParticipationState = "unbound" | "bound" | "unavailable";
type BiteScoreClaimState = "available" | "claimed" | "unavailable";

type ParsedMutationRequest = Readonly<{
  catalogRestaurantId: string;
  type: AdminRestaurantQrPreparationType;
  prepared: boolean;
  expectedInviteId: string | null;
}>;

type AdminAuthorization = Readonly<{ uid: string; email: string }>;

export type AdminRestaurantQrPreparationCallableDependencies = Readonly<{
  database: AdminRestaurantQrPreparationDatabase;
  requireAdmin: (
    request: CallableRequest<unknown>,
  ) => AdminAuthorization;
  now: () => Date;
}>;

const preparationFields = Object.freeze({
  I: Object.freeze({
    latestId: "iLatestInviteId",
    latestExpiry: "iLatestInviteExpiresAt",
    preparedId: "iPreparedInviteId",
    preparedExpiry: "iPreparedInviteExpiresAt",
  }),
  C: Object.freeze({
    latestId: "cLatestInviteId",
    latestExpiry: "cLatestInviteExpiresAt",
    preparedId: "cPreparedInviteId",
    preparedExpiry: "cPreparedInviteExpiresAt",
  }),
});

const supportedPreparationFieldNames = new Set([
  "schemaVersion",
  "saPrepared",
  "srPrepared",
  preparationFields.I.latestId,
  preparationFields.I.latestExpiry,
  preparationFields.I.preparedId,
  preparationFields.I.preparedExpiry,
  preparationFields.C.latestId,
  preparationFields.C.latestExpiry,
  preparationFields.C.preparedId,
  preparationFields.C.preparedExpiry,
]);

export const biteScoreClaimInvitationEpochAtField =
  "claimInvitationEpochAt" as const;

function preparationPath(catalogRestaurantId: string): string {
  return `${adminRestaurantQrPreparationCollection}/${catalogRestaurantId}`;
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    const millis = value.toMillis();
    return typeof millis === "number" && Number.isFinite(millis)
      ? millis
      : null;
  }
  return null;
}

function timestampParts(value: unknown): readonly [number, number] | null {
  if (value instanceof Date) {
    const millis = value.getTime();
    if (!Number.isFinite(millis)) {
      return null;
    }
    const seconds = Math.floor(millis / 1_000);
    return Object.freeze([seconds, (millis - seconds * 1_000) * 1_000_000]);
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "seconds" in value &&
    "nanoseconds" in value &&
    typeof value.seconds === "number" &&
    Number.isInteger(value.seconds) &&
    typeof value.nanoseconds === "number" &&
    Number.isInteger(value.nanoseconds) &&
    value.nanoseconds >= 0 &&
    value.nanoseconds < 1_000_000_000
  ) {
    return Object.freeze([value.seconds, value.nanoseconds]);
  }
  const millis = timestampMillis(value);
  if (millis === null) {
    return null;
  }
  const seconds = Math.floor(millis / 1_000);
  return Object.freeze([seconds, (millis - seconds * 1_000) * 1_000_000]);
}

function timestampIsAfter(value: unknown, boundary: unknown): boolean {
  const valueParts = timestampParts(value);
  const boundaryParts = timestampParts(boundary);
  return valueParts !== null &&
    boundaryParts !== null &&
    (valueParts[0] > boundaryParts[0] ||
      (valueParts[0] === boundaryParts[0] &&
        valueParts[1] > boundaryParts[1]));
}

function timestampsAreEqual(left: unknown, right: unknown): boolean {
  const leftParts = timestampParts(left);
  const rightParts = timestampParts(right);
  return leftParts !== null &&
    rightParts !== null &&
    leftParts[0] === rightParts[0] &&
    leftParts[1] === rightParts[1];
}

function safeDocumentId(value: unknown): string | null {
  return readBiteScoreCatalogRestaurantId(value);
}

function parseInvitationAssociation(
  data: Readonly<Record<string, unknown>>,
  idField: string,
  expiryField: string,
): ParsedInvitationAssociation | null | undefined {
  const hasId = Object.prototype.hasOwnProperty.call(data, idField);
  const hasExpiry = Object.prototype.hasOwnProperty.call(data, expiryField);
  if (!hasId && !hasExpiry) {
    return null;
  }
  if (!hasId || !hasExpiry) {
    return undefined;
  }
  const id = safeDocumentId(data[idField]);
  const expiresAtMillis = timestampMillis(data[expiryField]);
  if (id === null || expiresAtMillis === null) {
    return undefined;
  }
  return Object.freeze({ id, expiresAtMillis });
}

export function parseAdminRestaurantQrPreparationDocument(
  data: Readonly<Record<string, unknown>> | null,
): ParsedPreparationDocument | null {
  if (data === null) {
    return Object.freeze({
      saPrepared: false,
      srPrepared: false,
      iLatest: null,
      iPrepared: null,
      cLatest: null,
      cPrepared: null,
    });
  }
  if (
    data.schemaVersion !== 1 ||
    Object.keys(data).some((key) => !supportedPreparationFieldNames.has(key))
  ) {
    return null;
  }
  const saPrepared = data.saPrepared;
  const srPrepared = data.srPrepared;
  if (
    (saPrepared !== undefined && typeof saPrepared !== "boolean") ||
    (srPrepared !== undefined && typeof srPrepared !== "boolean")
  ) {
    return null;
  }
  const iLatest = parseInvitationAssociation(
    data,
    preparationFields.I.latestId,
    preparationFields.I.latestExpiry,
  );
  const iPrepared = parseInvitationAssociation(
    data,
    preparationFields.I.preparedId,
    preparationFields.I.preparedExpiry,
  );
  const cLatest = parseInvitationAssociation(
    data,
    preparationFields.C.latestId,
    preparationFields.C.latestExpiry,
  );
  const cPrepared = parseInvitationAssociation(
    data,
    preparationFields.C.preparedId,
    preparationFields.C.preparedExpiry,
  );
  if (
    iLatest === undefined ||
    iPrepared === undefined ||
    cLatest === undefined ||
    cPrepared === undefined
  ) {
    return null;
  }
  const associations = [iLatest, iPrepared, cLatest, cPrepared];
  for (let index = 0; index < associations.length; index += 1) {
    const association = associations[index];
    if (association === null) {
      continue;
    }
    for (let otherIndex = index + 1;
      otherIndex < associations.length;
      otherIndex += 1) {
      const other = associations[otherIndex];
      if (
        other !== null &&
        association.id === other.id &&
        association.expiresAtMillis !== other.expiresAtMillis
      ) {
        return null;
      }
    }
  }
  if (
    (iLatest !== null && cLatest !== null && iLatest.id === cLatest.id) ||
    (iLatest !== null && cPrepared !== null && iLatest.id === cPrepared.id) ||
    (iPrepared !== null && cLatest !== null && iPrepared.id === cLatest.id) ||
    (iPrepared !== null && cPrepared !== null && iPrepared.id === cPrepared.id)
  ) {
    return null;
  }
  return Object.freeze({
    saPrepared: saPrepared === true,
    srPrepared: srPrepared === true,
    iLatest,
    iPrepared,
    cLatest,
    cPrepared,
  });
}

function invitationPrepared(
  association: ParsedInvitationAssociation | null,
  nowMillis: number,
): boolean {
  return association !== null && association.expiresAtMillis > nowMillis;
}

export function unavailableAdminRestaurantQrPreparationProjection():
AdminRestaurantQrPreparationProjection {
  return Object.freeze({
    canonicalCatalogRestaurantId: null,
    i: "unavailable",
    c: "unavailable",
    sa: "unavailable",
    sr: "unavailable",
  });
}

export function projectAdminRestaurantQrPreparation(params: Readonly<{
  catalogRestaurantId: string;
  rawPreparation: Readonly<Record<string, unknown>> | null;
  biteSaverParticipation: BiteSaverParticipationState;
  biteScoreClaim: BiteScoreClaimState;
  ownerPreparedValidation: AdminRestaurantQrPreparedOwnerValidation;
  claimPreparedValidation: AdminRestaurantQrPreparedClaimValidation;
  nowMillis: number;
}>): AdminRestaurantQrPreparationProjection {
  const parsed = parseAdminRestaurantQrPreparationDocument(
    params.rawPreparation,
  );
  if (parsed === null) {
    return Object.freeze({
      canonicalCatalogRestaurantId: params.catalogRestaurantId,
      i: "unavailable",
      c: "unavailable",
      sa: "unavailable",
      sr: "unavailable",
    });
  }
  const claimInvitationStatus = (): AdminRestaurantQrPreparationStatus => {
    if (params.biteScoreClaim === "claimed") {
      return "notRequired";
    }
    if (params.biteScoreClaim === "unavailable") {
      return "unavailable";
    }
    if (params.claimPreparedValidation.state === "unavailable") {
      return "unavailable";
    }
    if (parsed.cPrepared === null) {
      return params.claimPreparedValidation.state === "absent"
        ? "unprepared"
        : "unavailable";
    }
    if (
      params.claimPreparedValidation.state === "absent" ||
      params.claimPreparedValidation.inviteId !== parsed.cPrepared.id
    ) {
      return "unavailable";
    }
    return params.claimPreparedValidation.state === "eligible" &&
        invitationPrepared(parsed.cPrepared, params.nowMillis)
      ? "prepared"
      : "unprepared";
  };
  const ownerInvitationStatus = (): AdminRestaurantQrPreparationStatus => {
    if (params.biteSaverParticipation === "bound") {
      return "notRequired";
    }
    if (params.biteSaverParticipation === "unavailable") {
      return "unavailable";
    }
    const validation = params.ownerPreparedValidation;
    if (validation.state === "unavailable") {
      return "unavailable";
    }
    if (parsed.iPrepared === null) {
      return validation.state === "absent" ? "unprepared" : "unavailable";
    }
    return validation.state === "eligible" &&
        validation.inviteId === parsed.iPrepared.id &&
        invitationPrepared(parsed.iPrepared, params.nowMillis)
      ? "prepared"
      : "unprepared";
  };
  return Object.freeze({
    canonicalCatalogRestaurantId: params.catalogRestaurantId,
    i: ownerInvitationStatus(),
    c: claimInvitationStatus(),
    sa: parsed.saPrepared ? "prepared" : "unprepared",
    sr: parsed.srPrepared ? "prepared" : "unprepared",
  });
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : Object.freeze({});
}

function parseMutationRequest(value: unknown): ParsedMutationRequest {
  const data = readRecord(value);
  const allowedKeys = new Set([
    "catalogRestaurantId",
    "type",
    "prepared",
    "expectedInviteId",
  ]);
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) {
    throw new HttpsError("invalid-argument", "The preparation request is invalid.");
  }
  const catalogRestaurantId = readBiteScoreCatalogRestaurantId(
    data.catalogRestaurantId,
  );
  if (catalogRestaurantId === null) {
    throw new HttpsError(
      "invalid-argument",
      "A canonical BiteScore restaurant ID is required.",
    );
  }
  const type = data.type;
  if (
    typeof type !== "string" ||
    !adminRestaurantQrPreparationTypes.includes(
      type as AdminRestaurantQrPreparationType,
    )
  ) {
    throw new HttpsError("invalid-argument", "The preparation type is invalid.");
  }
  if (typeof data.prepared !== "boolean") {
    throw new HttpsError(
      "invalid-argument",
      "The preparation value is invalid.",
    );
  }
  const hasExpectedInviteId = Object.prototype.hasOwnProperty.call(
    data,
    "expectedInviteId",
  );
  const expectedInviteId = hasExpectedInviteId
    ? safeDocumentId(data.expectedInviteId)
    : null;
  if (hasExpectedInviteId && expectedInviteId === null) {
    throw new HttpsError(
      "invalid-argument",
      "The invitation reference is invalid.",
    );
  }
  if ((type === "SA" || type === "SR") && hasExpectedInviteId) {
    throw new HttpsError(
      "invalid-argument",
      "Customer preparation must not include an invitation reference.",
    );
  }
  if (!data.prepared && hasExpectedInviteId) {
    throw new HttpsError(
      "invalid-argument",
      "Unchecking preparation must not include an invitation reference.",
    );
  }
  return Object.freeze({
    catalogRestaurantId,
    type: type as AdminRestaurantQrPreparationType,
    prepared: data.prepared,
    expectedInviteId,
  });
}

function biteSaverParticipationState(
  restaurantDocumentId: string,
  restaurantData: Readonly<Record<string, unknown>>,
  catalogRestaurantId: string,
  accounts: readonly AdminRestaurantQrPreparationStoredDocument[],
): BiteSaverParticipationState {
  const catalogBinding = biteScoreCatalogBindingState(restaurantData);
  let reciprocalBindingVerified = false;
  if (catalogBinding.type === "unbound") {
    reciprocalBindingVerified = accounts.length === 0;
  } else if (catalogBinding.type === "bound" && accounts.length === 1) {
    const accountBinding = biteSaverAccountCatalogBindingState(
      accounts[0].data,
    );
    reciprocalBindingVerified = accountBinding.type === "bound" &&
      accountBinding.biteScoreCatalogRestaurantId === catalogRestaurantId &&
      accountBinding.biteSaverCatalogBindingId ===
        catalogBinding.biteSaverCatalogBindingId;
  }
  return biteSaverCatalogBindingAdminState(
    restaurantDocumentId,
    restaurantData,
    reciprocalBindingVerified,
  );
}

export function biteScoreClaimInvitationIsInCurrentEpoch(
  restaurantData: Readonly<Record<string, unknown>>,
  inviteData: Readonly<Record<string, unknown>>,
): boolean {
  const inviteCreatedAt = inviteData.createdAt;
  if (timestampParts(inviteCreatedAt) === null) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(
    restaurantData,
    biteScoreClaimInvitationEpochAtField,
  )) {
    return true;
  }
  return timestampIsAfter(
    inviteCreatedAt,
    restaurantData[biteScoreClaimInvitationEpochAtField],
  );
}

export function biteScoreClaimInvitationEpochIsValid(
  restaurantData: Readonly<Record<string, unknown>>,
): boolean {
  return !Object.prototype.hasOwnProperty.call(
    restaurantData,
    biteScoreClaimInvitationEpochAtField,
  ) || timestampParts(
    restaurantData[biteScoreClaimInvitationEpochAtField],
  ) !== null;
}

function biteScoreClaimState(
  restaurantData: Readonly<Record<string, unknown>>,
): BiteScoreClaimState {
  const projection = biteScoreRestaurantClaimProjection(restaurantData);
  if (
    !biteScoreRestaurantIsActive(restaurantData) ||
    !projection.claimStateValid
  ) {
    return "unavailable";
  }
  if (projection.isClaimed && !projection.claimAvailable) {
    return "claimed";
  }
  if (!projection.isClaimed && projection.claimAvailable) {
    return "available";
  }
  return "unavailable";
}

function requireApplicable(
  type: AdminRestaurantQrPreparationType,
  biteSaverState: BiteSaverParticipationState,
  claimState: BiteScoreClaimState,
): void {
  if (
    (type === "I" && biteSaverState !== "unbound") ||
    (type === "C" && claimState !== "available")
  ) {
    throw new HttpsError(
      "failed-precondition",
      "This preparation type is not currently available.",
    );
  }
}

function validInvitationExpiresAt(params: Readonly<{
  type: "I" | "C";
  inviteId: string;
  inviteData: Readonly<Record<string, unknown>>;
  catalogRestaurantId: string;
  restaurantData: Readonly<Record<string, unknown>>;
  nowMillis: number;
}>): number | null {
  const expectedType = params.type === "I"
    ? "coupon_invite"
    : "bitescore_claim_invite";
  const expectedSide = params.type === "I" ? "coupon" : "bitescore";
  const identityMatches = params.type === "I"
    ? params.inviteData[biteScoreCatalogRestaurantIdField] ===
      params.catalogRestaurantId &&
      params.inviteData.restaurantId === null &&
      params.inviteData.pendingRestaurantKey === `pending_${params.inviteId}`
    : params.inviteData.restaurantId === params.catalogRestaurantId;
  const expiresAtMillis = timestampMillis(params.inviteData.expiresAt);
  if (
    params.inviteData.type !== expectedType ||
    params.inviteData.side !== expectedSide ||
    !identityMatches ||
    params.inviteData.status !== "active" ||
    params.inviteData.maxUses !== 1 ||
    params.inviteData.useCount !== 0 ||
    params.inviteData.usedAt !== null ||
    params.inviteData.usedByUid !== null ||
    params.inviteData.usedByEmail !== null ||
    params.inviteData.revokedAt !== null ||
    params.inviteData.revokedByUid !== null ||
    (params.type === "C" &&
      !biteScoreClaimInvitationIsInCurrentEpoch(
        params.restaurantData,
        params.inviteData,
      )) ||
    expiresAtMillis === null ||
    expiresAtMillis <= params.nowMillis
  ) {
    return null;
  }
  return expiresAtMillis;
}

function requireValidInvitation(params: Parameters<
  typeof validInvitationExpiresAt
>[0]): number {
  const expiresAtMillis = validInvitationExpiresAt(params);
  if (expiresAtMillis === null) {
    throw new HttpsError(
      "failed-precondition",
      "This invitation is no longer valid for preparation.",
    );
  }
  return expiresAtMillis;
}

export function validateAdminRestaurantQrPreparedClaimAssociation(
  params: Readonly<{
    catalogRestaurantId: string;
    rawPreparation: Readonly<Record<string, unknown>> | null;
    restaurantData: Readonly<Record<string, unknown>>;
    invitation: AdminRestaurantQrPreparationStoredDocument | null;
    nowMillis: number;
  }>,
): AdminRestaurantQrPreparedClaimValidation {
  const parsed = parseAdminRestaurantQrPreparationDocument(
    params.rawPreparation,
  );
  if (parsed === null) {
    return Object.freeze({ state: "unavailable", inviteId: null });
  }
  const prepared = parsed.cPrepared;
  if (!biteScoreClaimInvitationEpochIsValid(params.restaurantData)) {
    return Object.freeze({
      state: "unavailable",
      inviteId: prepared?.id ?? null,
    });
  }
  if (prepared === null) {
    return Object.freeze({ state: "absent", inviteId: null });
  }
  if (params.invitation === null || params.invitation.id !== prepared.id) {
    return Object.freeze({ state: "ineligible", inviteId: prepared.id });
  }
  const expiresAtMillis = validInvitationExpiresAt({
    type: "C",
    inviteId: prepared.id,
    inviteData: params.invitation.data,
    catalogRestaurantId: params.catalogRestaurantId,
    restaurantData: params.restaurantData,
    nowMillis: params.nowMillis,
  });
  return Object.freeze({
    state: expiresAtMillis === prepared.expiresAtMillis
      ? "eligible"
      : "ineligible",
    inviteId: prepared.id,
  });
}

export function validateAdminRestaurantQrPreparedOwnerAssociation(
  params: Readonly<{
    catalogRestaurantId: string;
    rawPreparation: Readonly<Record<string, unknown>> | null;
    restaurantData: Readonly<Record<string, unknown>>;
    invitation: AdminRestaurantQrPreparationStoredDocument | null;
    nowMillis: number;
  }>,
): AdminRestaurantQrPreparedOwnerValidation {
  const parsed = parseAdminRestaurantQrPreparationDocument(
    params.rawPreparation,
  );
  if (parsed === null) {
    return Object.freeze({ state: "unavailable", inviteId: null });
  }
  const prepared = parsed.iPrepared;
  if (prepared === null) {
    return Object.freeze({ state: "absent", inviteId: null });
  }
  if (params.invitation === null || params.invitation.id !== prepared.id) {
    return Object.freeze({ state: "ineligible", inviteId: prepared.id });
  }
  const expiresAtMillis = validInvitationExpiresAt({
    type: "I",
    inviteId: prepared.id,
    inviteData: params.invitation.data,
    catalogRestaurantId: params.catalogRestaurantId,
    restaurantData: params.restaurantData,
    nowMillis: params.nowMillis,
  });
  return Object.freeze({
    state: expiresAtMillis === prepared.expiresAtMillis
      ? "eligible"
      : "ineligible",
    inviteId: prepared.id,
  });
}

function patchForMutation(params: Readonly<{
  request: ParsedMutationRequest;
  parsed: ParsedPreparationDocument;
  inviteExpiresAtMillis: number | null;
}>): AdminRestaurantQrPreparationPatch {
  const set: Record<string, unknown> = { schemaVersion: 1 };
  const deleteFields: string[] = [];
  if (params.request.type === "SA") {
    set.saPrepared = params.request.prepared;
  } else if (params.request.type === "SR") {
    set.srPrepared = params.request.prepared;
  } else {
    const fields = preparationFields[params.request.type];
    if (params.request.prepared) {
      const inviteId = params.request.expectedInviteId ??
        (params.request.type === "I"
          ? params.parsed.iLatest?.id
          : params.parsed.cLatest?.id);
      if (inviteId === undefined) {
        throw new HttpsError(
          "failed-precondition",
          "Create a valid invitation before marking this type prepared.",
        );
      }
      set[fields.preparedId] = inviteId;
      set[fields.preparedExpiry] = new Date(params.inviteExpiresAtMillis!);
    } else {
      deleteFields.push(fields.preparedId, fields.preparedExpiry);
    }
  }
  return Object.freeze({
    set: Object.freeze(set),
    deleteFields: Object.freeze(deleteFields),
  });
}

function applyPatch(
  raw: Readonly<Record<string, unknown>> | null,
  patch: AdminRestaurantQrPreparationPatch,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...(raw ?? {}), ...patch.set };
  for (const field of patch.deleteFields) {
    delete result[field];
  }
  return Object.freeze(result);
}

export async function updateAdminRestaurantQrPreparation(
  database: AdminRestaurantQrPreparationDatabase,
  rawRequest: unknown,
  now: Date,
): Promise<AdminRestaurantQrPreparationProjection> {
  const request = parseMutationRequest(rawRequest);
  const nowMillis = now.getTime();
  if (!Number.isFinite(nowMillis)) {
    throw new Error("The preparation clock is invalid.");
  }
  return database.runTransaction(async (transaction) => {
    const restaurantPath =
      `bitescore_restaurants/${request.catalogRestaurantId}`;
    const prepPath = preparationPath(request.catalogRestaurantId);
    const [restaurant, preparation, accounts] = await Promise.all([
      transaction.getDocument(restaurantPath),
      transaction.getDocument(prepPath),
      transaction.queryRestaurantAccounts(request.catalogRestaurantId),
    ]);
    if (restaurant === null) {
      throw new HttpsError(
        "not-found",
        "The canonical BiteScore restaurant was not found.",
      );
    }
    const rawPreparation = preparation?.data ?? null;
    const parsed = parseAdminRestaurantQrPreparationDocument(rawPreparation);
    if (parsed === null) {
      throw new HttpsError(
        "failed-precondition",
        "The stored preparation state is unavailable.",
      );
    }
    if (!biteScoreClaimInvitationEpochIsValid(restaurant.data)) {
      throw new HttpsError(
        "failed-precondition",
        "The BiteScore claim invitation state is unavailable.",
      );
    }
    const biteSaverState = biteSaverParticipationState(
      restaurant.id,
      restaurant.data,
      request.catalogRestaurantId,
      accounts,
    );
    const claimState = biteScoreClaimState(restaurant.data);
    if (request.prepared && (request.type === "I" || request.type === "C")) {
      requireApplicable(request.type, biteSaverState, claimState);
    }

    let inviteExpiresAtMillis: number | null = null;
    let requestInvitation: AdminRestaurantQrPreparationStoredDocument | null =
      null;
    if (request.prepared && (request.type === "I" || request.type === "C")) {
      const inviteId = request.expectedInviteId ??
        (request.type === "I" ? parsed.iLatest?.id : parsed.cLatest?.id);
      if (inviteId === undefined) {
        throw new HttpsError(
          "failed-precondition",
          "Create a valid invitation before marking this type prepared.",
        );
      }
      requestInvitation = await transaction.getDocument(
        `restaurant_invites/${inviteId}`,
      );
      if (requestInvitation === null) {
        throw new HttpsError(
          "failed-precondition",
          "This invitation is no longer valid for preparation.",
        );
      }
      inviteExpiresAtMillis = requireValidInvitation({
        type: request.type,
        inviteId,
        inviteData: requestInvitation.data,
        catalogRestaurantId: request.catalogRestaurantId,
        restaurantData: restaurant.data,
        nowMillis,
      });
    }

    const patch = patchForMutation({ request, parsed, inviteExpiresAtMillis });
    const updated = applyPatch(rawPreparation, patch);
    const updatedParsed = parseAdminRestaurantQrPreparationDocument(updated);
    if (updatedParsed === null) {
      throw new HttpsError(
        "failed-precondition",
        "The updated preparation state is unavailable.",
      );
    }
    let preparedClaimInvitation:
      AdminRestaurantQrPreparationStoredDocument | null = null;
    if (updatedParsed.cPrepared !== null) {
      preparedClaimInvitation = request.prepared && request.type === "C" &&
          requestInvitation?.id === updatedParsed.cPrepared.id
        ? requestInvitation
        : await transaction.getDocument(
            `restaurant_invites/${updatedParsed.cPrepared.id}`,
          );
    }
    let preparedOwnerInvitation:
      AdminRestaurantQrPreparationStoredDocument | null = null;
    if (updatedParsed.iPrepared !== null) {
      preparedOwnerInvitation = request.prepared && request.type === "I" &&
          requestInvitation?.id === updatedParsed.iPrepared.id
        ? requestInvitation
        : await transaction.getDocument(
            `restaurant_invites/${updatedParsed.iPrepared.id}`,
          );
    }
    const ownerPreparedValidation =
      validateAdminRestaurantQrPreparedOwnerAssociation({
        catalogRestaurantId: request.catalogRestaurantId,
        rawPreparation: updated,
        restaurantData: restaurant.data,
        invitation: preparedOwnerInvitation,
        nowMillis,
      });
    const claimPreparedValidation =
      validateAdminRestaurantQrPreparedClaimAssociation({
        catalogRestaurantId: request.catalogRestaurantId,
        rawPreparation: updated,
        restaurantData: restaurant.data,
        invitation: preparedClaimInvitation,
        nowMillis,
      });
    transaction.mergeDocument(prepPath, patch);
    return projectAdminRestaurantQrPreparation({
      catalogRestaurantId: request.catalogRestaurantId,
      rawPreparation: updated,
      biteSaverParticipation: biteSaverState,
      biteScoreClaim: claimState,
      ownerPreparedValidation,
      claimPreparedValidation,
      nowMillis,
    });
  });
}

export async function updateAdminRestaurantQrPreparationCallableHandler(
  request: CallableRequest<unknown>,
  dependencies: AdminRestaurantQrPreparationCallableDependencies,
): Promise<Readonly<{ preparation: AdminRestaurantQrPreparationProjection }>> {
  dependencies.requireAdmin(request);
  const preparation = await updateAdminRestaurantQrPreparation(
    dependencies.database,
    request.data,
    dependencies.now(),
  );
  return Object.freeze({ preparation });
}

export function latestInvitationPreparationPatch(
  rawPreparation: Readonly<Record<string, unknown>> | null,
  type: "I" | "C",
  inviteId: string,
  expiresAt: unknown,
): AdminRestaurantQrPreparationPatch {
  if (parseAdminRestaurantQrPreparationDocument(rawPreparation) === null) {
    throw new HttpsError(
      "failed-precondition",
      "The stored preparation state is unavailable.",
    );
  }
  const safeInviteId = safeDocumentId(inviteId);
  const expiresAtMillis = timestampMillis(expiresAt);
  if (safeInviteId === null || expiresAtMillis === null) {
    throw new Error("The latest invitation preparation reference is invalid.");
  }
  const fields = preparationFields[type];
  return Object.freeze({
    set: Object.freeze({
      schemaVersion: 1,
      [fields.latestId]: safeInviteId,
      [fields.latestExpiry]: new Date(expiresAtMillis),
    }),
    deleteFields: Object.freeze([]),
  });
}

export function terminalInvitationPreparationPatch(
  rawPreparation: Readonly<Record<string, unknown>> | null,
  type: "I" | "C",
  inviteId: string,
): AdminRestaurantQrPreparationPatch | null {
  if (
    rawPreparation === null ||
    parseAdminRestaurantQrPreparationDocument(rawPreparation) === null ||
    safeDocumentId(inviteId) !== inviteId
  ) {
    return null;
  }
  const fields = preparationFields[type];
  const deleteFields: string[] = [];
  if (rawPreparation[fields.latestId] === inviteId) {
    deleteFields.push(fields.latestId, fields.latestExpiry);
  }
  if (rawPreparation[fields.preparedId] === inviteId) {
    deleteFields.push(fields.preparedId, fields.preparedExpiry);
  }
  return deleteFields.length === 0
    ? null
    : Object.freeze({
        set: Object.freeze({ schemaVersion: 1 }),
        deleteFields: Object.freeze(deleteFields),
      });
}

export function isSafeBiteScoreUnclaimTransition(
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null,
): boolean {
  if (before === null || after === null) {
    return false;
  }
  const beforeIsStrictlyClaimed = before.isClaimed === true &&
    typeof before.ownerUserId === "string" &&
    before.ownerUserId.trim().length > 0;
  const afterHasIsClaimed = Object.prototype.hasOwnProperty.call(
    after,
    "isClaimed",
  );
  const afterHasOwnerUserId = Object.prototype.hasOwnProperty.call(
    after,
    "ownerUserId",
  );
  const afterIsStrictlyUnclaimed =
    (!afterHasIsClaimed || after.isClaimed === false) &&
    (!afterHasOwnerUserId ||
      after.ownerUserId === null ||
      after.ownerUserId === "");
  return beforeIsStrictlyClaimed &&
    afterIsStrictlyUnclaimed &&
    Object.prototype.hasOwnProperty.call(
      after,
      biteScoreClaimInvitationEpochAtField,
    ) &&
    timestampParts(after[biteScoreClaimInvitationEpochAtField]) !== null;
}

export async function clearClaimPreparationAfterUnclaim(
  database: AdminRestaurantQrPreparationDatabase,
  catalogRestaurantId: string,
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null,
  transitionAt: unknown,
): Promise<boolean> {
  const safeCatalogRestaurantId = readBiteScoreCatalogRestaurantId(
    catalogRestaurantId,
  );
  if (
    safeCatalogRestaurantId === null ||
    !isSafeBiteScoreUnclaimTransition(before, after)
  ) {
    return false;
  }
  if (timestampParts(transitionAt) === null) {
    throw new Error("The BiteScore unclaim transition time is invalid.");
  }
  if (!timestampsAreEqual(
    after?.[biteScoreClaimInvitationEpochAtField],
    transitionAt,
  )) {
    return false;
  }
  return database.runTransaction(async (transaction) => {
    const path = preparationPath(safeCatalogRestaurantId);
    const preparation = await transaction.getDocument(path);
    if (preparation === null) {
      return false;
    }
    if (parseAdminRestaurantQrPreparationDocument(preparation.data) === null) {
      return false;
    }
    const fields = preparationFields.C;
    const associations = [
      Object.freeze({id: fields.latestId, expiry: fields.latestExpiry}),
      Object.freeze({id: fields.preparedId, expiry: fields.preparedExpiry}),
    ];
    const invitationIds = [
      ...new Set(
        associations
          .map((association) =>
            safeDocumentId(preparation.data[association.id]))
          .filter((id): id is string => id !== null),
      ),
    ];
    const invitations = await Promise.all(
      invitationIds.map((id) =>
        transaction.getDocument(`restaurant_invites/${id}`)),
    );
    const invitationsById = new Map(
      invitations
        .filter(
          (invitation): invitation is AdminRestaurantQrPreparationStoredDocument =>
            invitation !== null,
        )
        .map((invitation) => [invitation.id, invitation]),
    );
    const deleteFields: string[] = [];
    for (const association of associations) {
      const hasAssociation =
        Object.prototype.hasOwnProperty.call(preparation.data, association.id) ||
        Object.prototype.hasOwnProperty.call(
          preparation.data,
          association.expiry,
        );
      if (!hasAssociation) {
        continue;
      }
      const inviteId = safeDocumentId(preparation.data[association.id]);
      const invitation = inviteId === null
        ? null
        : invitationsById.get(inviteId) ?? null;
      const identity = inviteId === null || invitation === null
        ? null
        : invitationPreparationIdentity(inviteId, invitation.data);
      const isFreshClaimInvite = identity?.type === "C" &&
        identity.catalogRestaurantId === safeCatalogRestaurantId &&
        timestampIsAfter(invitation?.data.createdAt, transitionAt);
      if (!isFreshClaimInvite) {
        deleteFields.push(association.id, association.expiry);
      }
    }
    if (deleteFields.length === 0) {
      return false;
    }
    transaction.mergeDocument(path, Object.freeze({
      set: Object.freeze({ schemaVersion: 1 }),
      deleteFields: Object.freeze(deleteFields),
    }));
    return true;
  });
}

export function invitationPreparationIdentity(
  inviteId: string,
  inviteData: Readonly<Record<string, unknown>>,
): Readonly<{
  catalogRestaurantId: string;
  type: "I" | "C";
}> | null {
  const safeInviteId = safeDocumentId(inviteId);
  if (safeInviteId === null) {
    return null;
  }
  if (
    inviteData.type === "coupon_invite" &&
    inviteData.side === "coupon" &&
    inviteData.restaurantId === null &&
    inviteData.pendingRestaurantKey === `pending_${safeInviteId}`
  ) {
    const catalogRestaurantId = readBiteScoreCatalogRestaurantId(
      inviteData[biteScoreCatalogRestaurantIdField],
    );
    return catalogRestaurantId === null
      ? null
      : Object.freeze({ catalogRestaurantId, type: "I" });
  }
  if (
    inviteData.type === "bitescore_claim_invite" &&
    inviteData.side === "bitescore"
  ) {
    const catalogRestaurantId = readBiteScoreCatalogRestaurantId(
      inviteData.restaurantId,
    );
    return catalogRestaurantId === null
      ? null
      : Object.freeze({ catalogRestaurantId, type: "C" });
  }
  return null;
}

export function firestoreAdminRestaurantQrPreparationPatch(
  patch: AdminRestaurantQrPreparationPatch,
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...patch.set };
  for (const field of patch.deleteFields) {
    data[field] = FieldValue.delete();
  }
  return data;
}

function firestoreTransactionBoundary(
  database: Firestore,
  transaction: Transaction,
): AdminRestaurantQrPreparationTransaction {
  return {
    async getDocument(path) {
      const snapshot = await transaction.get(database.doc(path));
      return snapshot.exists
        ? Object.freeze({
            id: snapshot.id,
            data: snapshot.data() as Readonly<Record<string, unknown>>,
          })
        : null;
    },
    async queryRestaurantAccounts(catalogRestaurantId) {
      const query: Query<DocumentData, DocumentData> = database
        .collection("restaurant_accounts")
        .where(
          biteScoreCatalogRestaurantIdField,
          "==",
          catalogRestaurantId,
        )
        .limit(2);
      const snapshot = await transaction.get(query);
      return Object.freeze(snapshot.docs.map((document) => Object.freeze({
        id: document.id,
        data: document.data() as Readonly<Record<string, unknown>>,
      })));
    },
    mergeDocument(path, patch) {
      transaction.set(
        database.doc(path),
        firestoreAdminRestaurantQrPreparationPatch(patch),
        { merge: true },
      );
    },
  };
}

export function createFirestoreAdminRestaurantQrPreparationDatabase(
  database: Firestore,
): AdminRestaurantQrPreparationDatabase {
  return {
    runTransaction(operation) {
      return database.runTransaction((transaction) =>
        operation(firestoreTransactionBoundary(database, transaction))
      );
    },
    async getPreparationDocuments(catalogRestaurantIds) {
      const uniqueIds = [...new Set(catalogRestaurantIds)];
      if (uniqueIds.length === 0) {
        return new Map();
      }
      const snapshots = await database.getAll(
        ...uniqueIds.map((id) => database.doc(preparationPath(id))),
      );
      const documents = new Map<
        string,
        Readonly<Record<string, unknown>>
      >();
      for (const snapshot of snapshots) {
        if (snapshot.exists) {
          documents.set(
            snapshot.id,
            snapshot.data() as Readonly<Record<string, unknown>>,
          );
        }
      }
      return documents;
    },
  };
}
