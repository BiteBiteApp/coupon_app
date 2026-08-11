import {createHash} from "node:crypto";
import type {
  DishProposalPrivateDatabase,
  DishProposalPrivateTransaction,
} from "./dish_proposal_private_store.js";

export const reviewMilestoneReconciliationLockCollection =
  "private_review_milestone_reconciliation_locks";
export const reviewMilestoneReconciliationLockVersion =
  "bitestar.review-milestone-lock.v1" as const;
export const reviewMilestoneReconciliationTerminalStateCollection =
  "private_review_milestone_reconciliation_terminal_states";
export const reviewMilestoneReconciliationTerminalStateVersion =
  "bitestar.review-milestone-reconciliation-terminal.v1" as const;

export type ReviewMilestoneReconciliationLockState = "active" | "released";

export type ReviewMilestoneReconciliationLockIdentity = Readonly<{
  userId: string;
  operationId: string;
  lockToken: string;
}>;

export type ReviewMilestoneReconciliationLockDocument = Readonly<{
  version: typeof reviewMilestoneReconciliationLockVersion;
  userId: string;
  operationId: string;
  lockToken: string;
  state: ReviewMilestoneReconciliationLockState;
  createdAt: Date;
  updatedAt: Date;
  fingerprint: string;
}>;

export type ReviewMilestoneReconciliationTerminalStateDocument = Readonly<{
  version: typeof reviewMilestoneReconciliationTerminalStateVersion;
  userId: string;
  operationId: string;
  lockToken: string;
  countComplete: true;
  reconciliationComplete: true;
  countStateFingerprint: string;
  reconciliationStateFingerprint: string;
  fingerprint: string;
}>;

export type ReviewMilestoneReconciliationLockErrorCode =
  | "invalid-request"
  | "invalid-state"
  | "conflict"
  | "missing"
  | "ownership-mismatch"
  | "inactive"
  | "completion-required"
  | "terminal-mismatch";

export class ReviewMilestoneReconciliationLockError extends Error {
  readonly code: ReviewMilestoneReconciliationLockErrorCode;

  constructor(code: ReviewMilestoneReconciliationLockErrorCode) {
    super(lockErrorMessage(code));
    this.name = "ReviewMilestoneReconciliationLockError";
    this.code = code;
  }
}

export type ReviewMilestoneReconciliationLockClaimResult = Readonly<{
  status: "acquired" | "already-owned" | "already-released";
}>;

export type ReviewMilestoneReconciliationLockValidationResult = Readonly<{
  status: "active";
}>;

export type ReviewMilestoneReconciliationLockReleaseResult = Readonly<{
  status: "released" | "already-released";
}>;

export type ReviewMilestoneReconciliationTerminalStateResult = Readonly<{
  status: "recorded" | "already-recorded";
}>;

export interface ReviewMilestoneReconciliationClock {
  now(): Date;
}

export interface ReviewMilestoneReconciliationLockDocumentSnapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): Readonly<Record<string, unknown>> | undefined;
}

export interface ReviewMilestoneReconciliationLockDocumentReference {
  readonly id: string;
  get(): Promise<ReviewMilestoneReconciliationLockDocumentSnapshot>;
}

export interface ReviewMilestoneReconciliationLockCollectionReference {
  doc(id: string): ReviewMilestoneReconciliationLockDocumentReference;
}

export interface ReviewMilestoneReconciliationLockTransaction {
  get(
    reference: ReviewMilestoneReconciliationLockDocumentReference,
  ): Promise<ReviewMilestoneReconciliationLockDocumentSnapshot>;
  set(
    reference: ReviewMilestoneReconciliationLockDocumentReference,
    data: Readonly<Record<string, unknown>>,
  ): unknown;
  delete(
    reference: ReviewMilestoneReconciliationLockDocumentReference,
  ): unknown;
}

export interface ReviewMilestoneReconciliationLockDatabase {
  collection(
    path: string,
  ): ReviewMilestoneReconciliationLockCollectionReference;
  runTransaction<T>(
    operation: (
      transaction: ReviewMilestoneReconciliationLockTransaction,
    ) => Promise<T>,
  ): Promise<T>;
}

export type ReviewMilestoneReconciliationStoredDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

/**
 * This path-based seam is structurally compatible with the private
 * dish-proposal transaction store. It lets Admin-SDK review writers enforce
 * this lock without exposing the lock contract through a public handler.
 */
export interface ReviewMilestoneReconciliationPrivateTransaction {
  getDocument(
    path: string,
  ): Promise<ReviewMilestoneReconciliationStoredDocument | null>;
}

const lockDocumentKeys = Object.freeze([
  "version",
  "userId",
  "operationId",
  "lockToken",
  "state",
  "createdAt",
  "updatedAt",
  "fingerprint",
] as const);

const terminalStateDocumentKeys = Object.freeze([
  "version",
  "userId",
  "operationId",
  "lockToken",
  "countComplete",
  "reconciliationComplete",
  "countStateFingerprint",
  "reconciliationStateFingerprint",
  "fingerprint",
] as const);

function lockErrorMessage(
  code: ReviewMilestoneReconciliationLockErrorCode,
): string {
  switch (code) {
    case "invalid-request":
      return "Private review milestone lock request is invalid.";
    case "invalid-state":
      return "Private review milestone lock state is invalid.";
    case "conflict":
      return "Private review milestone lock is already owned.";
    case "missing":
      return "Private review milestone lock is missing.";
    case "ownership-mismatch":
      return "Private review milestone lock ownership does not match.";
    case "inactive":
      return "Private review milestone lock is not active.";
    case "completion-required":
      return "Private review milestone reconciliation is incomplete.";
    case "terminal-mismatch":
      return "Private review milestone terminal state does not match.";
  }
}

function fail(
  code: ReviewMilestoneReconciliationLockErrorCode,
): never {
  throw new ReviewMilestoneReconciliationLockError(code);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readExactIdentity(
  value: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /(?:^\s|\s$)/u.test(value) ||
    Buffer.byteLength(value, "utf8") > 1_500 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    /^__.*__$/u.test(value) ||
    /\p{Cc}/u.test(value)
  ) {
    return null;
  }
  return value;
}

function requireIdentity(
  value: unknown,
  storedState: boolean,
): string {
  const identity = readExactIdentity(value);
  if (identity === null) {
    fail(storedState ? "invalid-state" : "invalid-request");
  }
  return identity;
}

function requireLockToken(value: unknown, storedState: boolean): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    fail(storedState ? "invalid-state" : "invalid-request");
  }
  return value;
}

function readSafeDate(value: unknown): Date | null {
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    try {
      const converted = value.toDate();
      if (!(converted instanceof Date)) {
        return null;
      }
      date = converted;
    } catch {
      return null;
    }
  } else {
    return null;
  }
  const milliseconds = date.getTime();
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? new Date(milliseconds)
    : null;
}

function requireDate(value: unknown, storedState: boolean): Date {
  const date = readSafeDate(value);
  if (date === null) {
    fail(storedState ? "invalid-state" : "invalid-request");
  }
  return date;
}

function requireFingerprint(value: unknown, storedState: boolean): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    fail(storedState ? "invalid-state" : "invalid-request");
  }
  return value;
}

function contractFingerprint(
  version: string,
  fields: readonly (readonly [string, string | number | boolean])[],
): string {
  return createHash("sha256")
    .update(JSON.stringify([version, ...fields]), "utf8")
    .digest("hex");
}

function lockFingerprint(
  lock: Omit<ReviewMilestoneReconciliationLockDocument, "fingerprint">,
): string {
  return contractFingerprint(reviewMilestoneReconciliationLockVersion, [
    ["userId", lock.userId],
    ["operationId", lock.operationId],
    ["lockToken", lock.lockToken],
    ["state", lock.state],
    ["createdAt", lock.createdAt.getTime()],
    ["updatedAt", lock.updatedAt.getTime()],
  ]);
}

function terminalStateFingerprint(
  terminal: Omit<
    ReviewMilestoneReconciliationTerminalStateDocument,
    "fingerprint"
  >,
): string {
  return contractFingerprint(
    reviewMilestoneReconciliationTerminalStateVersion,
    [
      ["userId", terminal.userId],
      ["operationId", terminal.operationId],
      ["lockToken", terminal.lockToken],
      ["countComplete", terminal.countComplete],
      ["reconciliationComplete", terminal.reconciliationComplete],
      ["countStateFingerprint", terminal.countStateFingerprint],
      [
        "reconciliationStateFingerprint",
        terminal.reconciliationStateFingerprint,
      ],
    ],
  );
}

function requireRequestIdentity(
  value: ReviewMilestoneReconciliationLockIdentity,
): ReviewMilestoneReconciliationLockIdentity {
  if (!isRecord(value)) {
    fail("invalid-request");
  }
  return Object.freeze({
    userId: requireIdentity(value.userId, false),
    operationId: requireIdentity(value.operationId, false),
    lockToken: requireLockToken(value.lockToken, false),
  });
}

function requireNow(clock: ReviewMilestoneReconciliationClock): Date {
  if (!isRecord(clock) || typeof clock.now !== "function") {
    fail("invalid-request");
  }
  try {
    return requireDate(clock.now(), false);
  } catch (error) {
    if (error instanceof ReviewMilestoneReconciliationLockError) {
      throw error;
    }
    return fail("invalid-request");
  }
}

export function reviewMilestoneReconciliationLockPath(userId: string): string {
  const exactUserId = requireIdentity(userId, false);
  return `${reviewMilestoneReconciliationLockCollection}/${exactUserId}`;
}

export function buildReviewMilestoneReconciliationLockDocument(
  value: Readonly<{
    userId: string;
    operationId: string;
    lockToken: string;
    state: ReviewMilestoneReconciliationLockState;
    createdAt: Date;
    updatedAt: Date;
  }>,
): ReviewMilestoneReconciliationLockDocument {
  if (!isRecord(value) || (value.state !== "active" && value.state !== "released")) {
    fail("invalid-request");
  }
  const core = Object.freeze({
    version: reviewMilestoneReconciliationLockVersion,
    userId: requireIdentity(value.userId, false),
    operationId: requireIdentity(value.operationId, false),
    lockToken: requireLockToken(value.lockToken, false),
    state: value.state,
    createdAt: requireDate(value.createdAt, false),
    updatedAt: requireDate(value.updatedAt, false),
  });
  if (core.updatedAt.getTime() < core.createdAt.getTime()) {
    fail("invalid-request");
  }
  return Object.freeze({...core, fingerprint: lockFingerprint(core)});
}

export function parseReviewMilestoneReconciliationLockDocument(
  document: ReviewMilestoneReconciliationStoredDocument | null,
): ReviewMilestoneReconciliationLockDocument | null {
  if (document === null) {
    return null;
  }
  try {
    if (!isRecord(document) || !isRecord(document.data) ||
        !hasExactKeys(document.data, lockDocumentKeys)) {
      return fail("invalid-state");
    }
    const data = document.data;
    if (
      data.version !== reviewMilestoneReconciliationLockVersion ||
      (data.state !== "active" && data.state !== "released")
    ) {
      return fail("invalid-state");
    }
    const core = Object.freeze({
      version: reviewMilestoneReconciliationLockVersion,
      userId: requireIdentity(data.userId, true),
      operationId: requireIdentity(data.operationId, true),
      lockToken: requireLockToken(data.lockToken, true),
      state: data.state,
      createdAt: requireDate(data.createdAt, true),
      updatedAt: requireDate(data.updatedAt, true),
    });
    if (
      document.id !== core.userId ||
      core.updatedAt.getTime() < core.createdAt.getTime() ||
      requireFingerprint(data.fingerprint, true) !== lockFingerprint(core)
    ) {
      return fail("invalid-state");
    }
    return Object.freeze({...core, fingerprint: data.fingerprint as string});
  } catch (error) {
    if (
      error instanceof ReviewMilestoneReconciliationLockError &&
      error.code === "invalid-state"
    ) {
      throw error;
    }
    return fail("invalid-state");
  }
}

export function reviewMilestoneReconciliationTerminalStatePath(
  userId: string,
): string {
  const exactUserId = requireIdentity(userId, false);
  return `${reviewMilestoneReconciliationTerminalStateCollection}/${
    exactUserId
  }`;
}

export function buildReviewMilestoneReconciliationTerminalStateDocument(
  value: Readonly<{
    userId: string;
    operationId: string;
    lockToken: string;
    countComplete: true;
    reconciliationComplete: true;
    countStateFingerprint: string;
    reconciliationStateFingerprint: string;
  }>,
): ReviewMilestoneReconciliationTerminalStateDocument {
  if (
    !isRecord(value) ||
    value.countComplete !== true ||
    value.reconciliationComplete !== true
  ) {
    fail("completion-required");
  }
  const core = Object.freeze({
    version: reviewMilestoneReconciliationTerminalStateVersion,
    userId: requireIdentity(value.userId, false),
    operationId: requireIdentity(value.operationId, false),
    lockToken: requireLockToken(value.lockToken, false),
    countComplete: true as const,
    reconciliationComplete: true as const,
    countStateFingerprint: requireFingerprint(
      value.countStateFingerprint,
      false,
    ),
    reconciliationStateFingerprint: requireFingerprint(
      value.reconciliationStateFingerprint,
      false,
    ),
  });
  return Object.freeze({
    ...core,
    fingerprint: terminalStateFingerprint(core),
  });
}

export function parseReviewMilestoneReconciliationTerminalStateDocument(
  document: ReviewMilestoneReconciliationStoredDocument | null,
): ReviewMilestoneReconciliationTerminalStateDocument | null {
  if (document === null) {
    return null;
  }
  try {
    if (!isRecord(document) || !isRecord(document.data) ||
        !hasExactKeys(document.data, terminalStateDocumentKeys)) {
      return fail("invalid-state");
    }
    const data = document.data;
    if (
      data.version !== reviewMilestoneReconciliationTerminalStateVersion ||
      data.countComplete !== true ||
      data.reconciliationComplete !== true
    ) {
      return fail("invalid-state");
    }
    const terminal = buildReviewMilestoneReconciliationTerminalStateDocument({
      userId: requireIdentity(data.userId, true),
      operationId: requireIdentity(data.operationId, true),
      lockToken: requireLockToken(data.lockToken, true),
      countComplete: true,
      reconciliationComplete: true,
      countStateFingerprint: requireFingerprint(
        data.countStateFingerprint,
        true,
      ),
      reconciliationStateFingerprint: requireFingerprint(
        data.reconciliationStateFingerprint,
        true,
      ),
    });
    if (
      document.id !== terminal.userId ||
      requireFingerprint(data.fingerprint, true) !== terminal.fingerprint
    ) {
      return fail("invalid-state");
    }
    return terminal;
  } catch (error) {
    if (
      error instanceof ReviewMilestoneReconciliationLockError &&
      error.code === "invalid-state"
    ) {
      throw error;
    }
    return fail("invalid-state");
  }
}

function documentFromSnapshot(
  snapshot: ReviewMilestoneReconciliationLockDocumentSnapshot,
): ReviewMilestoneReconciliationStoredDocument | null {
  if (!snapshot.exists) {
    return null;
  }
  const data = snapshot.data();
  if (data === undefined) {
    return fail("invalid-state");
  }
  return {id: snapshot.id, data};
}

function identitiesMatch(
  left: ReviewMilestoneReconciliationLockIdentity,
  right: ReviewMilestoneReconciliationLockIdentity,
): boolean {
  return left.userId === right.userId &&
    left.operationId === right.operationId &&
    left.lockToken === right.lockToken;
}

function requireMatchingTerminalState(
  terminal: ReviewMilestoneReconciliationTerminalStateDocument | null,
  identity: ReviewMilestoneReconciliationLockIdentity,
  missingCode: ReviewMilestoneReconciliationLockErrorCode,
): ReviewMilestoneReconciliationTerminalStateDocument {
  if (terminal === null) {
    return fail(missingCode);
  }
  if (!identitiesMatch(terminal, identity)) {
    return fail(missingCode);
  }
  return terminal;
}

export function assertActiveReviewMilestoneReconciliationLock(
  lock: ReviewMilestoneReconciliationLockDocument | null,
  expectedIdentity: ReviewMilestoneReconciliationLockIdentity,
): ReviewMilestoneReconciliationLockDocument {
  const expected = requireRequestIdentity(expectedIdentity);
  if (lock === null) {
    return fail("missing");
  }
  if (!identitiesMatch(lock, expected)) {
    return fail("ownership-mismatch");
  }
  if (lock.state !== "active") {
    return fail("inactive");
  }
  return lock;
}

export async function assertActiveReviewMilestoneReconciliationLockInTransaction(
  database: ReviewMilestoneReconciliationLockDatabase,
  transaction: ReviewMilestoneReconciliationLockTransaction,
  identity: ReviewMilestoneReconciliationLockIdentity,
): Promise<ReviewMilestoneReconciliationLockDocument> {
  const exactIdentity = requireRequestIdentity(identity);
  const reference = database
    .collection(reviewMilestoneReconciliationLockCollection)
    .doc(exactIdentity.userId);
  const stored = parseReviewMilestoneReconciliationLockDocument(
    documentFromSnapshot(await transaction.get(reference)),
  );
  return assertActiveReviewMilestoneReconciliationLock(stored, exactIdentity);
}

export async function assertActiveReviewMilestoneReconciliationLockInPrivateTransaction(
  transaction: ReviewMilestoneReconciliationPrivateTransaction,
  identity: ReviewMilestoneReconciliationLockIdentity,
): Promise<ReviewMilestoneReconciliationLockDocument> {
  const exactIdentity = requireRequestIdentity(identity);
  const stored = parseReviewMilestoneReconciliationLockDocument(
    await transaction.getDocument(
      reviewMilestoneReconciliationLockPath(exactIdentity.userId),
    ),
  );
  return assertActiveReviewMilestoneReconciliationLock(stored, exactIdentity);
}

export async function assertReviewMilestoneReconciliationUserUnlockedInPrivateTransaction(
  transaction: ReviewMilestoneReconciliationPrivateTransaction,
  userId: string,
): Promise<void> {
  const exactUserId = requireIdentity(userId, false);
  const lock = parseReviewMilestoneReconciliationLockDocument(
    await transaction.getDocument(
      reviewMilestoneReconciliationLockPath(exactUserId),
    ),
  );
  if (lock?.state === "active") {
    fail("conflict");
  }
}

export async function recordReviewMilestoneReconciliationTerminalState(
  database: ReviewMilestoneReconciliationLockDatabase,
  identity: ReviewMilestoneReconciliationLockIdentity,
  state: Readonly<{
    countStateFingerprint: string;
    reconciliationStateFingerprint: string;
  }>,
): Promise<ReviewMilestoneReconciliationTerminalStateResult> {
  const exactIdentity = requireRequestIdentity(identity);
  if (!isRecord(state)) {
    return fail("invalid-request");
  }
  const terminal = buildReviewMilestoneReconciliationTerminalStateDocument({
    ...exactIdentity,
    countComplete: true,
    reconciliationComplete: true,
    countStateFingerprint: state.countStateFingerprint,
    reconciliationStateFingerprint: state.reconciliationStateFingerprint,
  });
  return database.runTransaction(async (transaction) => {
    await assertActiveReviewMilestoneReconciliationLockInTransaction(
      database,
      transaction,
      exactIdentity,
    );
    const reference = database
      .collection(reviewMilestoneReconciliationTerminalStateCollection)
      .doc(exactIdentity.userId);
    const existing = parseReviewMilestoneReconciliationTerminalStateDocument(
      documentFromSnapshot(await transaction.get(reference)),
    );
    if (existing === null) {
      transaction.set(reference, terminal);
      return Object.freeze({status: "recorded" as const});
    }
    if (existing.fingerprint !== terminal.fingerprint) {
      return fail("terminal-mismatch");
    }
    return Object.freeze({status: "already-recorded" as const});
  });
}

/**
 * Decorates the existing private dish-proposal store so every bounded review
 * query checks the exact queried review authors' locks in the same Firestore
 * transaction. Noncanonical source identities are preserved for the caller;
 * they are not silently normalized into another user's lock identity.
 */
export function createReviewMilestoneLockEnforcedDishProposalPrivateDatabase(
  database: DishProposalPrivateDatabase,
): DishProposalPrivateDatabase {
  return {
    runTransaction<T>(operation: (
      transaction: DishProposalPrivateTransaction,
    ) => Promise<T>): Promise<T> {
      return database.runTransaction(async (transaction) => {
        const lockEnforcedTransaction: DishProposalPrivateTransaction = {
          getDocument(documentPath) {
            return transaction.getDocument(documentPath);
          },
          async queryDocuments(query) {
            const documents = await transaction.queryDocuments(query);
            if (query.collectionPath !== "dish_reviews") {
              return documents;
            }
            const exactUserIds = new Set<string>();
            for (const document of documents) {
              const userId = readExactIdentity(document.data.userId);
              if (userId !== null) {
                exactUserIds.add(userId);
              }
            }
            for (const userId of exactUserIds) {
              await assertReviewMilestoneReconciliationUserUnlockedInPrivateTransaction(
                transaction,
                userId,
              );
            }
            return documents;
          },
          setDocument(documentPath, data, options) {
            transaction.setDocument(documentPath, data, options);
          },
          deleteDocument(documentPath) {
            transaction.deleteDocument(documentPath);
          },
        };
        return operation(lockEnforcedTransaction);
      });
    },
  };
}

export async function claimReviewMilestoneReconciliationLock(
  database: ReviewMilestoneReconciliationLockDatabase,
  identity: ReviewMilestoneReconciliationLockIdentity,
  clock: ReviewMilestoneReconciliationClock,
): Promise<ReviewMilestoneReconciliationLockClaimResult> {
  const exactIdentity = requireRequestIdentity(identity);
  const now = requireNow(clock);
  return database.runTransaction(async (transaction) => {
    const reference = database
      .collection(reviewMilestoneReconciliationLockCollection)
      .doc(exactIdentity.userId);
    const terminalReference = database
      .collection(reviewMilestoneReconciliationTerminalStateCollection)
      .doc(exactIdentity.userId);
    const existing = parseReviewMilestoneReconciliationLockDocument(
      documentFromSnapshot(await transaction.get(reference)),
    );
    const terminal = parseReviewMilestoneReconciliationTerminalStateDocument(
      documentFromSnapshot(await transaction.get(terminalReference)),
    );
    if (existing === null && terminal !== null) {
      return fail("invalid-state");
    }
    if (existing?.state === "active") {
      if (terminal !== null) {
        requireMatchingTerminalState(terminal, existing, "invalid-state");
      }
      if (identitiesMatch(existing, exactIdentity)) {
        return Object.freeze({status: "already-owned" as const});
      }
      return fail("conflict");
    }
    if (existing?.state === "released") {
      requireMatchingTerminalState(terminal, existing, "invalid-state");
      if (existing.operationId === exactIdentity.operationId) {
        if (existing.lockToken === exactIdentity.lockToken) {
          return Object.freeze({status: "already-released" as const});
        }
        return fail("conflict");
      }
      transaction.delete(terminalReference);
    }
    const lock = buildReviewMilestoneReconciliationLockDocument({
      ...exactIdentity,
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(reference, lock);
    return Object.freeze({status: "acquired" as const});
  });
}

export async function validateReviewMilestoneReconciliationLock(
  database: ReviewMilestoneReconciliationLockDatabase,
  identity: ReviewMilestoneReconciliationLockIdentity,
): Promise<ReviewMilestoneReconciliationLockValidationResult> {
  const exactIdentity = requireRequestIdentity(identity);
  return database.runTransaction(async (transaction) => {
    await assertActiveReviewMilestoneReconciliationLockInTransaction(
      database,
      transaction,
      exactIdentity,
    );
    return Object.freeze({status: "active" as const});
  });
}

export async function releaseReviewMilestoneReconciliationLock(
  database: ReviewMilestoneReconciliationLockDatabase,
  identity: ReviewMilestoneReconciliationLockIdentity,
  clock: ReviewMilestoneReconciliationClock,
): Promise<ReviewMilestoneReconciliationLockReleaseResult> {
  const exactIdentity = requireRequestIdentity(identity);
  const now = requireNow(clock);
  return database.runTransaction(async (transaction) => {
    const reference = database
      .collection(reviewMilestoneReconciliationLockCollection)
      .doc(exactIdentity.userId);
    const terminalReference = database
      .collection(reviewMilestoneReconciliationTerminalStateCollection)
      .doc(exactIdentity.userId);
    const existing = parseReviewMilestoneReconciliationLockDocument(
      documentFromSnapshot(await transaction.get(reference)),
    );
    if (existing === null) {
      return fail("missing");
    }
    if (!identitiesMatch(existing, exactIdentity)) {
      return fail("ownership-mismatch");
    }
    const terminal = parseReviewMilestoneReconciliationTerminalStateDocument(
      documentFromSnapshot(await transaction.get(terminalReference)),
    );
    requireMatchingTerminalState(terminal, exactIdentity, "completion-required");
    if (existing.state === "released") {
      return Object.freeze({status: "already-released" as const});
    }
    if (now.getTime() < existing.updatedAt.getTime()) {
      return fail("invalid-request");
    }
    const released = buildReviewMilestoneReconciliationLockDocument({
      ...exactIdentity,
      state: "released",
      createdAt: existing.createdAt,
      updatedAt: now,
    });
    transaction.set(reference, released);
    return Object.freeze({status: "released" as const});
  });
}
