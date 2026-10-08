import {createHash, randomUUID} from "node:crypto";
import {accountDeletionPath} from "./account_deletion_guard.js";
import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";
import {
  buildAdminUserClaimedRestaurantDocument,
  buildAdminUserDirectoryDocument,
  buildAdminUserSourceSummary,
  effectiveAdminUserSourceUid,
  isValidAdminUserSourceDocument,
  readAdminUserDate,
} from "./admin_user_directory_builders.js";
import {
  adminUserProgressVersion, adminUserWorkPath, adminUserRelationshipWorkPath,
  exactAdminUserUid,
  requireAdminUserUid,
  requireAdminUserProgressSize,
  adminUserClaimedRestaurantDocumentPath,
  adminUserDirectoryDocumentPath,
  adminUserSourceKinds,
  adminUserSourceSummaryDocumentPath,
  adminUserSourceSummaryVersion,
  type AdminUserDirectoryDocument,
  type AdminUserSourceData,
  type AdminUserSourceKind,
  type AdminUserSourceSummary,
  type AdminUserStoredDocument,
} from "./admin_user_directory_contract.js";

export type AdminUserDirectoryQuery = Readonly<{
  collectionPath: string;
  where?: Readonly<{
    field: string;
    value: string;
  }>;
  orderBy: readonly Readonly<{
    field: string;
    direction: "asc" | "desc";
  }>[];
  limit: number;
  startAfter?: string;
  idPrefix?: string;
}>;

export interface AdminUserDirectoryTransaction {
  getDocument(path: string): Promise<AdminUserStoredDocument | null>;
  queryDocuments(
    query: AdminUserDirectoryQuery,
  ): Promise<readonly AdminUserStoredDocument[]>;
  setDocument(path: string, data: Readonly<Record<string, unknown>>): void;
  deleteDocument(path: string): void;
}

export interface AdminUserDirectoryDatabase {
  runTransaction<T>(
    operation: (transaction: AdminUserDirectoryTransaction) => Promise<T>,
  ): Promise<T>;
}

export function setAdminUserProgress(transaction: AdminUserDirectoryTransaction, path: string,
  data: Readonly<Record<string, unknown>>): void {
  transaction.setDocument(path, requireAdminUserProgressSize(data));
}

function recordData(value: DocumentData | undefined): AdminUserSourceData | null {
  return value === undefined ? null : value as AdminUserSourceData;
}

function firestoreTransactionBoundary(
  database: Firestore,
  transaction: Transaction,
): AdminUserDirectoryTransaction {
  return {
    async getDocument(path) {
      const snapshot = await transaction.get(database.doc(path));
      const data = snapshot.exists ? recordData(snapshot.data()) : null;
      return data === null ? null : {id: snapshot.id, data};
    },
    async queryDocuments(options) {
      let query: Query<DocumentData, DocumentData> = database.collection(options.collectionPath);
      if (options.where) query = query.where(options.where.field, "==", options.where.value);
      if (options.idPrefix) query = query.where(FieldPath.documentId(), ">=", options.idPrefix)
        .where(FieldPath.documentId(), "<", options.idPrefix + "\uf8ff");
      for (const order of options.orderBy) {
        query = query.orderBy(
          order.field === "__name__" ? FieldPath.documentId() : order.field,
          order.direction,
        );
      }
      if (options.startAfter !== undefined) query = query.startAfter(options.startAfter);
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) throw new Error("Invalid People query budget.");
      const snapshot = await transaction.get(query.limit(options.limit));
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data() as AdminUserSourceData,
      }));
    },
    setDocument(path, data) {
      transaction.set(database.doc(path), data);
    },
    deleteDocument(path) {
      transaction.delete(database.doc(path));
    },
  };
}

export function createFirestoreAdminUserDirectoryDatabase(
  database: Firestore,
): AdminUserDirectoryDatabase {
  return {
    runTransaction(operation) {
      return database.runTransaction((transaction) =>
        operation(firestoreTransactionBoundary(database, transaction)), {maxAttempts: 3}
      );
    },
  };
}

type SourceConfiguration = Readonly<{
  collectionPath: string;
  uidFields: readonly string[];
  documentIdFallback: boolean;
}>;

export const adminUserSourceConfigurations: Readonly<
  Record<AdminUserSourceKind, SourceConfiguration>
> = Object.freeze({
  restaurantAccount: Object.freeze({
    collectionPath: "restaurant_accounts",
    uidFields: Object.freeze(["uid"]),
    documentIdFallback: true,
  }),
  userProfile: Object.freeze({
    collectionPath: "user_profiles",
    uidFields: Object.freeze(["userId"]),
    documentIdFallback: true,
  }),
  publicReviewerProfile: Object.freeze({
    collectionPath: "public_reviewer_profiles",
    uidFields: Object.freeze(["userId"]),
    documentIdFallback: true,
  }),
  biteScoreRestaurant: Object.freeze({
    collectionPath: "bitescore_restaurants",
    uidFields: Object.freeze(["ownerUserId"]),
    documentIdFallback: false,
  }),
  restaurantClaimRequest: Object.freeze({
    collectionPath: "restaurant_claim_requests",
    uidFields: Object.freeze(["requesterUserId"]),
    documentIdFallback: false,
  }),
  dishReview: Object.freeze({
    collectionPath: "dish_reviews",
    uidFields: Object.freeze(["userId"]),
    documentIdFallback: false,
  }),
  reviewReport: Object.freeze({
    collectionPath: "review_reports",
    uidFields: Object.freeze(["reportingUserId"]),
    documentIdFallback: false,
  }),
  restaurantReport: Object.freeze({
    collectionPath: "restaurant_reports",
    uidFields: Object.freeze(["reportingUserId"]),
    documentIdFallback: false,
  }),
  dishReport: Object.freeze({
    collectionPath: "dish_reports",
    uidFields: Object.freeze(["reportingUserId"]),
    documentIdFallback: false,
  }),
  duplicateRestaurantReport: Object.freeze({
    collectionPath: "duplicate_restaurant_reports",
    uidFields: Object.freeze(["reportingUserId"]),
    documentIdFallback: false,
  }),
  dishEditProposal: Object.freeze({
    collectionPath: "dish_edit_proposals",
    uidFields: Object.freeze(["userId", "createdByUserId"]),
    documentIdFallback: false,
  }),
  reviewFeedbackVote: Object.freeze({
    collectionPath: "review_feedback_votes",
    uidFields: Object.freeze(["userId"]),
    documentIdFallback: false,
  }),
});

function requireDocumentSegment(value: string, label: string): string {
  if (!value || value.includes("/") || value === "." || value === "..") {
    throw new Error(`${label} must be one exact Firestore document-ID segment.`);
  }
  return value;
}

function sourceActivityDate(document: AdminUserStoredDocument): Date | null {
  return readAdminUserDate(document.data.updatedAt) ??
    readAdminUserDate(document.data.createdAt) ??
    readAdminUserDate(document.data.lastContributionAt);
}

function storedSourceSummary(
  document: AdminUserStoredDocument | null,
): AdminUserSourceSummary | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  if (
    data.sourceSummaryVersion !== adminUserSourceSummaryVersion ||
    data.present !== true ||
    typeof data.uid !== "string" ||
    typeof data.sourceKind !== "string" ||
    !adminUserSourceKinds.includes(data.sourceKind as AdminUserSourceKind) ||
    typeof data.sourceFingerprint !== "string"
  ) {
    return null;
  }
  return {
    ...data,
    ...(readAdminUserDate(data.lastContributionAt) === null
      ? {}
      : {lastContributionAt: readAdminUserDate(data.lastContributionAt)!}),
    ...(readAdminUserDate(data.latestActivityAt) === null
      ? {}
      : {latestActivityAt: readAdminUserDate(data.latestActivityAt)!}),
    ...(readAdminUserDate(data.sourceCreatedAt) === null
      ? {}
      : {sourceCreatedAt: readAdminUserDate(data.sourceCreatedAt)!}),
    ...(readAdminUserDate(data.sourceUpdatedAt) === null
      ? {}
      : {sourceUpdatedAt: readAdminUserDate(data.sourceUpdatedAt)!}),
    indexedAt: readAdminUserDate(data.indexedAt) ?? new Date(0),
  } as AdminUserSourceSummary;
}

function storedFingerprint(document: AdminUserStoredDocument | null): string | null {
  const fingerprint = document?.data.sourceFingerprint;
  return typeof fingerprint === "string" ? fingerprint : null;
}

export {adminUserProgressVersion, adminUserWorkPath, adminUserRelationshipWorkPath} from "./admin_user_directory_contract.js";
export const adminUserScanPageSize = 5;
export type AdminUserSourceReconciliationResult = Readonly<{
  state: "pending" | "complete";
  uid: string;
  sourceKind: AdminUserSourceKind;
  sourcePresent?: boolean;
  summaryWritten: boolean;
  summaryDeleted: boolean;
  directoryWritten: boolean;
  directoryDeleted: boolean;
}>;
export type AdminUserWork = {
  workVersion: string;
  workType: "source" | "relationship";
  state: "pending" | "complete";
  uid: string;
  sourceKind: AdminUserSourceKind;
  restaurantId: string | null;
  generation: string;
  verificationId: string | null;
  lastEventId: string | null;
  fieldIndex: number;
  cursor: string | null;
  directDone: boolean;
  bestId: string | null;
  bestHash: string | null;
  activityId: string | null;
  activityHash: string | null;
  activityMillis: number | null;
  updatedAt: Date;
};
export function parseAdminUserWork(document: AdminUserStoredDocument | null): AdminUserWork | null {
  if (!document) return null;
  const v = requireAdminUserProgressSize(document.data);
  if (v.workVersion !== adminUserProgressVersion || !["source", "relationship"].includes(String(v.workType)) ||
      !["pending", "complete"].includes(String(v.state)) || !adminUserSourceKinds.includes(v.sourceKind as AdminUserSourceKind) ||
      (v.workType === "source" && exactAdminUserUid(v.uid) === null) ||
      typeof v.generation !== "string" || !Number.isInteger(v.fieldIndex) || (v.fieldIndex as number) < 0 ||
      (v.fieldIndex as number) > 2 || typeof v.directDone !== "boolean" ||
      !["cursor", "bestId", "bestHash", "activityId", "activityHash", "verificationId", "lastEventId"].every(k => v[k] === null || typeof v[k] === "string") ||
      !(v.activityMillis === null || (typeof v.activityMillis === "number" && Number.isFinite(v.activityMillis)))) {
    throw new Error("Invalid private People progress; recovery is incomplete.");
  }
  if (v.workType === "relationship") requireDocumentSegment(v.restaurantId as string, "Restaurant ID");
  const parsed = v as unknown as AdminUserWork;
  const expected = parsed.workType === "source" ? adminUserWorkPath(parsed.uid, parsed.sourceKind) : adminUserRelationshipWorkPath(parsed.restaurantId!);
  if (expected.slice(expected.lastIndexOf("/") + 1) !== document.id) throw new Error("People work identity mismatch.");
  return parsed;
}
function freshWork(uid: string, sourceKind: AdminUserSourceKind, now: Date,
  verificationId: string | null = null, lastEventId: string | null = null): AdminUserWork {
  return {workVersion: adminUserProgressVersion, workType: "source", state: "pending", uid, sourceKind,
    restaurantId: null, generation: randomUUID(), verificationId, lastEventId, fieldIndex: 0, cursor: null,
    directDone: false, bestId: null, bestHash: null, activityId: null, activityHash: null,
    activityMillis: null, updatedAt: now};
}
export function deleteFencedAdminUser(transaction: AdminUserDirectoryTransaction, uid: string): void {
  for (const kind of adminUserSourceKinds) {
    transaction.deleteDocument(adminUserSourceSummaryDocumentPath({uid, sourceKind: kind}));
    transaction.deleteDocument(adminUserWorkPath(uid, kind));
  }
  transaction.deleteDocument(adminUserDirectoryDocumentPath(uid));
}
/** Read registration first; caller applies all returned writes only after reads. */
export async function prepareAdminUserWork(transaction: AdminUserDirectoryTransaction,
  scope: {uid: string; sourceKind: AdminUserSourceKind} | {restaurantId: string}, now: Date,
  options: {verificationId?: string; eventId?: string; invalidate?: boolean; fencedUids?: Set<string>} = {},
): Promise<() => void> {
  const relationship = "restaurantId" in scope;
  const path = relationship ? adminUserRelationshipWorkPath(scope.restaurantId) : adminUserWorkPath(scope.uid, scope.sourceKind);
  if (!relationship && await transaction.getDocument(accountDeletionPath(scope.uid))) {
    if (options.fencedUids?.has(scope.uid)) return () => undefined;
    options.fencedUids?.add(scope.uid);
    return () => deleteFencedAdminUser(transaction, scope.uid);
  }
  const old = parseAdminUserWork(await transaction.getDocument(path));
  if (old && ((options.verificationId && old.verificationId === options.verificationId) ||
      (options.eventId && old.lastEventId === options.eventId))) return () => undefined;
  if (old?.state === "pending" && !options.invalidate && !options.verificationId) return () => undefined;
  const work = freshWork(relationship ? "" : scope.uid, relationship ? "biteScoreRestaurant" : scope.sourceKind,
    now, options.verificationId ?? old?.verificationId ?? null, options.eventId ?? null);
  if (relationship) { work.workType = "relationship"; work.restaurantId = scope.restaurantId; }
  return () => setAdminUserProgress(transaction, path, work);
}
function witnessHash(document: AdminUserStoredDocument): string {
  return createHash("sha256").update(JSON.stringify(document.data)).digest("hex");
}
function consider(work: AdminUserWork, document: AdminUserStoredDocument | null): void {
  if (!document || effectiveAdminUserSourceUid(work.sourceKind, document.id, document.data) !== work.uid ||
      !isValidAdminUserSourceDocument(work.sourceKind, document.data)) return;
  if (work.bestId === null || Buffer.compare(Buffer.from(document.id), Buffer.from(work.bestId)) > 0) {
    work.bestId = document.id; work.bestHash = witnessHash(document);
  }
  const activity = sourceActivityDate(document)?.getTime() ?? null;
  if (activity !== null && (work.activityMillis === null || activity > work.activityMillis)) {
    work.activityMillis = activity; work.activityId = document.id; work.activityHash = witnessHash(document);
  }
}
async function publishAdminUserSource(transaction: AdminUserDirectoryTransaction,
  sourceKind: AdminUserSourceKind, uid: string, now: Date,
  currentSource: {representative: AdminUserStoredDocument | null; latestActivityAt: Date | null},
): Promise<AdminUserSourceReconciliationResult> {
    const summaryDocuments = new Map<
      AdminUserSourceKind,
      AdminUserStoredDocument | null
    >();
    for (const kind of adminUserSourceKinds) {
      summaryDocuments.set(
        kind,
        await transaction.getDocument(
          adminUserSourceSummaryDocumentPath({uid, sourceKind: kind}),
        ),
      );
    }
    const directoryPath = adminUserDirectoryDocumentPath(uid);
    const existingDirectory = await transaction.getDocument(directoryPath);
    const nextSummary = buildAdminUserSourceSummary({
      uid,
      sourceKind,
      representative: currentSource.representative,
      latestActivityAt: currentSource.latestActivityAt,
      now,
    });
    const summaryPath = adminUserSourceSummaryDocumentPath({uid, sourceKind});
    const existingSummary = summaryDocuments.get(sourceKind) ?? null;
    let summaryWritten = false;
    let summaryDeleted = false;
    if (nextSummary === null) {
      if (existingSummary !== null) {
        transaction.deleteDocument(summaryPath);
        summaryDeleted = true;
      }
    } else if (storedFingerprint(existingSummary) !== nextSummary.sourceFingerprint) {
      transaction.setDocument(summaryPath, nextSummary);
      summaryWritten = true;
    }

    const summaries: AdminUserSourceSummary[] = [];
    for (const kind of adminUserSourceKinds) {
      if (kind === sourceKind) {
        if (nextSummary !== null) {
          summaries.push(nextSummary);
        }
        continue;
      }
      const summary = storedSourceSummary(summaryDocuments.get(kind) ?? null);
      if (summary !== null && summary.uid === uid && summary.sourceKind === kind) {
        summaries.push(summary);
      }
    }
    const nextDirectory = buildAdminUserDirectoryDocument({uid, summaries, now});
    let directoryWritten = false;
    let directoryDeleted = false;
    if (nextDirectory === null) {
      if (existingDirectory !== null) {
        transaction.deleteDocument(directoryPath);
        directoryDeleted = true;
      }
    } else if (
      storedFingerprint(existingDirectory) !== nextDirectory.sourceFingerprint
    ) {
      transaction.setDocument(directoryPath, nextDirectory);
      directoryWritten = true;
    }
    return {
      state: "complete" as const,
      uid,
      sourceKind,
      sourcePresent: nextSummary !== null,
      summaryWritten,
      summaryDeleted,
      directoryWritten,
      directoryDeleted,
    };
}

/** One transaction/page. Progress and final publication serialize on the work
 * document; event invalidation replaces the generation/cursor in that same doc.
 * This is an eventual pass, not a source-wide atomic snapshot. */
export async function advanceAdminUserSource(transaction: AdminUserDirectoryTransaction,
  stored: AdminUserWork, now: Date): Promise<AdminUserSourceReconciliationResult> {
  const {uid, sourceKind} = stored;
  const result = {state: "pending" as const, uid, sourceKind, summaryWritten: false,
    summaryDeleted: false, directoryWritten: false, directoryDeleted: false};
  if (await transaction.getDocument(accountDeletionPath(uid))) {
    deleteFencedAdminUser(transaction, uid);
    return {...result, state: "complete", sourcePresent: false, summaryDeleted: true, directoryDeleted: true};
  }
  if (stored.state === "complete") return {...result, state: "complete"};
  const work = {...stored, updatedAt: now};
  const configuration = adminUserSourceConfigurations[sourceKind];
  if (!work.directDone) {
    if (configuration.documentIdFallback) consider(work, await transaction.getDocument(`${configuration.collectionPath}/${uid}`));
    work.directDone = true;
  }
  if (work.fieldIndex < configuration.uidFields.length) {
    const page = await transaction.queryDocuments({collectionPath: configuration.collectionPath,
      where: {field: configuration.uidFields[work.fieldIndex], value: uid},
      orderBy: [{field: "__name__", direction: "asc"}], limit: adminUserScanPageSize,
      ...(work.cursor === null ? {} : {startAfter: work.cursor})});
    for (const document of page) consider(work, document);
    if (page.length === adminUserScanPageSize) work.cursor = page[page.length - 1].id;
    else {work.fieldIndex++; work.cursor = null;}
  }
  const path = adminUserWorkPath(uid, sourceKind);
  if (work.fieldIndex < configuration.uidFields.length) {
    setAdminUserProgress(transaction, path, work); return result;
  }
  const representative = work.bestId === null ? null :
    await transaction.getDocument(`${configuration.collectionPath}/${work.bestId}`);
  const activity = work.activityId === null ? null : work.activityId === work.bestId ? representative :
    await transaction.getDocument(`${configuration.collectionPath}/${work.activityId}`);
  if ((work.bestId !== null && (!representative || witnessHash(representative) !== work.bestHash)) ||
      (work.activityId !== null && (!activity || witnessHash(activity) !== work.activityHash))) {
    setAdminUserProgress(transaction, path, freshWork(uid, sourceKind, now, work.verificationId, work.lastEventId));
    return result;
  }
  // Re-run identity/shape validation on current source, not cached payloads.
  if (representative && (effectiveAdminUserSourceUid(sourceKind, representative.id, representative.data) !== uid ||
      !isValidAdminUserSourceDocument(sourceKind, representative.data))) {
    setAdminUserProgress(transaction, path, freshWork(uid, sourceKind, now, work.verificationId, work.lastEventId)); return result;
  }
  const published = await publishAdminUserSource(transaction, sourceKind, uid, now,
    {representative, latestActivityAt: work.activityMillis === null ? null : new Date(work.activityMillis)});
  setAdminUserProgress(transaction, path, {...work, state: "complete", cursor: null, bestId: null, bestHash: null,
    activityId: null, activityHash: null, activityMillis: null});
  return published;
}

export async function reconcileAdminUserSource(database: AdminUserDirectoryDatabase,
  sourceKind: AdminUserSourceKind, rawUid: string, now: Date,
  _sourceDocumentIdHint?: string): Promise<AdminUserSourceReconciliationResult> {
  const uid = requireAdminUserUid(rawUid);
  await database.runTransaction(async tx => { (await prepareAdminUserWork(tx, {uid, sourceKind}, now))(); });
  return database.runTransaction(async tx => {
    const work = parseAdminUserWork(await tx.getDocument(adminUserWorkPath(uid, sourceKind)));
    if (!work) { // A fence can remove progress between registration and resume.
      if (!await tx.getDocument(accountDeletionPath(uid))) throw new Error("Missing People work.");
      deleteFencedAdminUser(tx, uid);
      return {state: "complete", uid, sourceKind, sourcePresent: false, summaryWritten: false,
        summaryDeleted: true, directoryWritten: false, directoryDeleted: true};
    }
    return advanceAdminUserSource(tx, work, now);
  });
}

export async function reconcileAdminUserClaimedRestaurant(
  database: AdminUserDirectoryDatabase,
  rawSourceRestaurantId: string,
  now: Date,
): Promise<boolean> {
  const sourceRestaurantId = requireDocumentSegment(
    rawSourceRestaurantId,
    "BiteScore restaurant source ID",
  );
  return database.runTransaction(transaction => reconcileAdminUserClaimedRestaurantInTransaction(transaction, sourceRestaurantId, now));
}

export async function reconcileAdminUserClaimedRestaurantInTransaction(
  transaction: AdminUserDirectoryTransaction, sourceRestaurantId: string, now: Date,
): Promise<boolean> {
    const source = await transaction.getDocument(
      `bitescore_restaurants/${sourceRestaurantId}`,
    );
    const indexPath = adminUserClaimedRestaurantDocumentPath(sourceRestaurantId);
    const existing = await transaction.getDocument(indexPath);
    let next = buildAdminUserClaimedRestaurantDocument({
      sourceRestaurantId,
      source: source?.data ?? null,
      now,
    });
    if (next && await transaction.getDocument(accountDeletionPath(next.ownerUid))) next = null;
    if (next === null) {
      if (existing !== null) {
        transaction.deleteDocument(indexPath);
        return true;
      }
      return false;
    }
    if (storedFingerprint(existing) === next.sourceFingerprint) {
      return false;
    }
    transaction.setDocument(indexPath, next);
    return true;
}

export type AdminUserSourceWrite = Readonly<{
  sourceKind: AdminUserSourceKind;
  sourceDocumentId: string;
  before: AdminUserSourceData | null;
  after: AdminUserSourceData | null;
  now: Date;
  eventId?: string;
}>;

/** Only missing/null owners prove absence. Malformed present values still need repair. */
export function hasAdminUserRestaurantOwnerValue(source: AdminUserSourceData | null): boolean {
  return source?.ownerUserId !== undefined && source?.ownerUserId !== null;
}

export async function handleAdminUserSourceWrite(
  database: AdminUserDirectoryDatabase,
  write: AdminUserSourceWrite,
): Promise<readonly AdminUserSourceReconciliationResult[]> {
  const sourceDocumentId = requireDocumentSegment(
    write.sourceDocumentId,
    "Admin user source document ID",
  );
  const affectedUids = new Set<string>();
  for (const source of [write.before, write.after]) {
    const uid = effectiveAdminUserSourceUid(
      write.sourceKind,
      sourceDocumentId,
      source,
    );
    if (uid !== null && !uid.includes("/")) {
      affectedUids.add(uid);
    }
  }
  await database.runTransaction(async tx => {
    const writes: (() => void)[] = [];
    for (const uid of affectedUids) writes.push(await prepareAdminUserWork(tx, {uid, sourceKind: write.sourceKind}, write.now, {invalidate: true, eventId: write.eventId}));
    if (write.sourceKind === "biteScoreRestaurant" &&
        [write.before, write.after].some(hasAdminUserRestaurantOwnerValue)) {
      writes.push(await prepareAdminUserWork(tx, {restaurantId: sourceDocumentId}, write.now, {invalidate: true, eventId: write.eventId}));
    }
    writes.forEach(apply => apply());
  });
  if (write.sourceKind === "biteScoreRestaurant") {
    await database.runTransaction(async tx => {
      const work = parseAdminUserWork(await tx.getDocument(adminUserRelationshipWorkPath(sourceDocumentId)));
      await reconcileAdminUserClaimedRestaurantInTransaction(tx, sourceDocumentId, write.now);
      if (work) setAdminUserProgress(tx, adminUserRelationshipWorkPath(sourceDocumentId), {...work, state: "complete", updatedAt: write.now});
    });
  }
  const results: AdminUserSourceReconciliationResult[] = [];
  for (const uid of affectedUids) {
    results.push(
      await reconcileAdminUserSource(
        database,
        write.sourceKind,
        uid,
        write.now,
        adminUserSourceConfigurations[write.sourceKind].documentIdFallback
          ? sourceDocumentId
          : undefined,
      ),
    );
  }
  return Object.freeze(results);
}

export function adminUserDirectoryDocumentFromStored(
  document: AdminUserStoredDocument | null,
): AdminUserDirectoryDocument | null {
  if (
    document === null ||
    typeof document.data.uid !== "string" ||
    typeof document.data.sourceFingerprint !== "string"
  ) {
    return null;
  }
  return document.data as AdminUserDirectoryDocument;
}
