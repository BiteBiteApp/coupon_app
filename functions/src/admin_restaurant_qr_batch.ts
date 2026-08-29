import type { Firestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import {
  adminRestaurantBiteSaverParticipationState,
  adminRestaurantBiteScoreClaimState,
  type AdminRestaurantQrPreparationDatabase,
  type AdminRestaurantQrPreparationPatch,
  type AdminRestaurantQrPreparationProjection,
  type AdminRestaurantQrPreparationStoredDocument,
  type AdminRestaurantQrPreparationType,
  applyAdminRestaurantQrPreparationPatch,
  biteScoreClaimInvitationEpochIsValid,
  createFirestoreAdminRestaurantQrPreparationDatabase,
  latestInvitationPreparationPatch,
  parseAdminRestaurantQrPreparationDocument,
  preparedAdminRestaurantQrPreparationPatch,
  projectAdminRestaurantQrPreparation,
  validAdminRestaurantQrInvitationExpiresAt,
  validateAdminRestaurantQrPreparedClaimAssociation,
  validateAdminRestaurantQrPreparedOwnerAssociation,
} from "./admin_restaurant_qr_preparation.js";
import {
  buildBiteScoreRestaurantClaimInviteDocument,
  buildCouponRestaurantInviteDocument,
  couponInviteRestaurantIdentity,
  generateInviteToken,
  hashInviteToken,
  inviteLink,
  readBiteScoreCatalogRestaurantId,
  restaurantCustomerLink,
} from "./restaurant_invite_helpers.js";
import {
  biteScoreBiteSaverCatalogProfile,
  type BiteScoreBiteSaverCatalogProfile,
} from "./search_index_builders.js";

export const adminRestaurantQrBatchSchemaVersion = 1 as const;
export const maximumAdminRestaurantQrBatchRestaurants = 25 as const;
export const maximumAdminRestaurantQrBatchLabels = 100 as const;
export const maximumAdminRestaurantQrBatchConcurrency = 4 as const;

const restaurantInviteCollection = "restaurant_invites" as const;
const destructiveRestaurantOperationLockCollection =
  "private_rating_restaurant_operation_locks" as const;
const invitationExpirationMillis = 90 * 24 * 60 * 60 * 1_000;

type AdminAuthorization = Readonly<{ uid: string; email: string }>;

type ParsedPrepareRequest = Readonly<{
  catalogRestaurantIds: readonly string[];
}>;

type ParsedMarkLabel = Readonly<{
  type: AdminRestaurantQrPreparationType;
  invitationId: string | null;
}>;

type ParsedMarkRestaurant = Readonly<{
  catalogRestaurantId: string;
  labels: readonly ParsedMarkLabel[];
}>;

type ParsedMarkRequest = Readonly<{
  restaurants: readonly ParsedMarkRestaurant[];
}>;

export type AdminRestaurantQrBatchReadyLabel = Readonly<{
  type: AdminRestaurantQrPreparationType;
  payloadUrl: string;
  invitationId?: string;
  invitationExpiresAtMillis?: number;
}>;

export type AdminRestaurantQrBatchPreparationResult =
  | Readonly<{
    catalogRestaurantId: string;
    outcome: "ready";
    restaurantName: string;
    labels: readonly AdminRestaurantQrBatchReadyLabel[];
  }>
  | Readonly<{
    catalogRestaurantId: string;
    outcome: "unavailable" | "failed";
    code: string;
    message: string;
  }>;

export type AdminRestaurantQrBatchMarkTypeResult = Readonly<{
  type: AdminRestaurantQrPreparationType;
  status: "saved" | "notRequired" | "failed";
  alreadySaved?: boolean;
  code?: string;
  message?: string;
}>;

export type AdminRestaurantQrBatchMarkResult = Readonly<{
  catalogRestaurantId: string;
  outcome: "processed" | "partialFailure" | "failed";
  labels: readonly AdminRestaurantQrBatchMarkTypeResult[];
  preparation?: AdminRestaurantQrPreparationProjection;
}>;

export interface AdminRestaurantQrBatchDatabase
  extends AdminRestaurantQrPreparationDatabase {
  allocateRestaurantInviteId(): string;
}

export type AdminRestaurantQrBatchCallableDependencies = Readonly<{
  database: AdminRestaurantQrBatchDatabase;
  requireAdmin: (
    request: CallableRequest<unknown>,
  ) => AdminAuthorization;
  now: () => Date;
  serverTimestamp: () => unknown;
}>;

type AllocatedInvitation = Readonly<{
  id: string;
  token: string;
  tokenHash: string;
  createdAt: unknown;
}>;

type AllocatedRestaurantInvitations = Readonly<{
  I: AllocatedInvitation;
  C: AllocatedInvitation;
  expiresAt: Date;
}>;

class ControlledRestaurantError extends Error {
  constructor(
    readonly resultCode: string,
    message: string,
  ) {
    super(message);
    this.name = "ControlledRestaurantError";
  }
}

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

function parsePrepareRequest(value: unknown): ParsedPrepareRequest {
  const data = readRecord(value);
  if (
    data === null ||
    !hasExactKeys(data, ["schemaVersion", "catalogRestaurantIds"]) ||
    data.schemaVersion !== adminRestaurantQrBatchSchemaVersion ||
    !Array.isArray(data.catalogRestaurantIds) ||
    data.catalogRestaurantIds.length === 0 ||
    data.catalogRestaurantIds.length > maximumAdminRestaurantQrBatchRestaurants
  ) {
    invalidRequest("The batch preparation request is invalid.");
  }
  const catalogRestaurantIds: string[] = [];
  const seen = new Set<string>();
  for (const value of data.catalogRestaurantIds) {
    const catalogRestaurantId = readBiteScoreCatalogRestaurantId(value);
    if (catalogRestaurantId === null || seen.has(catalogRestaurantId)) {
      invalidRequest("The batch preparation restaurant IDs are invalid.");
    }
    seen.add(catalogRestaurantId);
    catalogRestaurantIds.push(catalogRestaurantId);
  }
  return Object.freeze({
    catalogRestaurantIds: Object.freeze(catalogRestaurantIds),
  });
}

function parseMarkLabel(value: unknown): ParsedMarkLabel {
  const data = readRecord(value);
  if (data === null || typeof data.type !== "string") {
    invalidRequest("A batch marking label is invalid.");
  }
  if (data.type === "I" || data.type === "C") {
    if (!hasExactKeys(data, ["type", "invitationId"])) {
      invalidRequest("Invitation labels require one exact invitation ID.");
    }
    const invitationId = readBiteScoreCatalogRestaurantId(data.invitationId);
    if (invitationId === null) {
      invalidRequest("A batch marking invitation ID is invalid.");
    }
    return Object.freeze({ type: data.type, invitationId });
  }
  if (data.type === "SA" || data.type === "SR") {
    if (!hasExactKeys(data, ["type"])) {
      invalidRequest("Customer labels must not include an invitation ID.");
    }
    return Object.freeze({ type: data.type, invitationId: null });
  }
  invalidRequest("A batch marking label type is unsupported.");
}

function parseMarkRequest(value: unknown): ParsedMarkRequest {
  const data = readRecord(value);
  if (
    data === null ||
    !hasExactKeys(data, ["schemaVersion", "restaurants"]) ||
    data.schemaVersion !== adminRestaurantQrBatchSchemaVersion ||
    !Array.isArray(data.restaurants) ||
    data.restaurants.length === 0 ||
    data.restaurants.length > maximumAdminRestaurantQrBatchRestaurants
  ) {
    invalidRequest("The batch marking request is invalid.");
  }
  const restaurants: ParsedMarkRestaurant[] = [];
  const seenRestaurants = new Set<string>();
  let labelCount = 0;
  for (const value of data.restaurants) {
    const group = readRecord(value);
    if (
      group === null ||
      !hasExactKeys(group, ["catalogRestaurantId", "labels"]) ||
      !Array.isArray(group.labels) ||
      group.labels.length === 0 ||
      group.labels.length > 4
    ) {
      invalidRequest("A batch marking restaurant group is invalid.");
    }
    const catalogRestaurantId = readBiteScoreCatalogRestaurantId(
      group.catalogRestaurantId,
    );
    if (
      catalogRestaurantId === null ||
      seenRestaurants.has(catalogRestaurantId)
    ) {
      invalidRequest("The batch marking restaurant IDs are invalid.");
    }
    seenRestaurants.add(catalogRestaurantId);
    const labels = group.labels.map(parseMarkLabel);
    const seenTypes = new Set<AdminRestaurantQrPreparationType>();
    for (const label of labels) {
      if (seenTypes.has(label.type)) {
        invalidRequest("A batch marking restaurant has a duplicate label type.");
      }
      seenTypes.add(label.type);
    }
    labelCount += labels.length;
    if (labelCount > maximumAdminRestaurantQrBatchLabels) {
      invalidRequest("The batch marking request has too many labels.");
    }
    restaurants.push(Object.freeze({
      catalogRestaurantId,
      labels: Object.freeze(labels),
    }));
  }
  return Object.freeze({ restaurants: Object.freeze(restaurants) });
}

async function mapWithConcurrency<T, R>(
  inputs: readonly T[],
  operation: (input: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(inputs.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(inputs[index], index);
    }
  };
  const workers = Array.from(
    {
      length: Math.min(
        maximumAdminRestaurantQrBatchConcurrency,
        inputs.length,
      ),
    },
    () => worker(),
  );
  await Promise.all(workers);
  return Object.freeze(results);
}

function combinePatches(
  patches: readonly AdminRestaurantQrPreparationPatch[],
): AdminRestaurantQrPreparationPatch {
  const set: Record<string, unknown> = {};
  const deleteFields: string[] = [];
  for (const patch of patches) {
    Object.assign(set, patch.set);
    deleteFields.push(...patch.deleteFields);
  }
  return Object.freeze({
    set: Object.freeze(set),
    deleteFields: Object.freeze([...new Set(deleteFields)]),
  });
}

function couponPrefill(
  profile: BiteScoreBiteSaverCatalogProfile,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    restaurantName: profile.restaurantName,
    streetAddress: profile.streetAddress,
    city: profile.city,
    state: profile.state,
    zipCode: profile.zipCode,
    phone: profile.phone,
    website: profile.website,
    latitude: profile.latitude,
    longitude: profile.longitude,
  });
}

function controlledFailure(
  catalogRestaurantId: string,
  error: unknown,
): AdminRestaurantQrBatchPreparationResult {
  if (error instanceof ControlledRestaurantError) {
    return Object.freeze({
      catalogRestaurantId,
      outcome: "unavailable",
      code: error.resultCode,
      message: error.message,
    });
  }
  return Object.freeze({
    catalogRestaurantId,
    outcome: "failed",
    code: "transaction_failed",
    message: "The restaurant could not be prepared. Retry this restaurant.",
  });
}

function requireFoundAuthority(params: Readonly<{
  catalogRestaurantId: string;
  lock: AdminRestaurantQrPreparationStoredDocument | null;
  restaurant: AdminRestaurantQrPreparationStoredDocument | null;
  preparation: AdminRestaurantQrPreparationStoredDocument | null;
  accounts: readonly AdminRestaurantQrPreparationStoredDocument[];
}>): Readonly<{
  restaurantData: Readonly<Record<string, unknown>>;
  rawPreparation: Readonly<Record<string, unknown>> | null;
  biteSaverParticipation: "unbound" | "bound";
  biteScoreClaim: "available" | "claimed";
  profile: BiteScoreBiteSaverCatalogProfile;
}> {
  if (params.lock !== null) {
    throw new ControlledRestaurantError(
      "restaurant_locked",
      "The restaurant is temporarily unavailable.",
    );
  }
  if (params.restaurant === null) {
    throw new ControlledRestaurantError(
      "restaurant_not_found",
      "The canonical restaurant was not found.",
    );
  }
  const rawPreparation = params.preparation?.data ?? null;
  if (parseAdminRestaurantQrPreparationDocument(rawPreparation) === null) {
    throw new ControlledRestaurantError(
      "preparation_state_unavailable",
      "The stored preparation state is unavailable.",
    );
  }
  if (!biteScoreClaimInvitationEpochIsValid(params.restaurant.data)) {
    throw new ControlledRestaurantError(
      "claim_epoch_unavailable",
      "The claim invitation state is unavailable.",
    );
  }
  const biteSaverParticipation =
    adminRestaurantBiteSaverParticipationState(
      params.restaurant.id,
      params.restaurant.data,
      params.catalogRestaurantId,
      params.accounts,
    );
  if (biteSaverParticipation === "unavailable") {
    throw new ControlledRestaurantError(
      "restaurant_state_unavailable",
      "The restaurant profile or BiteSaver binding is unavailable.",
    );
  }
  const biteScoreClaim = adminRestaurantBiteScoreClaimState(
    params.restaurant.data,
  );
  if (biteScoreClaim === "unavailable") {
    throw new ControlledRestaurantError(
      "claim_state_unavailable",
      "The BiteScore claim state is unavailable.",
    );
  }
  const profile = biteScoreBiteSaverCatalogProfile(params.restaurant.data);
  if (profile === null) {
    throw new ControlledRestaurantError(
      "restaurant_profile_unavailable",
      "The restaurant profile is unavailable.",
    );
  }
  return Object.freeze({
    restaurantData: params.restaurant.data,
    rawPreparation,
    biteSaverParticipation,
    biteScoreClaim,
    profile,
  });
}

function allocateInvitations(
  database: AdminRestaurantQrBatchDatabase,
  nowMillis: number,
  serverTimestamp: () => unknown,
): AllocatedRestaurantInvitations {
  const allocate = (): AllocatedInvitation => {
    const token = generateInviteToken();
    return Object.freeze({
      id: database.allocateRestaurantInviteId(),
      token,
      tokenHash: hashInviteToken(token),
      createdAt: serverTimestamp(),
    });
  };
  return Object.freeze({
    I: allocate(),
    C: allocate(),
    expiresAt: new Date(nowMillis + invitationExpirationMillis),
  });
}

async function prepareRestaurant(
  database: AdminRestaurantQrBatchDatabase,
  catalogRestaurantId: string,
  allocated: AllocatedRestaurantInvitations,
  admin: AdminAuthorization,
): Promise<AdminRestaurantQrBatchPreparationResult> {
  try {
    return await database.runTransaction(async (transaction) => {
      const [lock, restaurant, preparation, accounts] = await Promise.all([
        transaction.getDocument(
          `${destructiveRestaurantOperationLockCollection}/${
            catalogRestaurantId
          }`,
        ),
        transaction.getDocument(
          `bitescore_restaurants/${catalogRestaurantId}`,
        ),
        transaction.getDocument(
          `private_admin_restaurant_qr_preparation/${catalogRestaurantId}`,
        ),
        transaction.queryRestaurantAccounts(catalogRestaurantId),
      ]);
      const authority = requireFoundAuthority({
        catalogRestaurantId,
        lock,
        restaurant,
        preparation,
        accounts,
      });
      const labels: AdminRestaurantQrBatchReadyLabel[] = [];
      const invitationWrites: Readonly<{
        path: string;
        data: Readonly<Record<string, unknown>>;
      }>[] = [];
      const preparationPatches: AdminRestaurantQrPreparationPatch[] = [];

      if (authority.biteSaverParticipation === "unbound") {
        const identity = couponInviteRestaurantIdentity(null, allocated.I.id);
        invitationWrites.push(Object.freeze({
          path: `${restaurantInviteCollection}/${allocated.I.id}`,
          data: buildCouponRestaurantInviteDocument({
            tokenHash: allocated.I.tokenHash,
            actor: admin,
            createdAt: allocated.I.createdAt,
            expiresAt: allocated.expiresAt,
            restaurantId: identity.restaurantId,
            pendingRestaurantKey: identity.pendingRestaurantKey,
            catalogRestaurantId,
            restaurantName: authority.profile.restaurantName,
            couponPrefill: couponPrefill(authority.profile),
          }),
        }));
        preparationPatches.push(latestInvitationPreparationPatch(
          authority.rawPreparation,
          "I",
          allocated.I.id,
          allocated.expiresAt,
        ));
        labels.push(Object.freeze({
          type: "I",
          payloadUrl: inviteLink("coupon", allocated.I.token),
          invitationId: allocated.I.id,
          invitationExpiresAtMillis: allocated.expiresAt.getTime(),
        }));
      }
      if (authority.biteScoreClaim === "available") {
        invitationWrites.push(Object.freeze({
          path: `${restaurantInviteCollection}/${allocated.C.id}`,
          data: buildBiteScoreRestaurantClaimInviteDocument({
            tokenHash: allocated.C.tokenHash,
            actor: admin,
            createdAt: allocated.C.createdAt,
            expiresAt: allocated.expiresAt,
            catalogRestaurantId,
            restaurantName: authority.profile.restaurantName,
            restaurantAddressSummary: [
              authority.profile.streetAddress,
              authority.profile.city,
              authority.profile.state,
              authority.profile.zipCode,
            ].join(", "),
          }),
        }));
        preparationPatches.push(latestInvitationPreparationPatch(
          authority.rawPreparation,
          "C",
          allocated.C.id,
          allocated.expiresAt,
        ));
        labels.push(Object.freeze({
          type: "C",
          payloadUrl: inviteLink("bitescore", allocated.C.token),
          invitationId: allocated.C.id,
          invitationExpiresAtMillis: allocated.expiresAt.getTime(),
        }));
      }
      labels.push(
        Object.freeze({
          type: "SA",
          payloadUrl: restaurantCustomerLink("coupons", catalogRestaurantId),
        }),
        Object.freeze({
          type: "SR",
          payloadUrl: restaurantCustomerLink("bitescore", catalogRestaurantId),
        }),
      );

      for (const write of invitationWrites) {
        transaction.createDocument(write.path, write.data);
      }
      if (preparationPatches.length > 0) {
        transaction.mergeDocument(
          `private_admin_restaurant_qr_preparation/${catalogRestaurantId}`,
          combinePatches(preparationPatches),
        );
      }
      return Object.freeze({
        catalogRestaurantId,
        outcome: "ready" as const,
        restaurantName: authority.profile.restaurantName,
        labels: Object.freeze(labels),
      });
    });
  } catch (error) {
    return controlledFailure(catalogRestaurantId, error);
  }
}

function invitationById(
  invitations: ReadonlyMap<string, AdminRestaurantQrPreparationStoredDocument>,
  invitationId: string | null | undefined,
): AdminRestaurantQrPreparationStoredDocument | null {
  return invitationId === null || invitationId === undefined
    ? null
    : invitations.get(invitationId) ?? null;
}

function failedMarkResult(
  group: ParsedMarkRestaurant,
  code: string,
  message: string,
): AdminRestaurantQrBatchMarkResult {
  return Object.freeze({
    catalogRestaurantId: group.catalogRestaurantId,
    outcome: "failed",
    labels: Object.freeze(group.labels.map((label) => Object.freeze({
      type: label.type,
      status: "failed" as const,
      code,
      message,
    }))),
  });
}

async function markRestaurant(
  database: AdminRestaurantQrBatchDatabase,
  group: ParsedMarkRestaurant,
  nowMillis: number,
): Promise<AdminRestaurantQrBatchMarkResult> {
  try {
    return await database.runTransaction(async (transaction) => {
      const catalogRestaurantId = group.catalogRestaurantId;
      const [lock, restaurant, preparation, accounts] = await Promise.all([
        transaction.getDocument(
          `${destructiveRestaurantOperationLockCollection}/${
            catalogRestaurantId
          }`,
        ),
        transaction.getDocument(
          `bitescore_restaurants/${catalogRestaurantId}`,
        ),
        transaction.getDocument(
          `private_admin_restaurant_qr_preparation/${catalogRestaurantId}`,
        ),
        transaction.queryRestaurantAccounts(catalogRestaurantId),
      ]);
      const authority = requireFoundAuthority({
        catalogRestaurantId,
        lock,
        restaurant,
        preparation,
        accounts,
      });
      const parsed = parseAdminRestaurantQrPreparationDocument(
        authority.rawPreparation,
      )!;
      const invitationIds = new Set<string>();
      for (const label of group.labels) {
        if (label.invitationId !== null) {
          invitationIds.add(label.invitationId);
        }
      }
      if (parsed.iPrepared !== null) {
        invitationIds.add(parsed.iPrepared.id);
      }
      if (parsed.cPrepared !== null) {
        invitationIds.add(parsed.cPrepared.id);
      }
      const invitationDocuments = await Promise.all(
        [...invitationIds].map((invitationId) =>
          transaction.getDocument(
            `${restaurantInviteCollection}/${invitationId}`,
          )),
      );
      const invitations = new Map<
        string,
        AdminRestaurantQrPreparationStoredDocument
      >();
      for (const invitation of invitationDocuments) {
        if (invitation !== null) {
          invitations.set(invitation.id, invitation);
        }
      }

      const marks: Readonly<{
        type: AdminRestaurantQrPreparationType;
        invitationId: string | null;
        invitationExpiresAtMillis: number | null;
      }>[] = [];
      const labelResults: AdminRestaurantQrBatchMarkTypeResult[] = [];
      for (const label of group.labels) {
        const notRequired =
          (label.type === "I" &&
            authority.biteSaverParticipation === "bound") ||
          (label.type === "C" && authority.biteScoreClaim === "claimed");
        if (notRequired) {
          labelResults.push(Object.freeze({
            type: label.type,
            status: "notRequired",
          }));
          continue;
        }
        if (label.type === "I" || label.type === "C") {
          const invitation = invitationById(invitations, label.invitationId);
          const expiresAtMillis = invitation === null
            ? null
            : validAdminRestaurantQrInvitationExpiresAt({
                type: label.type,
                inviteId: label.invitationId!,
                inviteData: invitation.data,
                catalogRestaurantId,
                restaurantData: authority.restaurantData,
                nowMillis,
              });
          if (expiresAtMillis === null) {
            labelResults.push(Object.freeze({
              type: label.type,
              status: "failed",
              code: "invitation_invalid",
              message: "The represented invitation is no longer valid.",
            }));
            continue;
          }
          const existing = label.type === "I"
            ? parsed.iPrepared
            : parsed.cPrepared;
          marks.push(Object.freeze({
            type: label.type,
            invitationId: label.invitationId,
            invitationExpiresAtMillis: expiresAtMillis,
          }));
          labelResults.push(Object.freeze({
            type: label.type,
            status: "saved",
            alreadySaved: existing?.id === label.invitationId &&
              existing.expiresAtMillis === expiresAtMillis,
          }));
          continue;
        }
        const alreadySaved = label.type === "SA"
          ? parsed.saPrepared
          : parsed.srPrepared;
        marks.push(Object.freeze({
          type: label.type,
          invitationId: null,
          invitationExpiresAtMillis: null,
        }));
        labelResults.push(Object.freeze({
          type: label.type,
          status: "saved",
          alreadySaved,
        }));
      }

      const patch = marks.length === 0
        ? null
        : preparedAdminRestaurantQrPreparationPatch(
            authority.rawPreparation,
            marks,
          );
      const updatedPreparation = patch === null
        ? authority.rawPreparation
        : applyAdminRestaurantQrPreparationPatch(
            authority.rawPreparation,
            patch,
          );
      const updatedParsed = parseAdminRestaurantQrPreparationDocument(
        updatedPreparation,
      )!;
      const ownerPreparedValidation =
        validateAdminRestaurantQrPreparedOwnerAssociation({
          catalogRestaurantId,
          rawPreparation: updatedPreparation,
          restaurantData: authority.restaurantData,
          invitation: invitationById(
            invitations,
            updatedParsed.iPrepared?.id,
          ),
          nowMillis,
        });
      const claimPreparedValidation =
        validateAdminRestaurantQrPreparedClaimAssociation({
          catalogRestaurantId,
          rawPreparation: updatedPreparation,
          restaurantData: authority.restaurantData,
          invitation: invitationById(
            invitations,
            updatedParsed.cPrepared?.id,
          ),
          nowMillis,
        });
      const projection = projectAdminRestaurantQrPreparation({
        catalogRestaurantId,
        rawPreparation: updatedPreparation,
        biteSaverParticipation: authority.biteSaverParticipation,
        biteScoreClaim: authority.biteScoreClaim,
        ownerPreparedValidation,
        claimPreparedValidation,
        nowMillis,
      });
      if (patch !== null) {
        transaction.mergeDocument(
          `private_admin_restaurant_qr_preparation/${catalogRestaurantId}`,
          patch,
        );
      }
      const hasFailure = labelResults.some(
        (result) => result.status === "failed",
      );
      return Object.freeze({
        catalogRestaurantId,
        outcome: hasFailure ? "partialFailure" as const : "processed" as const,
        labels: Object.freeze(labelResults),
        preparation: projection,
      });
    });
  } catch (error) {
    if (error instanceof ControlledRestaurantError) {
      return failedMarkResult(
        group,
        error.resultCode,
        error.message,
      );
    }
    return failedMarkResult(
      group,
      "transaction_failed",
      "Preparation status could not be saved. Retry these labels.",
    );
  }
}

export async function prepareAdminRestaurantQrBatchCallableHandler(
  request: CallableRequest<unknown>,
  dependencies: AdminRestaurantQrBatchCallableDependencies,
): Promise<Readonly<{
  schemaVersion: 1;
  outcome: "complete" | "partialFailure";
  results: readonly AdminRestaurantQrBatchPreparationResult[];
}>> {
  const admin = dependencies.requireAdmin(request);
  const parsed = parsePrepareRequest(request.data);
  const nowMillis = dependencies.now().getTime();
  if (!Number.isFinite(nowMillis)) {
    throw new Error("The batch preparation clock is invalid.");
  }
  const allocations = parsed.catalogRestaurantIds.map(() =>
    allocateInvitations(
      dependencies.database,
      nowMillis,
      dependencies.serverTimestamp,
    )
  );
  const results = await mapWithConcurrency(
    parsed.catalogRestaurantIds,
    (catalogRestaurantId, index) => prepareRestaurant(
      dependencies.database,
      catalogRestaurantId,
      allocations[index],
      admin,
    ),
  );
  return Object.freeze({
    schemaVersion: adminRestaurantQrBatchSchemaVersion,
    outcome: results.every((result) => result.outcome === "ready")
      ? "complete"
      : "partialFailure",
    results,
  });
}

export async function markAdminRestaurantQrBatchPreparedCallableHandler(
  request: CallableRequest<unknown>,
  dependencies: AdminRestaurantQrBatchCallableDependencies,
): Promise<Readonly<{
  schemaVersion: 1;
  outcome: "complete" | "partialFailure";
  results: readonly AdminRestaurantQrBatchMarkResult[];
}>> {
  dependencies.requireAdmin(request);
  const parsed = parseMarkRequest(request.data);
  const nowMillis = dependencies.now().getTime();
  if (!Number.isFinite(nowMillis)) {
    throw new Error("The batch marking clock is invalid.");
  }
  const results = await mapWithConcurrency(
    parsed.restaurants,
    (group) => {
      dependencies.requireAdmin(request);
      return markRestaurant(dependencies.database, group, nowMillis);
    },
  );
  return Object.freeze({
    schemaVersion: adminRestaurantQrBatchSchemaVersion,
    outcome: results.every((result) => result.outcome === "processed")
      ? "complete"
      : "partialFailure",
    results,
  });
}

export function createFirestoreAdminRestaurantQrBatchDatabase(
  database: Firestore,
): AdminRestaurantQrBatchDatabase {
  const preparationDatabase =
    createFirestoreAdminRestaurantQrPreparationDatabase(database);
  return {
    ...preparationDatabase,
    allocateRestaurantInviteId() {
      return database.collection(restaurantInviteCollection).doc().id;
    },
  };
}
