import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";

import {
  ownerBillingStateCollection,
  parseOwnerBillingStateDocument,
  resolveAuthoritativeOwnerBillingPosture,
} from "./owner_billing_state_contract.js";
import {
  buildOwnerRecordRemovalJobDocument,
  createEmptyOwnerRecordRemovalCounters,
  createOwnerRecordRemovalCallerFingerprint,
  createOwnerRecordRemovalJobId,
  type OwnerRecordRemovalBillingGateCategory,
  type OwnerRecordRemovalClaimRequest,
  type OwnerRecordRemovalJobDocument,
  ownerRecordRemovalJobPath,
  parseOwnerRecordRemovalClaimRequest,
  parseOwnerRecordRemovalJobDocument,
  parseOwnerRecordRemovalResumeRequest,
  rebuildOwnerRecordRemovalJobDocument,
  type OwnerRecordRemovalResumeRequest,
} from "./owner_record_removal_contract.js";
import {
  buildOwnerRecordStateDocument,
  ownerRecordStateCollection,
  parseOwnerRecordStateDocument,
  type OwnerRecordStateDocument,
} from "./owner_record_state_contract.js";

export type OwnerRecordRemovalStoredDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type OwnerRecordRemovalPrivateQuery = Readonly<{
  collectionPath: string;
  where?: readonly Readonly<{
    field: string;
    operator: "==";
    value: unknown;
  }>[];
  orderByDocumentId?: "asc";
  limit: number;
}>;

export interface OwnerRecordRemovalPrivateTransaction {
  getDocument(path: string): Promise<OwnerRecordRemovalStoredDocument | null>;
  queryDocuments(
    query: OwnerRecordRemovalPrivateQuery,
  ): Promise<readonly OwnerRecordRemovalStoredDocument[]>;
  setDocument(
    path: string,
    data: Readonly<Record<string, unknown>>,
    options?: Readonly<{merge: boolean}>,
  ): void;
  deleteDocument(path: string): void;
}

export interface OwnerRecordRemovalPrivateDatabase {
  runTransaction<T>(
    operation: (
      transaction: OwnerRecordRemovalPrivateTransaction,
    ) => Promise<T>,
  ): Promise<T>;
}

export interface OwnerRecordRemovalAuthority {
  resolveCallerAdmin(callerUid: string): Promise<unknown>;
  lookupTargetAuth(targetUid: string): Promise<unknown | null>;
}

export type OwnerRecordRemovalClaimContext = Readonly<{
  database: OwnerRecordRemovalPrivateDatabase;
  authority: OwnerRecordRemovalAuthority;
  clock?: () => Date;
}>;

export type OwnerRecordRemovalClaimErrorCode =
  | "invalid_request"
  | "authority_unavailable"
  | "permission_denied"
  | "self_target_forbidden"
  | "target_admin_forbidden"
  | "malformed_private_state"
  | "owner_state_unavailable"
  | "operation_conflict"
  | "generation_mismatch"
  | "generation_exhausted";

export class OwnerRecordRemovalClaimError extends Error {
  readonly code: OwnerRecordRemovalClaimErrorCode;

  constructor(code: OwnerRecordRemovalClaimErrorCode) {
    super("Owner-record removal is unavailable.");
    this.name = "OwnerRecordRemovalClaimError";
    this.code = code;
  }
}

const betaAdminEmail = "schuyler.cole@gmail.com";

function claimError(code: OwnerRecordRemovalClaimErrorCode): never {
  throw new OwnerRecordRemovalClaimError(code);
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length &&
    expected.every((key) => keys.includes(key));
}

function currentTime(clock: (() => Date) | undefined): Date {
  const now = clock?.() ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return claimError("invalid_request");
  }
  return new Date(now.getTime());
}

async function authorizeRequest(
  authority: OwnerRecordRemovalAuthority,
  request: OwnerRecordRemovalClaimRequest,
): Promise<void> {
  let rawCaller: unknown;
  try {
    rawCaller = await authority.resolveCallerAdmin(request.callerUid);
  } catch {
    return claimError("authority_unavailable");
  }
  const caller = plainRecord(rawCaller);
  if (
    caller === null ||
    !exactKeys(caller, ["uid", "isAdmin"]) ||
    caller.uid !== request.callerUid ||
    typeof caller.isAdmin !== "boolean"
  ) {
    return claimError("authority_unavailable");
  }
  if (caller.isAdmin !== true) {
    return claimError("permission_denied");
  }
  if (request.callerUid === request.targetUid) {
    return claimError("self_target_forbidden");
  }

  let rawTarget: unknown | null;
  try {
    rawTarget = await authority.lookupTargetAuth(request.targetUid);
  } catch {
    return claimError("authority_unavailable");
  }
  if (rawTarget === null) {
    return;
  }
  const target = plainRecord(rawTarget);
  if (
    target === null ||
    !exactKeys(target, ["uid", "email", "customClaims"]) ||
    target.uid !== request.targetUid ||
    (target.email !== null && typeof target.email !== "string")
  ) {
    return claimError("authority_unavailable");
  }
  const claims = plainRecord(target.customClaims);
  if (claims === null) {
    return claimError("authority_unavailable");
  }
  const email = typeof target.email === "string"
    ? target.email.trim().toLowerCase()
    : null;
  if (claims.admin === true || email === betaAdminEmail) {
    return claimError("target_admin_forbidden");
  }
}

function ownerStatePath(uid: string): string {
  return `${ownerRecordStateCollection}/${uid}`;
}

function billingStatePath(uid: string): string {
  return `${ownerBillingStateCollection}/${uid}`;
}

function parseOwner(
  targetUid: string,
  document: OwnerRecordRemovalStoredDocument | null,
): OwnerRecordStateDocument {
  let owner: OwnerRecordStateDocument | null;
  try {
    owner = parseOwnerRecordStateDocument(document);
  } catch {
    return claimError("malformed_private_state");
  }
  if (owner === null) {
    return claimError("owner_state_unavailable");
  }
  if (owner.ownerUid !== targetUid) {
    return claimError("malformed_private_state");
  }
  return owner;
}

function parseJob(
  document: OwnerRecordRemovalStoredDocument | null,
): OwnerRecordRemovalJobDocument | null {
  try {
    return parseOwnerRecordRemovalJobDocument(document);
  } catch {
    return claimError("malformed_private_state");
  }
}

function requireMatchingJob(
  job: OwnerRecordRemovalJobDocument,
  request: OwnerRecordRemovalClaimRequest,
  sourceGeneration: number,
): OwnerRecordRemovalJobDocument {
  const expectedJobId = createOwnerRecordRemovalJobId({
    targetUid: request.targetUid,
    sourceGeneration,
  });
  if (
    job.jobId !== expectedJobId ||
    job.operation !== request.operation ||
    job.targetUid !== request.targetUid ||
    job.sourceGeneration !== sourceGeneration ||
    job.requestId !== request.requestId ||
    job.callerFingerprint !==
      createOwnerRecordRemovalCallerFingerprint(request.callerUid)
  ) {
    return claimError("operation_conflict");
  }
  return job;
}

function sourceGenerationForOwner(owner: OwnerRecordStateDocument): number {
  if (owner.state === "open") {
    return owner.generation;
  }
  if (owner.generation === 0) {
    return claimError("generation_mismatch");
  }
  return owner.generation - 1;
}

function requirePostCutoverRetryState(
  owner: OwnerRecordStateDocument,
  job: OwnerRecordRemovalJobDocument,
): void {
  if (
    !job.cutoverApplied ||
    job.completionGeneration !== owner.generation ||
    (job.status === "complete"
      ? (owner.state !== "removed" && owner.state !== "open") ||
        owner.activeJobId !== null
      : owner.state !== "removing" || owner.activeJobId !== job.jobId)
  ) {
    claimError("generation_mismatch");
  }
}

function billingGateFailure(
  category: Exclude<OwnerRecordRemovalBillingGateCategory, "inactive">,
): "billing_resolution_required" | "billing_state_unknown" {
  return category === "blocking"
    ? "billing_resolution_required"
    : "billing_state_unknown";
}

function newJob(params: {
  request: OwnerRecordRemovalClaimRequest;
  sourceGeneration: number;
  billingCategory: OwnerRecordRemovalBillingGateCategory;
  now: Date;
}): OwnerRecordRemovalJobDocument {
  const jobId = createOwnerRecordRemovalJobId({
    targetUid: params.request.targetUid,
    sourceGeneration: params.sourceGeneration,
  });
  const cutover = params.billingCategory === "inactive";
  return buildOwnerRecordRemovalJobDocument({
    operation: "ownerRecordRemoval",
    jobId,
    requestId: params.request.requestId,
    callerFingerprint:
      createOwnerRecordRemovalCallerFingerprint(params.request.callerUid),
    targetUid: params.request.targetUid,
    status: cutover ? "active" : "manual_review_required",
    phase: cutover ? "unclaim_rating_restaurants" : "billing_gate",
    sourceGeneration: params.sourceGeneration,
    completionGeneration: cutover ? params.sourceGeneration + 1 : null,
    cutoverApplied: cutover,
    billingGateCategory: params.billingCategory,
    failureCategory: params.billingCategory === "inactive"
      ? null
      : billingGateFailure(params.billingCategory),
    ...createEmptyOwnerRecordRemovalCounters(),
    createdAt: params.now,
    updatedAt: params.now,
    completedAt: null,
  });
}

function cutoverOwner(
  owner: OwnerRecordStateDocument,
  jobId: string,
  now: Date,
): OwnerRecordStateDocument {
  if (
    owner.state !== "open" ||
    owner.activeJobId !== null ||
    owner.generation === Number.MAX_SAFE_INTEGER
  ) {
    return claimError(owner.generation === Number.MAX_SAFE_INTEGER
      ? "generation_exhausted"
      : "generation_mismatch");
  }
  return buildOwnerRecordStateDocument({
    ownerUid: owner.ownerUid,
    generation: owner.generation + 1,
    state: "removing",
    activeJobId: jobId,
    createdAt: owner.createdAt,
    updatedAt: now,
  });
}

async function resolveBilling(
  transaction: OwnerRecordRemovalPrivateTransaction,
  owner: OwnerRecordStateDocument,
): Promise<OwnerRecordRemovalBillingGateCategory> {
  const stored = await transaction.getDocument(
    billingStatePath(owner.ownerUid),
  );
  try {
    const billing = parseOwnerBillingStateDocument(stored);
    return resolveAuthoritativeOwnerBillingPosture(owner, billing);
  } catch {
    return "unknown";
  }
}

function transitionBillingGateJob(
  current: OwnerRecordRemovalJobDocument,
  category: OwnerRecordRemovalBillingGateCategory,
  now: Date,
): OwnerRecordRemovalJobDocument {
  if (category === "inactive") {
    return rebuildOwnerRecordRemovalJobDocument(current, {
      status: "active",
      phase: "unclaim_rating_restaurants",
      completionGeneration: current.sourceGeneration + 1,
      cutoverApplied: true,
      billingGateCategory: "inactive",
      failureCategory: null,
      now,
    });
  }
  if (
    current.billingGateCategory === category &&
    current.failureCategory === billingGateFailure(category)
  ) {
    return current;
  }
  return rebuildOwnerRecordRemovalJobDocument(current, {
    status: "manual_review_required",
    phase: "billing_gate",
    completionGeneration: null,
    cutoverApplied: false,
    billingGateCategory: category,
    failureCategory: billingGateFailure(category),
    now,
  });
}

async function claimInTransaction(
  transaction: OwnerRecordRemovalPrivateTransaction,
  request: OwnerRecordRemovalClaimRequest,
  now: Date,
): Promise<OwnerRecordRemovalJobDocument> {
  const owner = parseOwner(
    request.targetUid,
    await transaction.getDocument(ownerStatePath(request.targetUid)),
  );
  const sourceGeneration = sourceGenerationForOwner(owner);
  const jobId = createOwnerRecordRemovalJobId({
    targetUid: request.targetUid,
    sourceGeneration,
  });

  if (owner.state !== "open") {
    const existing = parseJob(
      await transaction.getDocument(ownerRecordRemovalJobPath(jobId)),
    );
    if (existing === null) {
      return claimError("generation_mismatch");
    }
    const matching = requireMatchingJob(existing, request, sourceGeneration);
    requirePostCutoverRetryState(owner, matching);
    return matching;
  }
  if (owner.activeJobId !== null) {
    return claimError("malformed_private_state");
  }
  const category = await resolveBilling(transaction, owner);
  if (owner.generation > 0) {
    const previousJobId = createOwnerRecordRemovalJobId({
      targetUid: request.targetUid,
      sourceGeneration: owner.generation - 1,
    });
    const previous = parseJob(await transaction.getDocument(
      ownerRecordRemovalJobPath(previousJobId),
    ));
    if (previous !== null && previous.status !== "complete") {
      return claimError("generation_mismatch");
    }
  }
  const existing = parseJob(
    await transaction.getDocument(ownerRecordRemovalJobPath(jobId)),
  );
  let job: OwnerRecordRemovalJobDocument;
  if (existing === null) {
    if (owner.generation === Number.MAX_SAFE_INTEGER && category === "inactive") {
      return claimError("generation_exhausted");
    }
    job = newJob({request, sourceGeneration, billingCategory: category, now});
  } else {
    job = requireMatchingJob(existing, request, sourceGeneration);
    if (job.phase !== "billing_gate" || job.cutoverApplied) {
      return claimError("operation_conflict");
    }
    if (owner.generation === Number.MAX_SAFE_INTEGER && category === "inactive") {
      return claimError("generation_exhausted");
    }
    job = transitionBillingGateJob(job, category, now);
  }
  if (category === "inactive") {
    transaction.setDocument(ownerStatePath(request.targetUid),
      cutoverOwner(owner, job.jobId, now));
  }
  if (existing === null || job.fingerprint !== existing.fingerprint) {
    transaction.setDocument(ownerRecordRemovalJobPath(job.jobId), job);
  }
  return job;
}

export async function claimOwnerRecordRemoval(
  context: OwnerRecordRemovalClaimContext,
  rawRequest: unknown,
): Promise<OwnerRecordRemovalJobDocument> {
  let request: OwnerRecordRemovalClaimRequest;
  try {
    request = parseOwnerRecordRemovalClaimRequest(rawRequest);
  } catch {
    return claimError("invalid_request");
  }
  await authorizeRequest(context.authority, request);
  const now = currentTime(context.clock);
  return context.database.runTransaction((transaction) =>
    claimInTransaction(transaction, request, now));
}

export async function resumeOwnerRecordRemovalAfterBilling(
  context: OwnerRecordRemovalClaimContext,
  rawRequest: unknown,
): Promise<OwnerRecordRemovalJobDocument> {
  let request: OwnerRecordRemovalResumeRequest;
  try {
    request = parseOwnerRecordRemovalResumeRequest(rawRequest);
  } catch {
    return claimError("invalid_request");
  }
  await authorizeRequest(context.authority, request);
  const now = currentTime(context.clock);
  return context.database.runTransaction(async (transaction) => {
    const job = parseJob(
      await transaction.getDocument(ownerRecordRemovalJobPath(request.jobId)),
    );
    if (job === null) {
      return claimError("owner_state_unavailable");
    }
    const matching = requireMatchingJob(job, request, job.sourceGeneration);
    if (matching.jobId !== request.jobId) {
      return claimError("operation_conflict");
    }
    const owner = parseOwner(
      request.targetUid,
      await transaction.getDocument(ownerStatePath(request.targetUid)),
    );
    if (matching.cutoverApplied) {
      requirePostCutoverRetryState(owner, matching);
      return matching;
    }
    if (
      matching.phase !== "billing_gate" ||
      owner.state !== "open" ||
      owner.activeJobId !== null ||
      owner.generation !== matching.sourceGeneration
    ) {
      return claimError("generation_mismatch");
    }
    const category = await resolveBilling(transaction, owner);
    if (owner.generation === Number.MAX_SAFE_INTEGER && category === "inactive") {
      return claimError("generation_exhausted");
    }
    const next = transitionBillingGateJob(matching, category, now);
    if (category === "inactive") {
      transaction.setDocument(ownerStatePath(request.targetUid),
        cutoverOwner(owner, next.jobId, now));
    }
    if (next.fingerprint !== matching.fingerprint) {
      transaction.setDocument(ownerRecordRemovalJobPath(next.jobId), next);
    }
    return next;
  });
}

function firestoreTransactionBoundary(
  database: Firestore,
  transaction: Transaction,
): OwnerRecordRemovalPrivateTransaction {
  return {
    async getDocument(path) {
      const snapshot = await transaction.get(database.doc(path));
      return snapshot.exists
        ? {id: snapshot.id, data: snapshot.data() ?? {}}
        : null;
    },
    async queryDocuments(options) {
      if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
        throw new Error("Owner-record removal query is invalid.");
      }
      let query: Query<DocumentData, DocumentData> =
        database.collection(options.collectionPath);
      for (const condition of options.where ?? []) {
        query = query.where(
          condition.field === "__name__"
            ? FieldPath.documentId()
            : condition.field,
          condition.operator,
          condition.value,
        );
      }
      if (options.orderByDocumentId === "asc") {
        query = query.orderBy(FieldPath.documentId(), "asc");
      }
      const snapshot = await transaction.get(query.limit(options.limit));
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data() as Readonly<Record<string, unknown>>,
      }));
    },
    setDocument(path, data, options) {
      if (options === undefined) {
        transaction.set(database.doc(path), data);
      } else {
        transaction.set(database.doc(path), data, options);
      }
    },
    deleteDocument(path) {
      transaction.delete(database.doc(path));
    },
  };
}

export function createFirestoreOwnerRecordRemovalPrivateDatabase(
  database: Firestore,
): OwnerRecordRemovalPrivateDatabase {
  return {
    runTransaction(operation) {
      return database.runTransaction((transaction) =>
        operation(firestoreTransactionBoundary(database, transaction)));
    },
  };
}
