import {
  requireOwnerRecordGeneration,
  requireOwnerRecordUid,
} from "./owner_record_state_contract.js";

export const ownerRecordRemovalStorageKinds = Object.freeze([
  "restaurant_images",
  "coupon_images",
  "menu_images",
] as const);

export type OwnerRecordRemovalStorageKind =
  (typeof ownerRecordRemovalStorageKinds)[number];

export const ownerRecordRemovalStoragePageLimit = 25 as const;
export const ownerRecordRemovalStorageRemnantLimit = 1 as const;

export type OwnerRecordRemovalStorageListLimit =
  | typeof ownerRecordRemovalStoragePageLimit
  | typeof ownerRecordRemovalStorageRemnantLimit;

export type OwnerRecordRemovalStorageFailureCode =
  | "storage_generation_mismatch"
  | "record_generation_missing"
  | "newer_generation_record_found"
  | "generation_mismatch"
  | "unsupported_partial_state";

export class OwnerRecordRemovalStorageError extends Error {
  public readonly code: OwnerRecordRemovalStorageFailureCode;

  public constructor(code: OwnerRecordRemovalStorageFailureCode) {
    super("Owner-record removal Storage state is invalid.");
    this.name = "OwnerRecordRemovalStorageError";
    this.code = code;
  }
}

/**
 * Raw data returned by the injected boundary. Every field remains unknown
 * until the strict validator has bound it to the active owner generation.
 */
export type OwnerRecordRemovalStorageListedObject = Readonly<{
  name: unknown;
  providerGeneration: unknown;
  ownerRecordGeneration: unknown;
}>;

export type ValidatedOwnerRecordRemovalStorageObject = Readonly<{
  name: string;
  providerGeneration: string;
  ownerRecordGeneration: string;
}>;

export type OwnerRecordRemovalStorageDeleteResult =
  | "deleted"
  | "not_found"
  | "precondition_failed";

export type OwnerRecordRemovalStorageListRequest = Readonly<{
  targetUid: string;
  kind: OwnerRecordRemovalStorageKind;
  limit: OwnerRecordRemovalStorageListLimit;
}>;

export type OwnerRecordRemovalStorageDeleteRequest = Readonly<{
  targetUid: string;
  kind: OwnerRecordRemovalStorageKind;
  name: string;
  providerGeneration: string;
}>;

/** Strict test-injected boundary. No implementation or provider is installed. */
export interface OwnerRecordRemovalStorageBoundary {
  listFirstObjects(
    request: OwnerRecordRemovalStorageListRequest,
  ): Promise<readonly OwnerRecordRemovalStorageListedObject[]>;
  deleteExactObject(
    request: OwnerRecordRemovalStorageDeleteRequest,
  ): Promise<OwnerRecordRemovalStorageDeleteResult>;
}

function fail(code: OwnerRecordRemovalStorageFailureCode): never {
  throw new OwnerRecordRemovalStorageError(code);
}

function exactTargetUid(value: unknown): string {
  try {
    return requireOwnerRecordUid(value);
  } catch {
    return fail("unsupported_partial_state");
  }
}

function exactSourceGeneration(value: unknown): number {
  try {
    return requireOwnerRecordGeneration(value);
  } catch {
    return fail("generation_mismatch");
  }
}

function exactKind(value: unknown): OwnerRecordRemovalStorageKind {
  if (
    value !== "restaurant_images" &&
    value !== "coupon_images" &&
    value !== "menu_images"
  ) {
    return fail("unsupported_partial_state");
  }
  return value;
}

function exactLimit(value: unknown): OwnerRecordRemovalStorageListLimit {
  if (
    value !== ownerRecordRemovalStoragePageLimit &&
    value !== ownerRecordRemovalStorageRemnantLimit
  ) {
    return fail("unsupported_partial_state");
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactObjectKeys(value: Record<string, unknown>): boolean {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    return false;
  }
  const keys = (ownKeys as string[]).sort();
  const expected = [
    "name",
    "ownerRecordGeneration",
    "providerGeneration",
  ];
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

/** Builds the only three Storage prefixes this boundary can address. */
export function buildOwnerRecordRemovalStoragePrefix(
  targetUid: unknown,
  kind: unknown,
): string {
  return `bitesaver_restaurants/${exactTargetUid(targetUid)}/${
    exactKind(kind)}/`;
}

/** Validates one full object name against its internally derived UID prefix. */
export function validateOwnerRecordRemovalStorageObjectName(params: {
  targetUid: unknown;
  kind: unknown;
  name: unknown;
}): string {
  const prefix = buildOwnerRecordRemovalStoragePrefix(
    params.targetUid,
    params.kind,
  );
  if (
    typeof params.name !== "string" ||
    !params.name.startsWith(prefix) ||
    params.name.length <= prefix.length ||
    Buffer.byteLength(params.name, "utf8") > 1_024 ||
    /[\u0000-\u001f\u007f]/u.test(params.name)
  ) {
    return fail("unsupported_partial_state");
  }
  return params.name;
}

/** Provider generations remain strings so their full precision is retained. */
export function validateOwnerRecordRemovalStorageProviderGeneration(
  value: unknown,
): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    return fail("storage_generation_mismatch");
  }
  return value;
}

/**
 * Validates canonical object metadata and binds it to the job's numeric source
 * generation without converting provider-controlled decimal text to Number.
 */
export function validateOwnerRecordRemovalStorageOwnerGeneration(params: {
  ownerRecordGeneration: unknown;
  sourceGeneration: unknown;
}): string {
  const sourceGeneration = exactSourceGeneration(params.sourceGeneration);
  const rawGeneration = params.ownerRecordGeneration;
  if (
    typeof rawGeneration !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(rawGeneration)
  ) {
    return fail("record_generation_missing");
  }
  const expectedGeneration = String(sourceGeneration);
  const generationOrder = rawGeneration.length === expectedGeneration.length
    ? rawGeneration === expectedGeneration
      ? 0
      : rawGeneration < expectedGeneration ? -1 : 1
    : rawGeneration.length - expectedGeneration.length;
  if (generationOrder > 0) {
    return fail("newer_generation_record_found");
  }
  if (generationOrder < 0) {
    return fail("generation_mismatch");
  }
  return rawGeneration;
}

/** Validates one exact first page and returns a frozen canonical copy. */
export function validateOwnerRecordRemovalStorageFirstPage(params: {
  targetUid: unknown;
  kind: unknown;
  limit: unknown;
  sourceGeneration: unknown;
  objects: unknown;
}): readonly ValidatedOwnerRecordRemovalStorageObject[] {
  const targetUid = exactTargetUid(params.targetUid);
  const kind = exactKind(params.kind);
  const limit = exactLimit(params.limit);
  const sourceGeneration = exactSourceGeneration(params.sourceGeneration);
  if (!Array.isArray(params.objects) || params.objects.length > limit) {
    return fail("unsupported_partial_state");
  }

  const validated: ValidatedOwnerRecordRemovalStorageObject[] = [];
  let previousName: string | null = null;
  for (let index = 0; index < params.objects.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(params.objects, index)) {
      return fail("unsupported_partial_state");
    }
    const value: unknown = params.objects[index];
    if (!isPlainRecord(value)) {
      return fail("unsupported_partial_state");
    }
    if (!Object.prototype.hasOwnProperty.call(
      value,
      "ownerRecordGeneration",
    )) {
      return fail("record_generation_missing");
    }
    if (!Object.prototype.hasOwnProperty.call(value, "providerGeneration")) {
      return fail("storage_generation_mismatch");
    }
    if (!hasExactObjectKeys(value)) {
      return fail("unsupported_partial_state");
    }
    const name = validateOwnerRecordRemovalStorageObjectName({
      targetUid,
      kind,
      name: value.name,
    });
    if (previousName !== null && name <= previousName) {
      return fail("unsupported_partial_state");
    }
    const providerGeneration =
      validateOwnerRecordRemovalStorageProviderGeneration(
        value.providerGeneration,
      );
    const ownerRecordGeneration =
      validateOwnerRecordRemovalStorageOwnerGeneration({
        ownerRecordGeneration: value.ownerRecordGeneration,
        sourceGeneration,
      });
    validated.push(Object.freeze({
      name,
      providerGeneration,
      ownerRecordGeneration,
    }));
    previousName = name;
  }
  return Object.freeze(validated);
}

export function validateOwnerRecordRemovalStorageDeleteResult(
  value: unknown,
): OwnerRecordRemovalStorageDeleteResult {
  if (
    value !== "deleted" &&
    value !== "not_found" &&
    value !== "precondition_failed"
  ) {
    return fail("unsupported_partial_state");
  }
  return value;
}

/** Maps only a provider generation precondition race to a job failure code. */
export function ownerRecordRemovalStorageDeleteFailureCode(
  value: unknown,
): "storage_generation_mismatch" | null {
  return validateOwnerRecordRemovalStorageDeleteResult(value) ===
      "precondition_failed"
    ? "storage_generation_mismatch"
    : null;
}
