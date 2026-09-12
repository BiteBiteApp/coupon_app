import {
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  CustomerBiteSaverContractError,
  privateCustomerBiteSaverActiveSessionCollection,
} from "./customer_bitesaver_search_contract.js";
import { customerBiteSaverDeterministicId } from
  "./customer_bitesaver_search_cursor.js";
import type {
  CustomerBiteSaverSearchDatabase,
  CustomerBiteSaverStoredDocument,
  CustomerBiteSaverTransaction,
} from "./customer_bitesaver_search_store.js";

export const customerBiteSaverRequestReplayRole = "requestReplay" as const;
export const customerBiteSaverRequestReplayState = "active" as const;
export const customerBiteSaverLogicalRedemptionReplayRole =
  "logicalRedemptionReplay" as const;

export type CustomerBiteSaverRequestReplayPurpose =
  | "restaurantPage"
  | "offerPage"
  | "redemptionValidation"
  | "redemptionStart"
  | "guestOfferCheckAnswer";

export type CustomerBiteSaverRequestReplayInput = Readonly<{
  database: CustomerBiteSaverSearchDatabase;
  secretKey: Uint8Array;
  sessionId: string;
  attemptGeneration: number;
  callerCapabilityBinding: string;
  purpose: CustomerBiteSaverRequestReplayPurpose;
  clientRequestId: string;
  requestFingerprint: string;
  nowMs: number;
  absoluteSessionExpiresAt: Date;
}>;

export type CustomerBiteSaverRequestReplayReservation = Readonly<{
  evaluationAtMs: number;
  logicalExpiresAtMs: number;
  replayed: boolean;
}>;

export type CustomerBiteSaverRequestReplayDeadlineInput = Readonly<{
  secretKey: Uint8Array;
  sessionId: string;
  attemptGeneration: number;
  callerCapabilityBinding: string;
  purpose: "restaurantPage" | "offerPage";
  clientRequestId: string;
  requestFingerprint: string;
  evaluationAtMs: number;
  logicalExpiresAtMs: number;
  absoluteSessionExpiresAt: Date;
  nowMs: number;
}>;

export type CustomerBiteSaverRequestReplayDeadlineBinding = Readonly<{
  evaluationAtMs: number;
  logicalExpiresAtMs: number;
  live: boolean;
}>;

export type CustomerBiteSaverLogicalRedemptionReplayInput = Readonly<{
  database: CustomerBiteSaverSearchDatabase;
  secretKey: Uint8Array;
  sessionId: string;
  attemptGeneration: number;
  callerCapabilityBinding: string;
  redemptionRequestId: string;
  requestFingerprint: string;
  nowMs: number;
  logicalSessionExpiresAt: Date;
  absoluteSessionExpiresAt: Date;
}>;

export type CustomerBiteSaverLogicalRedemptionReplayReservation = Readonly<{
  evaluationAtMs: number;
  logicalExpiresAtMs: number;
  replayed: boolean;
}>;

type CustomerBiteSaverRequestReplayDocument = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  role: typeof customerBiteSaverRequestReplayRole;
  state: typeof customerBiteSaverRequestReplayState;
  sessionId: string;
  attemptGeneration: number;
  callerCapabilityBinding: string;
  purpose: CustomerBiteSaverRequestReplayPurpose;
  clientRequestBinding: string;
  requestFingerprint: string;
  evaluationAt: Date;
  createdAt: Date;
  logicalExpiresAt: Date;
  absoluteExpiresAt: Date;
  expiresAt: Date;
}>;

type ValidatedReplayInput = Readonly<{
  documentId: string;
  documentPath: string;
  clientRequestBinding: string;
  absoluteExpiresAtMs: number;
}>;

const replayDocumentKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "callerCapabilityBinding",
  "clientRequestBinding",
  "createdAt",
  "evaluationAt",
  "expiresAt",
  "logicalExpiresAt",
  "protocolVersion",
  "purpose",
  "requestFingerprint",
  "role",
  "schemaVersion",
  "sessionId",
  "state",
].sort());

const logicalRedemptionReplayDocumentKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "callerCapabilityBinding",
  "createdAt",
  "evaluationAt",
  "expiresAt",
  "logicalExpiresAt",
  "logicalRequestBinding",
  "protocolVersion",
  "requestFingerprint",
  "role",
  "schemaVersion",
  "sessionId",
  "state",
].sort());

function invalidInput(): never {
  throw new CustomerBiteSaverContractError(
    "invalid-argument",
    "The BiteSaver request replay binding is invalid.",
  );
}

function invalidState(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition",
    "The BiteSaver request replay state is invalid.",
  );
}

function reusedRequestId(): never {
  throw new CustomerBiteSaverContractError(
    "invalid-argument",
    "The client request ID was already used for a different request.",
  );
}

function requireSecretKey(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "BiteSaver discovery is not configured.",
    );
  }
}

function isPurpose(value: unknown): value is CustomerBiteSaverRequestReplayPurpose {
  return value === "restaurantPage" || value === "offerPage" ||
    value === "redemptionValidation" || value === "redemptionStart" ||
    value === "guestOfferCheckAnswer";
}

function dateValue(value: unknown): Date | null {
  let candidate: Date;
  if (value instanceof Date) {
    candidate = value;
  } else if (value !== null && typeof value === "object") {
    const toDate = (value as {toDate?: unknown}).toDate;
    if (typeof toDate !== "function") {
      return null;
    }
    try {
      candidate = toDate.call(value) as Date;
    } catch {
      return null;
    }
  } else {
    return null;
  }
  const milliseconds = candidate instanceof Date ? candidate.getTime() : NaN;
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? new Date(milliseconds)
    : null;
}

function clientRequestBinding(
  key: Uint8Array,
  input: Pick<
    CustomerBiteSaverRequestReplayInput,
    "sessionId" | "attemptGeneration" | "callerCapabilityBinding" |
      "purpose" | "clientRequestId"
  >,
): string {
  return customerBiteSaverDeterministicId(
    key,
    "bsrqb",
    "requestReplayClientRequestBinding",
    [
      input.sessionId,
      input.attemptGeneration.toString(10),
      input.callerCapabilityBinding,
      input.purpose,
      input.clientRequestId,
    ],
  );
}

export function customerBiteSaverRequestReplayDocumentId(
  key: Uint8Array,
  input: Pick<
    CustomerBiteSaverRequestReplayInput,
    "sessionId" | "attemptGeneration" | "callerCapabilityBinding" |
      "purpose" | "clientRequestId"
  >,
): string {
  requireSecretKey(key);
  if (
    !/^bss_[A-Za-z0-9_-]{43}$/u.test(input.sessionId) ||
    !Number.isSafeInteger(input.attemptGeneration) ||
    input.attemptGeneration < 0 ||
    !/^[0-9a-f]{64}$/u.test(input.callerCapabilityBinding) ||
    !isPurpose(input.purpose) ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(input.clientRequestId)
  ) {
    return invalidInput();
  }
  return customerBiteSaverDeterministicId(
    key,
    "bsrqr",
    "requestReplayDocument",
    [
      customerBiteSaverSearchProtocolVersion,
      input.sessionId,
      input.attemptGeneration.toString(10),
      input.callerCapabilityBinding,
      input.purpose,
      input.clientRequestId,
    ],
  );
}

export function customerBiteSaverRequestReplayPath(
  key: Uint8Array,
  input: Pick<
    CustomerBiteSaverRequestReplayInput,
    "sessionId" | "attemptGeneration" | "callerCapabilityBinding" |
      "purpose" | "clientRequestId"
  >,
): string {
  return `${privateCustomerBiteSaverActiveSessionCollection}/${
    customerBiteSaverRequestReplayDocumentId(key, input)}`;
}

function validateInput(
  input: CustomerBiteSaverRequestReplayInput,
): ValidatedReplayInput {
  const documentId = customerBiteSaverRequestReplayDocumentId(
    input.secretKey,
    input,
  );
  const absoluteExpiresAtMs = input.absoluteSessionExpiresAt instanceof Date
    ? input.absoluteSessionExpiresAt.getTime()
    : NaN;
  if (
    !/^[0-9a-f]{64}$/u.test(input.requestFingerprint) ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0 ||
    !Number.isSafeInteger(absoluteExpiresAtMs) ||
    absoluteExpiresAtMs <= input.nowMs
  ) {
    return invalidInput();
  }
  return Object.freeze({
    documentId,
    documentPath:
      `${privateCustomerBiteSaverActiveSessionCollection}/${documentId}`,
    clientRequestBinding: clientRequestBinding(input.secretKey, input),
    absoluteExpiresAtMs,
  });
}

function parseReplayDocument(
  document: CustomerBiteSaverStoredDocument,
): CustomerBiteSaverRequestReplayDocument {
  const data = document.data;
  const keys = Object.keys(data).sort();
  const evaluationAt = dateValue(data.evaluationAt);
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  if (
    keys.length !== replayDocumentKeys.length ||
    keys.some((key, index) => key !== replayDocumentKeys[index]) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    data.role !== customerBiteSaverRequestReplayRole ||
    data.state !== customerBiteSaverRequestReplayState ||
    typeof data.sessionId !== "string" ||
    !/^bss_[A-Za-z0-9_-]{43}$/u.test(data.sessionId) ||
    !Number.isSafeInteger(data.attemptGeneration) ||
    (data.attemptGeneration as number) < 0 ||
    typeof data.callerCapabilityBinding !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.callerCapabilityBinding) ||
    !isPurpose(data.purpose) ||
    typeof data.clientRequestBinding !== "string" ||
    !/^bsrqb_[A-Za-z0-9_-]{43}$/u.test(data.clientRequestBinding) ||
    typeof data.requestFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.requestFingerprint) ||
    evaluationAt === null ||
    createdAt === null ||
    logicalExpiresAt === null ||
    absoluteExpiresAt === null ||
    expiresAt === null ||
    evaluationAt.getTime() !== createdAt.getTime() ||
    evaluationAt.getTime() >= absoluteExpiresAt.getTime() ||
    logicalExpiresAt.getTime() <= evaluationAt.getTime() ||
    logicalExpiresAt.getTime() > absoluteExpiresAt.getTime() ||
    ((data.purpose !== "restaurantPage" && data.purpose !== "offerPage") &&
      logicalExpiresAt.getTime() !== absoluteExpiresAt.getTime()) ||
    expiresAt.getTime() !== absoluteExpiresAt.getTime()
  ) {
    return invalidState();
  }
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    role: customerBiteSaverRequestReplayRole,
    state: customerBiteSaverRequestReplayState,
    sessionId: data.sessionId,
    attemptGeneration: data.attemptGeneration as number,
    callerCapabilityBinding: data.callerCapabilityBinding,
    purpose: data.purpose,
    clientRequestBinding: data.clientRequestBinding,
    requestFingerprint: data.requestFingerprint,
    evaluationAt,
    createdAt,
    logicalExpiresAt,
    absoluteExpiresAt,
    expiresAt,
  });
}

export async function reserveCustomerBiteSaverRequestReplayInTransaction(
  input: CustomerBiteSaverRequestReplayInput,
  transaction: CustomerBiteSaverTransaction,
): Promise<CustomerBiteSaverRequestReplayReservation> {
  const validated = validateInput(input);
  const existing = await transaction.getDocument(validated.documentPath);
  if (existing !== null) {
    if (
      existing.id !== validated.documentId ||
      existing.path !== validated.documentPath
    ) {
      return invalidState();
    }
    const replay = parseReplayDocument(existing);
    if (
      replay.sessionId !== input.sessionId ||
      replay.attemptGeneration !== input.attemptGeneration ||
      replay.callerCapabilityBinding !== input.callerCapabilityBinding ||
      replay.purpose !== input.purpose ||
      replay.clientRequestBinding !== validated.clientRequestBinding ||
      replay.absoluteExpiresAt.getTime() !== validated.absoluteExpiresAtMs ||
      replay.evaluationAt.getTime() > input.nowMs
    ) {
      return invalidState();
    }
    if (replay.requestFingerprint !== input.requestFingerprint) {
      return reusedRequestId();
    }
    return Object.freeze({
      evaluationAtMs: replay.evaluationAt.getTime(),
      logicalExpiresAtMs: replay.logicalExpiresAt.getTime(),
      replayed: true,
    });
  }

  const evaluationAt = new Date(input.nowMs);
  const absoluteExpiresAt = new Date(validated.absoluteExpiresAtMs);
  const replay: CustomerBiteSaverRequestReplayDocument = Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    role: customerBiteSaverRequestReplayRole,
    state: customerBiteSaverRequestReplayState,
    sessionId: input.sessionId,
    attemptGeneration: input.attemptGeneration,
    callerCapabilityBinding: input.callerCapabilityBinding,
    purpose: input.purpose,
    clientRequestBinding: validated.clientRequestBinding,
    requestFingerprint: input.requestFingerprint,
    evaluationAt,
    createdAt: evaluationAt,
    logicalExpiresAt: absoluteExpiresAt,
    absoluteExpiresAt,
    expiresAt: absoluteExpiresAt,
  });
  transaction.createDocument(validated.documentPath, replay);
  return Object.freeze({
    evaluationAtMs: input.nowMs,
    logicalExpiresAtMs: validated.absoluteExpiresAtMs,
    replayed: false,
  });
}

export async function reserveCustomerBiteSaverRequestReplay(
  input: CustomerBiteSaverRequestReplayInput,
): Promise<CustomerBiteSaverRequestReplayReservation> {
  // Preserve rejection-before-transaction behavior for malformed inputs while
  // keeping the transaction implementation shared with composed callers.
  validateInput(input);
  return input.database.runTransaction((transaction) =>
    reserveCustomerBiteSaverRequestReplayInTransaction(input, transaction));
}

function validateDeadlineInput(
  input: CustomerBiteSaverRequestReplayDeadlineInput,
): Readonly<{
  documentId: string;
  documentPath: string;
  clientRequestBinding: string;
  absoluteExpiresAtMs: number;
}> {
  const documentId = customerBiteSaverRequestReplayDocumentId(
    input.secretKey,
    input,
  );
  const absoluteExpiresAtMs = input.absoluteSessionExpiresAt instanceof Date
    ? input.absoluteSessionExpiresAt.getTime()
    : NaN;
  if (
    (input.purpose !== "restaurantPage" && input.purpose !== "offerPage") ||
    !/^[0-9a-f]{64}$/u.test(input.requestFingerprint) ||
    !Number.isSafeInteger(input.evaluationAtMs) ||
    input.evaluationAtMs < 0 ||
    !Number.isSafeInteger(input.logicalExpiresAtMs) ||
    input.logicalExpiresAtMs <= input.evaluationAtMs ||
    !Number.isSafeInteger(absoluteExpiresAtMs) ||
    input.logicalExpiresAtMs > absoluteExpiresAtMs ||
    input.evaluationAtMs >= absoluteExpiresAtMs ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < input.evaluationAtMs
  ) {
    return invalidInput();
  }
  return Object.freeze({
    documentId,
    documentPath:
      `${privateCustomerBiteSaverActiveSessionCollection}/${documentId}`,
    clientRequestBinding: clientRequestBinding(input.secretKey, input),
    absoluteExpiresAtMs,
  });
}

export async function bindCustomerBiteSaverRequestReplayDeadlineInTransaction(
  input: CustomerBiteSaverRequestReplayDeadlineInput,
  transaction: CustomerBiteSaverTransaction,
): Promise<CustomerBiteSaverRequestReplayDeadlineBinding> {
  const validated = validateDeadlineInput(input);
  const existing = await transaction.getDocument(validated.documentPath);
  if (
    existing === null ||
    existing.id !== validated.documentId ||
    existing.path !== validated.documentPath
  ) {
    return invalidState();
  }
  const replay = parseReplayDocument(existing);
  if (
    replay.sessionId !== input.sessionId ||
    replay.attemptGeneration !== input.attemptGeneration ||
    replay.callerCapabilityBinding !== input.callerCapabilityBinding ||
    replay.purpose !== input.purpose ||
    replay.clientRequestBinding !== validated.clientRequestBinding ||
    replay.requestFingerprint !== input.requestFingerprint ||
    replay.evaluationAt.getTime() !== input.evaluationAtMs ||
    replay.absoluteExpiresAt.getTime() !== validated.absoluteExpiresAtMs
  ) {
    return invalidState();
  }
  const logicalExpiresAtMs = Math.min(
    replay.logicalExpiresAt.getTime(),
    input.logicalExpiresAtMs,
  );
  if (logicalExpiresAtMs !== replay.logicalExpiresAt.getTime()) {
    transaction.setDocument(validated.documentPath, Object.freeze({
      ...replay,
      logicalExpiresAt: new Date(logicalExpiresAtMs),
    }));
  }
  return Object.freeze({
    evaluationAtMs: input.evaluationAtMs,
    logicalExpiresAtMs,
    live: input.nowMs < logicalExpiresAtMs,
  });
}

export async function bindCustomerBiteSaverRequestReplayDeadline(
  input: CustomerBiteSaverRequestReplayDeadlineInput & Readonly<{
    database: CustomerBiteSaverSearchDatabase;
  }>,
): Promise<CustomerBiteSaverRequestReplayDeadlineBinding> {
  validateDeadlineInput(input);
  return input.database.runTransaction((transaction) =>
    bindCustomerBiteSaverRequestReplayDeadlineInTransaction(
      input,
      transaction,
    ));
}

function logicalRedemptionReplayIdentity(
  input: CustomerBiteSaverLogicalRedemptionReplayInput,
): Readonly<{
  documentId: string;
  documentPath: string;
  logicalRequestBinding: string;
  logicalSessionExpiresAtMs: number;
  absoluteSessionExpiresAtMs: number;
}> {
  requireSecretKey(input.secretKey);
  const logicalSessionExpiresAtMs = input.logicalSessionExpiresAt instanceof Date
    ? input.logicalSessionExpiresAt.getTime()
    : NaN;
  const absoluteSessionExpiresAtMs =
    input.absoluteSessionExpiresAt instanceof Date
      ? input.absoluteSessionExpiresAt.getTime()
      : NaN;
  if (
    !/^bss_[A-Za-z0-9_-]{43}$/u.test(input.sessionId) ||
    !Number.isSafeInteger(input.attemptGeneration) ||
    input.attemptGeneration < 0 ||
    !/^[0-9a-f]{64}$/u.test(input.callerCapabilityBinding) ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(input.redemptionRequestId) ||
    !/^[0-9a-f]{64}$/u.test(input.requestFingerprint) ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0 ||
    !Number.isSafeInteger(logicalSessionExpiresAtMs) ||
    logicalSessionExpiresAtMs <= input.nowMs ||
    !Number.isSafeInteger(absoluteSessionExpiresAtMs) ||
    absoluteSessionExpiresAtMs <= input.nowMs ||
    logicalSessionExpiresAtMs > absoluteSessionExpiresAtMs
  ) {
    return invalidInput();
  }
  const identityParts = [
    customerBiteSaverSearchProtocolVersion,
    input.sessionId,
    input.attemptGeneration.toString(10),
    input.callerCapabilityBinding,
    input.redemptionRequestId,
  ];
  const documentId = customerBiteSaverDeterministicId(
    input.secretKey,
    "bslrr",
    "logicalRedemptionReplayDocument",
    identityParts,
  );
  return Object.freeze({
    documentId,
    documentPath:
      `${privateCustomerBiteSaverActiveSessionCollection}/${documentId}`,
    logicalRequestBinding: customerBiteSaverDeterministicId(
      input.secretKey,
      "bslrb",
      "logicalRedemptionRequestBinding",
      identityParts,
    ),
    logicalSessionExpiresAtMs,
    absoluteSessionExpiresAtMs,
  });
}

export async function reserveCustomerBiteSaverLogicalRedemptionReplayInTransaction(
  input: CustomerBiteSaverLogicalRedemptionReplayInput,
  transaction: CustomerBiteSaverTransaction,
): Promise<CustomerBiteSaverLogicalRedemptionReplayReservation> {
  const identity = logicalRedemptionReplayIdentity(input);
  const existing = await transaction.getDocument(identity.documentPath);
  if (existing !== null) {
    const data = existing.data;
    const keys = Object.keys(data).sort();
    const evaluationAt = dateValue(data.evaluationAt);
    const createdAt = dateValue(data.createdAt);
    const logicalExpiresAt = dateValue(data.logicalExpiresAt);
    const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
    const expiresAt = dateValue(data.expiresAt);
    if (
      existing.id !== identity.documentId ||
      existing.path !== identity.documentPath ||
      keys.length !== logicalRedemptionReplayDocumentKeys.length ||
      keys.some((key, index) =>
        key !== logicalRedemptionReplayDocumentKeys[index]) ||
      data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
      data.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
      data.role !== customerBiteSaverLogicalRedemptionReplayRole ||
      data.state !== customerBiteSaverRequestReplayState ||
      data.sessionId !== input.sessionId ||
      data.attemptGeneration !== input.attemptGeneration ||
      data.callerCapabilityBinding !== input.callerCapabilityBinding ||
      data.logicalRequestBinding !== identity.logicalRequestBinding ||
      typeof data.requestFingerprint !== "string" ||
      !/^[0-9a-f]{64}$/u.test(data.requestFingerprint) ||
      evaluationAt === null ||
      createdAt === null ||
      logicalExpiresAt === null ||
      absoluteExpiresAt === null ||
      expiresAt === null ||
      evaluationAt.getTime() !== createdAt.getTime() ||
      evaluationAt.getTime() > input.nowMs ||
      logicalExpiresAt.getTime() <= evaluationAt.getTime() ||
      logicalExpiresAt.getTime() > evaluationAt.getTime() + 60_000 ||
      logicalExpiresAt.getTime() > absoluteExpiresAt.getTime() ||
      absoluteExpiresAt.getTime() !== identity.absoluteSessionExpiresAtMs ||
      expiresAt.getTime() !== absoluteExpiresAt.getTime()
    ) {
      return invalidState();
    }
    if (data.requestFingerprint !== input.requestFingerprint) {
      return reusedRequestId();
    }
    return Object.freeze({
      evaluationAtMs: evaluationAt.getTime(),
      logicalExpiresAtMs: logicalExpiresAt.getTime(),
      replayed: true,
    });
  }
  const logicalExpiresAtMs = Math.min(
    input.nowMs + 60_000,
    identity.logicalSessionExpiresAtMs,
    identity.absoluteSessionExpiresAtMs,
  );
  if (logicalExpiresAtMs <= input.nowMs) {
    return invalidInput();
  }
  const evaluationAt = new Date(input.nowMs);
  const logicalExpiresAt = new Date(logicalExpiresAtMs);
  const absoluteExpiresAt = new Date(identity.absoluteSessionExpiresAtMs);
  transaction.createDocument(identity.documentPath, Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    role: customerBiteSaverLogicalRedemptionReplayRole,
    state: customerBiteSaverRequestReplayState,
    sessionId: input.sessionId,
    attemptGeneration: input.attemptGeneration,
    callerCapabilityBinding: input.callerCapabilityBinding,
    logicalRequestBinding: identity.logicalRequestBinding,
    requestFingerprint: input.requestFingerprint,
    evaluationAt,
    createdAt: evaluationAt,
    logicalExpiresAt,
    absoluteExpiresAt,
    expiresAt: absoluteExpiresAt,
  }));
  return Object.freeze({
    evaluationAtMs: input.nowMs,
    logicalExpiresAtMs,
    replayed: false,
  });
}

export async function reserveCustomerBiteSaverLogicalRedemptionReplay(
  input: CustomerBiteSaverLogicalRedemptionReplayInput,
): Promise<CustomerBiteSaverLogicalRedemptionReplayReservation> {
  logicalRedemptionReplayIdentity(input);
  return input.database.runTransaction((transaction) =>
    reserveCustomerBiteSaverLogicalRedemptionReplayInTransaction(
      input,
      transaction,
    ));
}
