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
  where: Readonly<{
    field: string;
    value: string;
  }>;
  orderBy: readonly Readonly<{
    field: string;
    direction: "asc" | "desc";
  }>[];
  limit: 1;
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
      let query: Query<DocumentData, DocumentData> = database
        .collection(options.collectionPath)
        .where(options.where.field, "==", options.where.value);
      for (const order of options.orderBy) {
        query = query.orderBy(
          order.field === "__name__" ? FieldPath.documentId() : order.field,
          order.direction,
        );
      }
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
        operation(firestoreTransactionBoundary(database, transaction))
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
  const normalized = value.trim();
  if (!normalized || normalized.includes("/")) {
    throw new Error(`${label} must be one Firestore document-ID segment.`);
  }
  return normalized;
}

function addDocuments(
  target: Map<string, AdminUserStoredDocument>,
  documents: readonly AdminUserStoredDocument[],
): void {
  for (const document of documents) {
    target.set(document.id, document);
  }
}

function sourceActivityDate(document: AdminUserStoredDocument): Date | null {
  return readAdminUserDate(document.data.updatedAt) ??
    readAdminUserDate(document.data.createdAt) ??
    readAdminUserDate(document.data.lastContributionAt);
}

async function loadCurrentSourceState(
  transaction: AdminUserDirectoryTransaction,
  sourceKind: AdminUserSourceKind,
  uid: string,
  sourceDocumentIdHint?: string,
): Promise<{
  representative: AdminUserStoredDocument | null;
  latestActivityAt: Date | null;
}> {
  const configuration = adminUserSourceConfigurations[sourceKind];
  const candidates = new Map<string, AdminUserStoredDocument>();
  const latestCandidates = new Map<string, AdminUserStoredDocument>();

  if (configuration.documentIdFallback) {
    const direct = await transaction.getDocument(
      `${configuration.collectionPath}/${sourceDocumentIdHint ?? uid}`,
    );
    if (direct !== null) {
      candidates.set(direct.id, direct);
      latestCandidates.set(direct.id, direct);
    }
  } else for (const uidField of configuration.uidFields) {
    addDocuments(
      candidates,
      await transaction.queryDocuments({
        collectionPath: configuration.collectionPath,
        where: {field: uidField, value: uid},
        orderBy: Object.freeze([{field: "__name__", direction: "desc"}]),
        limit: 1,
      }),
    );
    addDocuments(
      latestCandidates,
      await transaction.queryDocuments({
        collectionPath: configuration.collectionPath,
        where: {field: uidField, value: uid},
        orderBy: Object.freeze([
          {field: "updatedAt", direction: "desc"},
          {field: "__name__", direction: "desc"},
        ]),
        limit: 1,
      }),
    );
    addDocuments(
      latestCandidates,
      await transaction.queryDocuments({
        collectionPath: configuration.collectionPath,
        where: {field: uidField, value: uid},
        orderBy: Object.freeze([
          {field: "createdAt", direction: "desc"},
          {field: "__name__", direction: "desc"},
        ]),
        limit: 1,
      }),
    );
  }

  const validCandidates = [...new Map([
    ...candidates,
    ...latestCandidates,
  ]).values()]
    .filter((document) =>
      effectiveAdminUserSourceUid(sourceKind, document.id, document.data) === uid &&
      isValidAdminUserSourceDocument(sourceKind, document.data)
    )
    .sort((left, right) => right.id.localeCompare(left.id));
  const latestActivityAt = [...latestCandidates.values(), ...validCandidates]
    .filter((document) =>
      effectiveAdminUserSourceUid(sourceKind, document.id, document.data) === uid &&
      isValidAdminUserSourceDocument(sourceKind, document.data)
    )
    .map(sourceActivityDate)
    .filter((date): date is Date => date !== null)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

  return {
    representative: validCandidates[0] ?? null,
    latestActivityAt,
  };
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

export type AdminUserSourceReconciliationResult = Readonly<{
  uid: string;
  sourceKind: AdminUserSourceKind;
  sourcePresent: boolean;
  summaryWritten: boolean;
  summaryDeleted: boolean;
  directoryWritten: boolean;
  directoryDeleted: boolean;
}>;

export async function reconcileAdminUserSource(
  database: AdminUserDirectoryDatabase,
  sourceKind: AdminUserSourceKind,
  rawUid: string,
  now: Date,
  sourceDocumentIdHint?: string,
): Promise<AdminUserSourceReconciliationResult> {
  const uid = requireDocumentSegment(rawUid, "Admin user UID");
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Admin user directory reconciliation time is invalid.");
  }
  return database.runTransaction(async (transaction) => {
    const currentSource = await loadCurrentSourceState(
      transaction,
      sourceKind,
      uid,
      sourceDocumentIdHint,
    );
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
      uid,
      sourceKind,
      sourcePresent: nextSummary !== null,
      summaryWritten,
      summaryDeleted,
      directoryWritten,
      directoryDeleted,
    };
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
  return database.runTransaction(async (transaction) => {
    const source = await transaction.getDocument(
      `bitescore_restaurants/${sourceRestaurantId}`,
    );
    const indexPath = adminUserClaimedRestaurantDocumentPath(sourceRestaurantId);
    const existing = await transaction.getDocument(indexPath);
    const next = buildAdminUserClaimedRestaurantDocument({
      sourceRestaurantId,
      source: source?.data ?? null,
      now,
    });
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
  });
}

export type AdminUserSourceWrite = Readonly<{
  sourceKind: AdminUserSourceKind;
  sourceDocumentId: string;
  before: AdminUserSourceData | null;
  after: AdminUserSourceData | null;
  now: Date;
}>;

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
  if (write.sourceKind === "biteScoreRestaurant") {
    await reconcileAdminUserClaimedRestaurant(
      database,
      sourceDocumentId,
      write.now,
    );
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
