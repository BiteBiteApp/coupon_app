import {createHash} from "node:crypto";

export const ownerRecordStateCollection =
  "private_owner_record_states" as const;
export const ownerRecordStateVersion =
  "bitestar.owner-record-state.v1" as const;

export type OwnerRecordState = "open" | "removing" | "removed";

export type OwnerRecordStateDocument = Readonly<{
  version: typeof ownerRecordStateVersion;
  ownerUid: string;
  generation: number;
  state: OwnerRecordState;
  activeJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
  fingerprint: string;
}>;

export type OwnerRecordStateStoredDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

type OwnerRecordStateCore = Omit<
  OwnerRecordStateDocument,
  "version" | "fingerprint"
>;

export class OwnerRecordStateContractError extends Error {
  public readonly code: "invalid-request" | "invalid-state";

  public constructor(code: "invalid-request" | "invalid-state") {
    super(code === "invalid-state"
      ? "Stored owner-record state is invalid."
      : "Owner-record state request is invalid.");
    this.name = "OwnerRecordStateContractError";
    this.code = code;
  }
}

const coreKeys = Object.freeze([
  "ownerUid",
  "generation",
  "state",
  "activeJobId",
  "createdAt",
  "updatedAt",
] as const);

function fail(code: "invalid-request" | "invalid-state"): never {
  throw new OwnerRecordStateContractError(code);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function exactOwnerUid(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > 1_500
  ) {
    return fail(code);
  }
  return value;
}

function exactJobId(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > 1_500
  ) {
    return fail(code);
  }
  return value;
}

function generation(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(code);
  }
  return value;
}

function state(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordState {
  if (value !== "open" && value !== "removing" && value !== "removed") {
    return fail(code);
  }
  return value;
}

function timestamp(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): Date {
  let parsed: unknown = value;
  if (!(parsed instanceof Date)) {
    const timestampLike = record(parsed);
    if (timestampLike === null || typeof timestampLike.toDate !== "function") {
      return fail(code);
    }
    try {
      parsed = (timestampLike.toDate as () => unknown)();
    } catch {
      return fail(code);
    }
  }
  if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) {
    return fail(code);
  }
  return new Date(parsed.getTime());
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return {"$date": value.toISOString()};
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const data = record(value);
  if (data !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(data).sort()) {
      result[key] = canonicalize(data[key]);
    }
    return result;
  }
  return value;
}

function fingerprint(core: OwnerRecordStateCore): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({
      version: ownerRecordStateVersion,
      core,
    })), "utf8")
    .digest("hex");
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function readCore(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerRecordStateCore {
  const data = record(value);
  if (data === null || !hasExactKeys(data, coreKeys)) {
    return fail(code);
  }
  const ownerUid = exactOwnerUid(data.ownerUid, code);
  const parsedGeneration = generation(data.generation, code);
  const parsedState = state(data.state, code);
  const activeJobId = data.activeJobId === null
    ? null
    : exactJobId(data.activeJobId, code);
  const createdAt = timestamp(data.createdAt, code);
  const updatedAt = timestamp(data.updatedAt, code);
  if (
    updatedAt.getTime() < createdAt.getTime() ||
    (parsedState === "removing" && activeJobId === null) ||
    (parsedState !== "removing" && activeJobId !== null)
  ) {
    return fail(code);
  }
  return Object.freeze({
    ownerUid,
    generation: parsedGeneration,
    state: parsedState,
    activeJobId,
    createdAt,
    updatedAt,
  });
}

export function requireOwnerRecordUid(value: unknown): string {
  return exactOwnerUid(value, "invalid-request");
}

export function requireOwnerRecordGeneration(value: unknown): number {
  return generation(value, "invalid-request");
}

export function buildOwnerRecordStateDocument(
  value: OwnerRecordStateCore,
): OwnerRecordStateDocument {
  const core = readCore(value, "invalid-request");
  return Object.freeze({
    version: ownerRecordStateVersion,
    ...core,
    fingerprint: fingerprint(core),
  });
}

export function parseOwnerRecordStateDocument(
  document: OwnerRecordStateStoredDocument | null,
): OwnerRecordStateDocument | null {
  if (document === null) {
    return null;
  }
  try {
    const data = record(document.data);
    if (
      data === null ||
      !hasExactKeys(data, ["version", ...coreKeys, "fingerprint"]) ||
      data.version !== ownerRecordStateVersion ||
      !isFingerprint(data.fingerprint)
    ) {
      return fail("invalid-state");
    }
    const coreData = {...data};
    delete coreData.version;
    delete coreData.fingerprint;
    const core = readCore(coreData, "invalid-state");
    if (
      exactOwnerUid(document.id, "invalid-state") !== core.ownerUid ||
      data.fingerprint !== fingerprint(core)
    ) {
      return fail("invalid-state");
    }
    return Object.freeze({
      version: ownerRecordStateVersion,
      ...core,
      fingerprint: data.fingerprint,
    });
  } catch {
    return fail("invalid-state");
  }
}

/** Creates only the explicit final-schema initial owner state. */
export function createInitialOwnerRecordState(
  ownerUid: string,
  now: Date,
): OwnerRecordStateDocument {
  return buildOwnerRecordStateDocument({
    ownerUid,
    generation: 0,
    state: "open",
    activeJobId: null,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Initializes an absent final-schema owner state or returns the existing open
 * state. Removing and removed states are never reopened by this helper.
 */
export function initializeOwnerRecordState(
  document: OwnerRecordStateStoredDocument | null,
  ownerUid: string,
  now: Date,
): Readonly<{state: OwnerRecordStateDocument; created: boolean}> {
  const exactUid = requireOwnerRecordUid(ownerUid);
  const existing = parseOwnerRecordStateDocument(document);
  if (existing === null) {
    return Object.freeze({
      state: createInitialOwnerRecordState(exactUid, now),
      created: true,
    });
  }
  if (existing.ownerUid !== exactUid || existing.state !== "open") {
    return fail("invalid-state");
  }
  return Object.freeze({state: existing, created: false});
}

/** Pure future-onboarding transition. It is not called automatically. */
export function reactivateRemovedOwnerRecordState(
  current: OwnerRecordStateDocument,
  now: Date,
): OwnerRecordStateDocument {
  const rebuilt = buildOwnerRecordStateDocument({
    ownerUid: current.ownerUid,
    generation: current.generation,
    state: current.state,
    activeJobId: current.activeJobId,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  });
  const updatedAt = timestamp(now, "invalid-request");
  if (
    rebuilt.fingerprint !== current.fingerprint ||
    rebuilt.state !== "removed" ||
    updatedAt.getTime() < rebuilt.updatedAt.getTime()
  ) {
    return fail("invalid-state");
  }
  return buildOwnerRecordStateDocument({
    ownerUid: rebuilt.ownerUid,
    generation: rebuilt.generation,
    state: "open",
    activeJobId: null,
    createdAt: rebuilt.createdAt,
    updatedAt,
  });
}
