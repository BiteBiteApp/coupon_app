import {requireAccountWritable} from "./account_deletion_guard.js";
import { randomBytes } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import {
  requireAuthenticatedRestaurantAccountActor,
} from "./admin_authorization.js";

export const menuImageUploadAuthorizationSchemaVersion = 1 as const;
export const privateMenuImageUploadAuthorizationCollection =
  "private_menu_image_upload_authorizations" as const;

const adminEmail = "schuyler.cole@gmail.com" as const;
const authorizationIdPrefix = "bsmia_" as const;
const authorizationEntropyBytes = 32;
const maximumAuthorizationAttempts = 3;
const maximumSourceIdLength = 512;
const unsupportedSourceIdCharacterPattern = /[\/\p{Cc}\p{Cf}]/u;

export type MenuImageSourceType = "biteSaver" | "sharedMenu";
export type MenuImageFileExtension = "jpg" | "png" | "webp";

export type MenuImageUploadAuthorizationGrant = Readonly<{
  schemaVersion: typeof menuImageUploadAuthorizationSchemaVersion;
  state: "active";
  ownerUserId: string;
  sourceType: MenuImageSourceType;
  sourceId: string;
  fileName: string;
}>;

export type MenuImageUploadAuthorizationDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

export interface MenuImageUploadAuthorizationDatabase {
  getDocument(
    path: string,
  ): Promise<MenuImageUploadAuthorizationDocument | null>;
  createAuthorization(
    authorizationId: string,
    grant: MenuImageUploadAuthorizationGrant,
    actorUid: string,
  ): Promise<void>;
}

export type MenuImageUploadAuthorizationDependencies = Readonly<{
  database: MenuImageUploadAuthorizationDatabase;
  randomSource?: (size: number) => Buffer;
}>;

type ParsedRequest = Readonly<{
  sourceType: MenuImageSourceType;
  sourceId: string;
  fileExtension: MenuImageFileExtension;
}>;

function readRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    keys.every((key) => expected.includes(key));
}

function invalidRequest(): never {
  throw new HttpsError(
    "invalid-argument",
    "The menu image upload authorization request is invalid.",
  );
}

function readSourceId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumSourceIdLength ||
    value.trim() !== value ||
    value === "." ||
    value === ".." ||
    unsupportedSourceIdCharacterPattern.test(value)
  ) {
    return null;
  }
  return value;
}

function parseRequest(value: unknown): ParsedRequest {
  const data = readRecord(value);
  if (
    data === null ||
    !hasExactKeys(data, [
      "schemaVersion",
      "sourceType",
      "sourceId",
      "fileExtension",
    ]) ||
    data.schemaVersion !== menuImageUploadAuthorizationSchemaVersion ||
    (data.sourceType !== "biteSaver" && data.sourceType !== "sharedMenu") ||
    (data.fileExtension !== "jpg" &&
      data.fileExtension !== "png" &&
      data.fileExtension !== "webp")
  ) {
    invalidRequest();
  }
  const sourceId = readSourceId(data.sourceId);
  if (sourceId === null) invalidRequest();
  return Object.freeze({
    sourceType: data.sourceType,
    sourceId,
    fileExtension: data.fileExtension,
  });
}

function requestHasAdminAccess(request: CallableRequest<unknown>): boolean {
  const auth = readRecord(request.auth);
  const token = readRecord(auth?.token);
  return token?.admin === true || token?.email === adminEmail;
}

function readString(
  data: Readonly<Record<string, unknown>>,
  field: string,
): string | null {
  const value = data[field];
  return typeof value === "string" && value.trim() === value && value.length > 0
    ? value
    : null;
}

function ownRestaurantAccountHasPostingAccess(
  data: Readonly<Record<string, unknown>>,
): boolean {
  return data.approvalStatus === "approved" &&
    data.couponPostingEnabled === true;
}

async function resolveGrantOwner(
  parsed: ParsedRequest,
  actorUid: string,
  isAdmin: boolean,
  database: MenuImageUploadAuthorizationDatabase,
): Promise<string> {
  if (parsed.sourceType === "biteSaver") {
    if (!isAdmin && parsed.sourceId !== actorUid) {
      throw new HttpsError(
        "permission-denied",
        "The restaurant account does not belong to the signed-in user.",
      );
    }
    const account = await database.getDocument(
      `restaurant_accounts/${parsed.sourceId}`,
    );
    if (
      account === null ||
      (!isAdmin && !ownRestaurantAccountHasPostingAccess(account.data))
    ) {
      throw new HttpsError(
        "permission-denied",
        "The restaurant account cannot upload menu images.",
      );
    }
    return parsed.sourceId;
  }

  const menu = await database.getDocument(`restaurant_menus/${parsed.sourceId}`);
  const ownerUserId = menu === null
    ? null
    : readString(menu.data, "createdByUserId");
  if (ownerUserId === null || (!isAdmin && ownerUserId !== actorUid)) {
    throw new HttpsError(
      "permission-denied",
      "The shared menu does not belong to the signed-in user.",
    );
  }
  return ownerUserId;
}

function isAlreadyExistsError(error: unknown): boolean {
  const record = readRecord(error);
  return record?.code === 6 || record?.code === "already-exists";
}

export async function issueMenuImageUploadAuthorizationHandler(
  request: CallableRequest<unknown>,
  dependencies: MenuImageUploadAuthorizationDependencies,
): Promise<Readonly<{
  schemaVersion: typeof menuImageUploadAuthorizationSchemaVersion;
  objectPath: string;
}>> {
  const actor = requireAuthenticatedRestaurantAccountActor(request);
  const parsed = parseRequest(request.data);
  const ownerUserId = await resolveGrantOwner(
    parsed,
    actor.uid,
    requestHasAdminAccess(request),
    dependencies.database,
  );
  const fileName = `image.${parsed.fileExtension}`;
  const randomSource = dependencies.randomSource ?? randomBytes;

  for (let attempt = 0; attempt < maximumAuthorizationAttempts; attempt += 1) {
    const authorizationId = authorizationIdPrefix +
      randomSource(authorizationEntropyBytes).toString("base64url");
    if (!/^bsmia_[A-Za-z0-9_-]{43}$/u.test(authorizationId)) {
      throw new HttpsError(
        "internal",
        "Menu image upload authorization entropy was invalid.",
      );
    }
    try {
      await dependencies.database.createAuthorization(
        authorizationId,
        Object.freeze({
          schemaVersion: menuImageUploadAuthorizationSchemaVersion,
          state: "active",
          ownerUserId,
          sourceType: parsed.sourceType,
          sourceId: parsed.sourceId,
          fileName,
        }),
        actor.uid,
      );
      return Object.freeze({
        schemaVersion: menuImageUploadAuthorizationSchemaVersion,
        objectPath: `public_menu_images/${authorizationId}/${fileName}`,
      });
    } catch (error) {
      if (!isAlreadyExistsError(error) ||
          attempt + 1 >= maximumAuthorizationAttempts) {
        throw error;
      }
    }
  }
  throw new HttpsError(
    "internal",
    "Menu image upload authorization could not be issued.",
  );
}

export function createFirestoreMenuImageUploadAuthorizationDatabase(
  firestore: Firestore,
): MenuImageUploadAuthorizationDatabase {
  return Object.freeze({
    async getDocument(path: string) {
      const snapshot = await firestore.doc(path).get();
      if (!snapshot.exists) return null;
      return Object.freeze({
        id: snapshot.id,
        data: Object.freeze(snapshot.data() ?? {}),
      });
    },
    async createAuthorization(authorizationId: string, grant: MenuImageUploadAuthorizationGrant, actorUid: string) {
      await firestore.runTransaction(async (tx) => {
        await requireAccountWritable(firestore, tx, actorUid);
        await requireAccountWritable(firestore, tx, grant.ownerUserId);
        const source = await tx.get(firestore.doc(`${grant.sourceType === "biteSaver" ? "restaurant_accounts" : "restaurant_menus"}/${grant.sourceId}`));
        if (!source.exists || (grant.sourceType === "sharedMenu" && source.get("createdByUserId") !== grant.ownerUserId)) {
          throw new HttpsError("failed-precondition", "Menu ownership changed.");
        }
        tx.create(firestore.collection(privateMenuImageUploadAuthorizationCollection).doc(authorizationId), {...grant, createdAt: FieldValue.serverTimestamp()});
      });
    },
  });
}
