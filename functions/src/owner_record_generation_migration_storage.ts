import type {Storage} from "firebase-admin/storage";

import {
  buildOwnerRecordGenerationMigrationStoragePrefix as buildContractPrefix,
  ownerRecordGenerationMigrationStorageKinds as contractStorageKinds,
  ownerRecordGenerationStorageMetadataKey,
  type OwnerRecordGenerationMigrationStorageKind as ContractStorageKind,
} from "./owner_record_generation_migration_contract.js";
import {requireOwnerRecordUid} from "./owner_record_state_contract.js";

export const ownerRecordGenerationMigrationStoragePageLimit = 25 as const;
export const ownerRecordGenerationMigrationStorageCursorVersion =
  "bitestar.owner-record-generation-migration-storage-cursor.v1" as const;
export const ownerRecordGenerationMigrationStorageMetadataKey =
  ownerRecordGenerationStorageMetadataKey;

export const ownerRecordGenerationMigrationStorageKinds = contractStorageKinds;

export type OwnerRecordGenerationMigrationStorageKind =
  ContractStorageKind;

/**
 * Provider object generation and metageneration intentionally remain separate
 * from the custom ownerRecordGeneration value. A future apply operation must
 * require exact matches for both provider concurrency values before changing
 * only custom metadata; this inventory module implements no such operation.
 *
 * Later Storage Rules must bind the authenticated UID to the path UID, require
 * the exact owner-state document to be open, and require canonical decimal
 * ownerRecordGeneration metadata equal to that state. Existing size/type
 * restrictions remain, and replacement/deletion must not affect objects from
 * a newer owner generation.
 */
export type OwnerRecordGenerationMigrationStorageObject = Readonly<{
  name: string;
  providerGeneration: unknown;
  metageneration: unknown;
  size: unknown;
  contentType: unknown;
  ownerRecordGeneration: unknown;
}>;

export type OwnerRecordGenerationMigrationStorageCursor = Readonly<{
  version: typeof ownerRecordGenerationMigrationStorageCursorVersion;
  targetUid: string;
  kind: OwnerRecordGenerationMigrationStorageKind;
  pageToken: string;
  afterObjectName: string;
}>;

export type OwnerRecordGenerationMigrationStorageListRequest = Readonly<{
  targetUid: string;
  kind: OwnerRecordGenerationMigrationStorageKind;
  pageSize: number;
  cursor?: OwnerRecordGenerationMigrationStorageCursor | null;
}>;

export type OwnerRecordGenerationMigrationStoragePage = Readonly<{
  objects: readonly OwnerRecordGenerationMigrationStorageObject[];
  nextCursor: OwnerRecordGenerationMigrationStorageCursor | null;
}>;

/** The complete Storage adapter surface; it has no write or download method. */
export interface OwnerRecordGenerationMigrationStorageInventory {
  listObjects(
    request: OwnerRecordGenerationMigrationStorageListRequest,
  ): Promise<OwnerRecordGenerationMigrationStoragePage>;
}

export type OwnerRecordGenerationMigrationStorageStore =
  OwnerRecordGenerationMigrationStorageInventory;

export type OwnerRecordGenerationMigrationStorageBucket = Pick<
  ReturnType<Storage["bucket"]>,
  "getFiles"
>;

export type OwnerRecordGenerationMigrationStorageFixture =
  OwnerRecordGenerationMigrationStorageObject;

export type OwnerRecordGenerationMigrationStorageErrorCode =
  | "invalid_request"
  | "invalid_cursor"
  | "invalid_provider_response";

export class OwnerRecordGenerationMigrationStorageError extends Error {
  public readonly code: OwnerRecordGenerationMigrationStorageErrorCode;

  public constructor(code: OwnerRecordGenerationMigrationStorageErrorCode) {
    super("Owner-record generation Storage inventory is invalid.");
    this.name = "OwnerRecordGenerationMigrationStorageError";
    this.code = code;
  }
}

export const ownerRecordGenerationMigrationStorageListFields =
  "items(name,generation,metageneration,size,contentType," +
  "metadata/ownerRecordGeneration),nextPageToken";

const malformedCustomMetadata = Object.freeze({malformed: true as const});

function fail(code: OwnerRecordGenerationMigrationStorageErrorCode): never {
  throw new OwnerRecordGenerationMigrationStorageError(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    return false;
  }
  const keys = ownKeys as string[];
  if (required.some((key) => !keys.includes(key))) {
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  return keys.every((key) => allowed.has(key));
}

function targetUid(value: unknown): string {
  try {
    return requireOwnerRecordUid(value);
  } catch {
    return fail("invalid_request");
  }
}

function storageKind(
  value: unknown,
): OwnerRecordGenerationMigrationStorageKind {
  if (
    typeof value !== "string" ||
    !ownerRecordGenerationMigrationStorageKinds.some(
      (candidate) => candidate === value,
    )
  ) {
    return fail("invalid_request");
  }
  return value as OwnerRecordGenerationMigrationStorageKind;
}

function pageSize(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > ownerRecordGenerationMigrationStoragePageLimit
  ) {
    return fail("invalid_request");
  }
  return value;
}

function pageToken(
  value: unknown,
  code: OwnerRecordGenerationMigrationStorageErrorCode,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 4_096 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return fail(code);
  }
  return value;
}

export function buildOwnerRecordGenerationMigrationStoragePrefix(
  uid: unknown,
  kind: unknown,
): string {
  const exactUid = targetUid(uid);
  const exactKind = storageKind(kind);
  return buildContractPrefix({ownerUid: exactUid, storageKind: exactKind});
}

function objectName(params: {
  value: unknown;
  targetUid: string;
  kind: OwnerRecordGenerationMigrationStorageKind;
  code: OwnerRecordGenerationMigrationStorageErrorCode;
}): string {
  const prefix = buildOwnerRecordGenerationMigrationStoragePrefix(
    params.targetUid,
    params.kind,
  );
  if (
    typeof params.value !== "string" ||
    !params.value.startsWith(prefix) ||
    params.value.length <= prefix.length ||
    Buffer.byteLength(params.value, "utf8") > 1_024 ||
    /[\u0000-\u001f\u007f]/u.test(params.value)
  ) {
    return fail(params.code);
  }
  return params.value;
}

function compareObjectNames(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function cursorForRequest(
  value: unknown,
  expectedTargetUid: string,
  expectedKind: OwnerRecordGenerationMigrationStorageKind,
): OwnerRecordGenerationMigrationStorageCursor | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, [
      "afterObjectName",
      "kind",
      "pageToken",
      "targetUid",
      "version",
    ]) ||
    value.version !== ownerRecordGenerationMigrationStorageCursorVersion ||
    value.targetUid !== expectedTargetUid ||
    value.kind !== expectedKind
  ) {
    return fail("invalid_cursor");
  }
  return Object.freeze({
    version: ownerRecordGenerationMigrationStorageCursorVersion,
    targetUid: expectedTargetUid,
    kind: expectedKind,
    pageToken: pageToken(value.pageToken, "invalid_cursor"),
    afterObjectName: objectName({
      value: value.afterObjectName,
      targetUid: expectedTargetUid,
      kind: expectedKind,
      code: "invalid_cursor",
    }),
  });
}

function exactRequest(
  value: unknown,
): Readonly<{
  targetUid: string;
  kind: OwnerRecordGenerationMigrationStorageKind;
  pageSize: number;
  cursor: OwnerRecordGenerationMigrationStorageCursor | null;
}> {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ["kind", "pageSize", "targetUid"], ["cursor"])
  ) {
    return fail("invalid_request");
  }
  const exactTargetUid = targetUid(value.targetUid);
  const exactKind = storageKind(value.kind);
  return Object.freeze({
    targetUid: exactTargetUid,
    kind: exactKind,
    pageSize: pageSize(value.pageSize),
    cursor: cursorForRequest(value.cursor, exactTargetUid, exactKind),
  });
}

function selectedMetadataValue(providerRecord: Record<string, unknown>): unknown {
  if (!Object.prototype.hasOwnProperty.call(providerRecord, "metadata")) {
    return null;
  }
  const customMetadata = providerRecord.metadata;
  if (!isPlainRecord(customMetadata)) {
    return malformedCustomMetadata;
  }
  if (!Object.prototype.hasOwnProperty.call(
    customMetadata,
    ownerRecordGenerationMigrationStorageMetadataKey,
  )) {
    return null;
  }
  const value = customMetadata[ownerRecordGenerationMigrationStorageMetadataKey];
  return typeof value === "string" ? value : malformedCustomMetadata;
}

function metadataField(
  providerRecord: Record<string, unknown>,
  field: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(providerRecord, field)
    ? providerRecord[field]
    : null;
}

function listedObject(params: {
  file: unknown;
  targetUid: string;
  kind: OwnerRecordGenerationMigrationStorageKind;
}): OwnerRecordGenerationMigrationStorageObject {
  if (!isPlainRecord(params.file)) {
    return fail("invalid_provider_response");
  }
  const file = params.file;
  const name = objectName({
    value: file.name,
    targetUid: params.targetUid,
    kind: params.kind,
    code: "invalid_provider_response",
  });
  return Object.freeze({
    name,
    providerGeneration: metadataField(file, "generation"),
    metageneration: metadataField(file, "metageneration"),
    size: metadataField(file, "size"),
    contentType: metadataField(file, "contentType"),
    ownerRecordGeneration: selectedMetadataValue(file),
  });
}

function nextPageToken(nextQuery: unknown): string | null {
  if (nextQuery === null || nextQuery === undefined) {
    return null;
  }
  if (!isPlainRecord(nextQuery)) {
    return fail("invalid_provider_response");
  }
  if (!Object.prototype.hasOwnProperty.call(nextQuery, "pageToken")) {
    return null;
  }
  if (nextQuery.pageToken === undefined || nextQuery.pageToken === null) {
    return null;
  }
  return pageToken(nextQuery.pageToken, "invalid_provider_response");
}

function validatedPage(params: {
  files: unknown;
  nextQuery: unknown;
  targetUid: string;
  kind: OwnerRecordGenerationMigrationStorageKind;
  requestedPageSize: number;
  cursor: OwnerRecordGenerationMigrationStorageCursor | null;
}): OwnerRecordGenerationMigrationStoragePage {
  if (
    !Array.isArray(params.files) ||
    params.files.length > params.requestedPageSize
  ) {
    return fail("invalid_provider_response");
  }
  const objects: OwnerRecordGenerationMigrationStorageObject[] = [];
  let previousName = params.cursor?.afterObjectName ?? null;
  for (const file of params.files) {
    const object = listedObject({
      file,
      targetUid: params.targetUid,
      kind: params.kind,
    });
    if (
      previousName !== null &&
      compareObjectNames(object.name, previousName) <= 0
    ) {
      return fail("invalid_provider_response");
    }
    objects.push(object);
    previousName = object.name;
  }
  const providerToken = nextPageToken(params.nextQuery);
  if (
    providerToken !== null &&
    (objects.length === 0 || providerToken === params.cursor?.pageToken)
  ) {
    return fail("invalid_provider_response");
  }
  const frozenObjects = Object.freeze(objects);
  const last = frozenObjects.length === 0
    ? undefined
    : frozenObjects[frozenObjects.length - 1];
  return Object.freeze({
    objects: frozenObjects,
    nextCursor: providerToken === null || last === undefined
      ? null
      : Object.freeze({
        version: ownerRecordGenerationMigrationStorageCursorVersion,
        targetUid: params.targetUid,
        kind: params.kind,
        pageToken: providerToken,
        afterObjectName: last.name,
      }),
  });
}

/**
 * Creates a production adapter over the one default bucket selected by trusted
 * CLI wiring. Requests cannot choose a bucket or prefix. Only object listing is
 * used; no metadata fetch, object download, URL creation, or write is exposed.
 */
export function createFirebaseOwnerRecordGenerationMigrationStorageInventory(
  storage: Storage,
): OwnerRecordGenerationMigrationStorageInventory {
  if (
    typeof storage !== "object" ||
    storage === null ||
    typeof storage.bucket !== "function"
  ) {
    return fail("invalid_request");
  }
  return createStorageOwnerRecordGenerationMigrationStore(storage.bucket());
}

/**
 * Creates the same adapter from a trusted, preselected bucket. The bucket must
 * be selected by CLI bootstrap code, never from inventory data.
 */
export function createStorageOwnerRecordGenerationMigrationStore(
  bucket: OwnerRecordGenerationMigrationStorageBucket,
): OwnerRecordGenerationMigrationStorageInventory {
  if (
    typeof bucket !== "object" ||
    bucket === null ||
    typeof bucket.getFiles !== "function"
  ) {
    return fail("invalid_request");
  }

  const inventory: OwnerRecordGenerationMigrationStorageInventory = {
    async listObjects(request) {
      const exact = exactRequest(request);
      const prefix = buildOwnerRecordGenerationMigrationStoragePrefix(
        exact.targetUid,
        exact.kind,
      );
      const [files, nextQuery] = await bucket.getFiles({
        autoPaginate: false,
        fields: ownerRecordGenerationMigrationStorageListFields,
        maxResults: exact.pageSize,
        prefix,
        versions: false,
        ...(exact.cursor === null
          ? {}
          : {pageToken: exact.cursor.pageToken}),
      });
      return validatedPage({
        files,
        nextQuery,
        targetUid: exact.targetUid,
        kind: exact.kind,
        requestedPageSize: exact.pageSize,
        cursor: exact.cursor,
      });
    },
  };
  return Object.freeze(inventory);
}

function fixtureObject(
  value: unknown,
): OwnerRecordGenerationMigrationStorageFixture {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, [
      "contentType",
      "metageneration",
      "name",
      "ownerRecordGeneration",
      "providerGeneration",
      "size",
    ]) ||
    typeof value.name !== "string"
  ) {
    return fail("invalid_request");
  }
  const segments = value.name.split("/");
  if (
    segments.length < 4 ||
    segments[0] !== "bitesaver_restaurants"
  ) {
    return fail("invalid_request");
  }
  const uid = targetUid(segments[1]);
  const kind = storageKind(segments[2]);
  const name = objectName({
    value: value.name,
    targetUid: uid,
    kind,
    code: "invalid_request",
  });
  return Object.freeze({
    name,
    providerGeneration: value.providerGeneration,
    metageneration: value.metageneration,
    size: value.size,
    contentType: value.contentType,
    ownerRecordGeneration: value.ownerRecordGeneration,
  });
}

/** A deterministic, immutable implementation for synthetic planner tests. */
export function createInMemoryOwnerRecordGenerationMigrationStorageInventory(
  objects: readonly OwnerRecordGenerationMigrationStorageFixture[],
): OwnerRecordGenerationMigrationStorageInventory {
  if (!Array.isArray(objects)) {
    return fail("invalid_request");
  }
  const copied = objects.map(fixtureObject).sort((left, right) =>
    compareObjectNames(left.name, right.name));
  for (let index = 1; index < copied.length; index += 1) {
    if (copied[index - 1].name === copied[index].name) {
      return fail("invalid_request");
    }
  }
  const frozenObjects = Object.freeze(copied);

  const inventory: OwnerRecordGenerationMigrationStorageInventory = {
    async listObjects(request) {
      const exact = exactRequest(request);
      const prefix = buildOwnerRecordGenerationMigrationStoragePrefix(
        exact.targetUid,
        exact.kind,
      );
      const matches = frozenObjects.filter((object) =>
        object.name.startsWith(prefix));
      let start = 0;
      if (exact.cursor !== null) {
        if (!/^(?:0|[1-9][0-9]*)$/u.test(exact.cursor.pageToken)) {
          return fail("invalid_cursor");
        }
        const parsed = Number(exact.cursor.pageToken);
        if (
          !Number.isSafeInteger(parsed) ||
          parsed < 1 ||
          parsed > matches.length ||
          matches[parsed - 1]?.name !== exact.cursor.afterObjectName
        ) {
          return fail("invalid_cursor");
        }
        start = parsed;
      }
      const page = matches.slice(start, start + exact.pageSize);
      const end = start + page.length;
      const last = page.length === 0 ? undefined : page[page.length - 1];
      return Object.freeze({
        objects: Object.freeze([...page]),
        nextCursor: end < matches.length && last !== undefined
          ? Object.freeze({
            version: ownerRecordGenerationMigrationStorageCursorVersion,
            targetUid: exact.targetUid,
            kind: exact.kind,
            pageToken: String(end),
            afterObjectName: last.name,
          })
          : null,
      });
    },
  };
  return Object.freeze(inventory);
}
