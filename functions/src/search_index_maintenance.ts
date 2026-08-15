import {
  FieldPath,
  FieldValue,
  type DocumentData,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";
import {
  biteSaverOfferCatalogUpdatedAtField,
  biteSaverOfferParentFingerprint,
  biteScoreDishParentFingerprint,
  buildBiteSaverCouponOfferIndex,
  buildBiteSaverDailySpecialOfferIndex,
  buildBiteSaverRestaurantIndex,
  buildBiteScoreDishIndex,
  buildBiteScoreRestaurantIndex,
  type SearchIndexDocument,
  type SearchIndexSourceData,
} from "./search_index_builders.js";
import {
  biteSaverOfferIndexCollection,
  buildSearchIndexJobDocument,
  createSearchIndexDocumentId,
  createSearchIndexJobId,
  dishSearchIndexCollection,
  maximumSearchIndexWorkerBatchSize,
  privateSearchIndexJobCollection,
  restaurantSearchIndexCollection,
  searchIndexJobVersion,
  type SearchIndexJobCursor,
  type SearchIndexJobDocument,
  type SearchIndexJobKind,
  type SearchIndexJobParentSource,
} from "./search_index_contract.js";

export type SearchIndexStoredDocument = Readonly<{
  id: string;
  data: SearchIndexSourceData;
}>;

export type SearchIndexQuery = Readonly<{
  collectionPath: string;
  where?: Readonly<{
    field: string;
    value: string;
  }>;
  afterDocumentId?: string | null;
  limit: number;
}>;

export interface SearchIndexDatabase {
  getDocument(path: string): Promise<SearchIndexSourceData | null>;
  setDocument(path: string, data: SearchIndexDocument): Promise<void>;
  deleteDocument(path: string): Promise<void>;
  createDocumentIfAbsent(
    path: string,
    data: SearchIndexJobDocument,
  ): Promise<boolean>;
  updateDocument(path: string, data: Readonly<Record<string, unknown>>): Promise<void>;
  updateExistingDocumentServerTimestamp(
    path: string,
    field: string,
  ): Promise<void>;
  queryDocuments(query: SearchIndexQuery): Promise<readonly SearchIndexStoredDocument[]>;
}

function recordData(value: DocumentData | undefined): SearchIndexSourceData | null {
  return value === undefined ? null : value as SearchIndexSourceData;
}

export function createFirestoreSearchIndexDatabase(
  database: Firestore,
): SearchIndexDatabase {
  return {
    async getDocument(path) {
      const snapshot = await database.doc(path).get();
      return snapshot.exists ? recordData(snapshot.data()) : null;
    },
    async setDocument(path, data) {
      await database.doc(path).set(data);
    },
    async deleteDocument(path) {
      await database.doc(path).delete();
    },
    async createDocumentIfAbsent(path, data) {
      return database.runTransaction(async (transaction) => {
        const reference = database.doc(path);
        const existing = await transaction.get(reference);
        if (existing.exists) {
          return false;
        }
        transaction.create(reference, data);
        return true;
      });
    },
    async updateDocument(path, data) {
      await database.doc(path).set(data, { merge: true });
    },
    async updateExistingDocumentServerTimestamp(path, field) {
      await database.doc(path).update({ [field]: FieldValue.serverTimestamp() });
    },
    async queryDocuments(options) {
      let query: Query<DocumentData, DocumentData> = database.collection(
        options.collectionPath,
      );
      if (options.where !== undefined) {
        query = query.where(
          options.where.field,
          "==",
          options.where.value,
        );
      }
      query = query.orderBy(FieldPath.documentId());
      if (options.afterDocumentId) {
        query = query.startAfter(options.afterDocumentId);
      }
      const snapshot = await query.limit(options.limit).get();
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data() as SearchIndexSourceData,
      }));
    },
  };
}

function documentPath(collection: string, documentId: string): string {
  return `${collection}/${documentId}`;
}

async function applyCurrentIndex(
  database: SearchIndexDatabase,
  collection: string,
  indexDocumentId: string,
  document: SearchIndexDocument | null,
): Promise<void> {
  const path = documentPath(collection, indexDocumentId);
  if (document === null) {
    await database.deleteDocument(path);
    return;
  }
  const existing = await database.getDocument(path);
  if (
    existing !== null &&
    existing.searchIndexVersion === document.searchIndexVersion &&
    existing.sourceFingerprint === document.sourceFingerprint
  ) {
    return;
  }
  await database.setDocument(path, document);
}

export async function reconcileBiteSaverRestaurantIndex(
  database: SearchIndexDatabase,
  restaurantAccountId: string,
  now: Date,
): Promise<SearchIndexSourceData | null> {
  const source = await database.getDocument(
    `restaurant_accounts/${restaurantAccountId}`,
  );
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteSaverRestaurant",
    sourceDocumentId: restaurantAccountId,
  });
  await applyCurrentIndex(
    database,
    restaurantSearchIndexCollection,
    indexDocumentId,
    buildBiteSaverRestaurantIndex({
      sourceDocumentId: restaurantAccountId,
      source,
      now,
    }),
  );
  return source;
}

export async function reconcileBiteScoreRestaurantIndex(
  database: SearchIndexDatabase,
  restaurantId: string,
  now: Date,
): Promise<SearchIndexSourceData | null> {
  const source = await database.getDocument(
    `bitescore_restaurants/${restaurantId}`,
  );
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteScoreRestaurant",
    sourceDocumentId: restaurantId,
  });
  await applyCurrentIndex(
    database,
    restaurantSearchIndexCollection,
    indexDocumentId,
    buildBiteScoreRestaurantIndex({
      sourceDocumentId: restaurantId,
      source,
      now,
    }),
  );
  return source;
}

export async function reconcileBiteScoreDishIndex(
  database: SearchIndexDatabase,
  dishId: string,
  now: Date,
): Promise<void> {
  const dish = await database.getDocument(`bitescore_dishes/${dishId}`);
  const restaurantId = dish === null || typeof dish.restaurantId !== "string"
    ? null
    : dish.restaurantId.trim() || null;
  const [restaurant, aggregate] = restaurantId === null
    ? [null, null]
    : await Promise.all([
        database.getDocument(`bitescore_restaurants/${restaurantId}`),
        database.getDocument(`dish_rating_aggregates/${dishId}`),
      ]);
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  await applyCurrentIndex(
    database,
    dishSearchIndexCollection,
    indexDocumentId,
    buildBiteScoreDishIndex({
      sourceDocumentId: dishId,
      dish,
      restaurantDocumentId: restaurantId,
      restaurant,
      aggregate,
      now,
    }),
  );
}

export async function reconcileBiteSaverCouponOfferIndex(
  database: SearchIndexDatabase,
  restaurantAccountId: string,
  couponId: string,
  now: Date,
): Promise<void> {
  const [offer, restaurant] = await Promise.all([
    database.getDocument(
      `restaurant_accounts/${restaurantAccountId}/coupons/${couponId}`,
    ),
    database.getDocument(`restaurant_accounts/${restaurantAccountId}`),
  ]);
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: restaurantAccountId,
    sourceDocumentId: couponId,
  });
  await applyCurrentIndex(
    database,
    biteSaverOfferIndexCollection,
    indexDocumentId,
    buildBiteSaverCouponOfferIndex({
      restaurantAccountId,
      sourceDocumentId: couponId,
      offer,
      restaurant,
      now,
    }),
  );
}

export async function reconcileBiteSaverDailySpecialOfferIndex(
  database: SearchIndexDatabase,
  restaurantAccountId: string,
  dailySpecialId: string,
  now: Date,
): Promise<void> {
  const [offer, restaurant] = await Promise.all([
    database.getDocument(
      `restaurant_accounts/${restaurantAccountId}/daily_specials/${dailySpecialId}`,
    ),
    database.getDocument(`restaurant_accounts/${restaurantAccountId}`),
  ]);
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverDailySpecial",
    parentSourceDocumentId: restaurantAccountId,
    sourceDocumentId: dailySpecialId,
  });
  await applyCurrentIndex(
    database,
    biteSaverOfferIndexCollection,
    indexDocumentId,
    buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId,
      sourceDocumentId: dailySpecialId,
      offer,
      restaurant,
      now,
    }),
  );
}

function isMissingDocumentError(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 5 || code === "not-found";
}

export async function recordBiteSaverOfferCatalogChange(
  database: SearchIndexDatabase,
  restaurantAccountId: string,
): Promise<boolean> {
  const canonicalRestaurantAccountId = restaurantAccountId.trim();
  if (
    !canonicalRestaurantAccountId ||
    canonicalRestaurantAccountId.includes("/")
  ) {
    throw new Error(
      "Restaurant account ID must be one Firestore document-ID segment.",
    );
  }
  try {
    await database.updateExistingDocumentServerTimestamp(
      `restaurant_accounts/${canonicalRestaurantAccountId}`,
      biteSaverOfferCatalogUpdatedAtField,
    );
    return true;
  } catch (error) {
    if (isMissingDocumentError(error)) {
      return false;
    }
    throw error;
  }
}

export async function handleBiteSaverCouponOfferWrite(
  database: SearchIndexDatabase,
  value: {
    restaurantAccountId: string;
    couponId: string;
    now: Date;
  },
): Promise<void> {
  await reconcileBiteSaverCouponOfferIndex(
    database,
    value.restaurantAccountId,
    value.couponId,
    value.now,
  );
  await recordBiteSaverOfferCatalogChange(
    database,
    value.restaurantAccountId,
  );
}

export async function handleBiteSaverDailySpecialOfferWrite(
  database: SearchIndexDatabase,
  value: {
    restaurantAccountId: string;
    dailySpecialId: string;
    now: Date;
  },
): Promise<void> {
  await reconcileBiteSaverDailySpecialOfferIndex(
    database,
    value.restaurantAccountId,
    value.dailySpecialId,
    value.now,
  );
  await recordBiteSaverOfferCatalogChange(
    database,
    value.restaurantAccountId,
  );
}

async function enqueueParentJob(
  database: SearchIndexDatabase,
  value: {
    jobKind: SearchIndexJobKind;
    parentSource: SearchIndexJobParentSource;
    parentSourceDocumentId: string;
    requestedSourceFingerprint: string;
    now: Date;
    continuationCursor?: SearchIndexJobCursor | null;
    expiresAt?: Date;
  },
): Promise<string> {
  const job = buildSearchIndexJobDocument(value);
  const jobId = createSearchIndexJobId({
    jobKind: job.jobKind,
    parentSource: job.parentSource,
    parentSourceDocumentId: job.parentSourceDocumentId,
    requestedSourceFingerprint: job.requestedSourceFingerprint,
    continuationCursor: job.continuationCursor,
  });
  await database.createDocumentIfAbsent(
    documentPath(privateSearchIndexJobCollection, jobId),
    job,
  );
  return jobId;
}

export async function handleBiteSaverRestaurantWrite(
  database: SearchIndexDatabase,
  value: {
    restaurantAccountId: string;
    before: SearchIndexSourceData | null;
    after: SearchIndexSourceData | null;
    now: Date;
  },
): Promise<void> {
  const current = await reconcileBiteSaverRestaurantIndex(
    database,
    value.restaurantAccountId,
    value.now,
  );
  if (
    biteSaverOfferParentFingerprint(value.before) ===
    biteSaverOfferParentFingerprint(value.after)
  ) {
    return;
  }
  await enqueueParentJob(database, {
    jobKind: "biteSaverOffers",
    parentSource: "biteSaver",
    parentSourceDocumentId: value.restaurantAccountId,
    requestedSourceFingerprint: biteSaverOfferParentFingerprint(current),
    now: value.now,
  });
}

export async function handleBiteScoreRestaurantWrite(
  database: SearchIndexDatabase,
  value: {
    restaurantId: string;
    before: SearchIndexSourceData | null;
    after: SearchIndexSourceData | null;
    now: Date;
  },
): Promise<void> {
  const current = await reconcileBiteScoreRestaurantIndex(
    database,
    value.restaurantId,
    value.now,
  );
  if (
    biteScoreDishParentFingerprint(value.before) ===
    biteScoreDishParentFingerprint(value.after)
  ) {
    return;
  }
  await enqueueParentJob(database, {
    jobKind: "biteScoreDishes",
    parentSource: "biteScore",
    parentSourceDocumentId: value.restaurantId,
    requestedSourceFingerprint: biteScoreDishParentFingerprint(current),
    now: value.now,
  });
}

type ParsedJob = Readonly<{
  jobKind: SearchIndexJobKind;
  parentSource: SearchIndexJobParentSource;
  parentSourceDocumentId: string;
  requestedSourceFingerprint: string;
  continuationCursor: SearchIndexJobCursor | null;
  status: string;
  expiresAt: Date;
}>;

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as { toDate?: () => unknown };
    if (typeof candidate.toDate === "function") {
      const converted = candidate.toDate();
      return converted instanceof Date && Number.isFinite(converted.getTime())
        ? new Date(converted.getTime())
        : null;
    }
  }
  return null;
}

function parseCursor(value: unknown): SearchIndexJobCursor | null {
  if (value === undefined) {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Search index job cursor is invalid.");
  }
  const cursor = value as Record<string, unknown>;
  const phase = cursor.phase;
  const afterDocumentId = cursor.afterDocumentId;
  if (
    (phase !== "coupons" &&
      phase !== "dailySpecials" &&
      phase !== "dishes" &&
      phase !== "derivedCleanup") ||
    (afterDocumentId !== null &&
      (typeof afterDocumentId !== "string" ||
        !afterDocumentId ||
        afterDocumentId.includes("/")))
  ) {
    throw new Error("Search index job cursor is invalid.");
  }
  return Object.freeze({ phase, afterDocumentId });
}

function parseJob(data: SearchIndexSourceData): ParsedJob {
  const jobKind = data.jobKind;
  const parentSource = data.parentSource;
  const parentSourceDocumentId = data.parentSourceDocumentId;
  const requestedSourceFingerprint = data.requestedSourceFingerprint;
  const expiresAt = dateValue(data.expiresAt);
  if (
    data.searchIndexJobVersion !== searchIndexJobVersion ||
    (jobKind !== "biteSaverOffers" && jobKind !== "biteScoreDishes") ||
    (parentSource !== "biteSaver" && parentSource !== "biteScore") ||
    (jobKind === "biteSaverOffers" && parentSource !== "biteSaver") ||
    (jobKind === "biteScoreDishes" && parentSource !== "biteScore") ||
    typeof parentSourceDocumentId !== "string" ||
    !parentSourceDocumentId ||
    parentSourceDocumentId.includes("/") ||
    typeof requestedSourceFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(requestedSourceFingerprint) ||
    typeof data.status !== "string" ||
    expiresAt === null
  ) {
    throw new Error("Search index job document is invalid.");
  }
  const continuationCursor = parseCursor(data.continuationCursor);
  if (
    continuationCursor !== null &&
    ((jobKind === "biteSaverOffers" && continuationCursor.phase === "dishes") ||
      (jobKind === "biteScoreDishes" &&
        continuationCursor.phase !== "dishes" &&
        continuationCursor.phase !== "derivedCleanup"))
  ) {
    throw new Error("Search index job cursor does not match its job kind.");
  }
  return {
    jobKind,
    parentSource,
    parentSourceDocumentId,
    requestedSourceFingerprint,
    continuationCursor,
    status: data.status,
    expiresAt,
  };
}

type WorkerResult = Readonly<{
  processedCount: number;
  continuationCursor: SearchIndexJobCursor | null;
}>;

async function processBiteScoreSources(
  database: SearchIndexDatabase,
  job: ParsedJob,
  now: Date,
): Promise<WorkerResult> {
  const cursor = job.continuationCursor?.phase === "dishes"
    ? job.continuationCursor.afterDocumentId
    : null;
  const documents = await database.queryDocuments({
    collectionPath: "bitescore_dishes",
    where: { field: "restaurantId", value: job.parentSourceDocumentId },
    afterDocumentId: cursor,
    limit: maximumSearchIndexWorkerBatchSize + 1,
  });
  const selected = documents.slice(0, maximumSearchIndexWorkerBatchSize);
  for (const document of selected) {
    await reconcileBiteScoreDishIndex(database, document.id, now);
  }
  return {
    processedCount: selected.length,
    continuationCursor: documents.length > selected.length && selected.length > 0
      ? { phase: "dishes", afterDocumentId: selected[selected.length - 1].id }
      : null,
  };
}

async function processBiteSaverSources(
  database: SearchIndexDatabase,
  job: ParsedJob,
  now: Date,
): Promise<WorkerResult> {
  const phases = ["coupons", "dailySpecials"] as const;
  const initialPhase = job.continuationCursor?.phase === "dailySpecials"
    ? 1
    : 0;
  let remaining = maximumSearchIndexWorkerBatchSize;
  let processedCount = 0;
  for (let phaseIndex = initialPhase; phaseIndex < phases.length; phaseIndex += 1) {
    const phase = phases[phaseIndex];
    if (remaining === 0) {
      const collectionName = phase === "coupons" ? "coupons" : "daily_specials";
      const nextPhaseDocuments = await database.queryDocuments({
        collectionPath:
          `restaurant_accounts/${job.parentSourceDocumentId}/${collectionName}`,
        afterDocumentId: null,
        limit: 1,
      });
      return {
        processedCount,
        continuationCursor: nextPhaseDocuments.length === 0
          ? null
          : { phase, afterDocumentId: null },
      };
    }
    const afterDocumentId = phaseIndex === initialPhase &&
      job.continuationCursor?.phase === phase
      ? job.continuationCursor.afterDocumentId
      : null;
    const collectionName = phase === "coupons" ? "coupons" : "daily_specials";
    const documents = await database.queryDocuments({
      collectionPath:
        `restaurant_accounts/${job.parentSourceDocumentId}/${collectionName}`,
      afterDocumentId,
      limit: remaining + 1,
    });
    const selected = documents.slice(0, remaining);
    for (const document of selected) {
      if (phase === "coupons") {
        await reconcileBiteSaverCouponOfferIndex(
          database,
          job.parentSourceDocumentId,
          document.id,
          now,
        );
      } else {
        await reconcileBiteSaverDailySpecialOfferIndex(
          database,
          job.parentSourceDocumentId,
          document.id,
          now,
        );
      }
    }
    processedCount += selected.length;
    remaining -= selected.length;
    if (documents.length > selected.length && selected.length > 0) {
      return {
        processedCount,
        continuationCursor: {
          phase,
          afterDocumentId: selected[selected.length - 1].id,
        },
      };
    }
  }
  return { processedCount, continuationCursor: null };
}

async function processDerivedCleanup(
  database: SearchIndexDatabase,
  job: ParsedJob,
): Promise<WorkerResult> {
  const isBiteSaver = job.jobKind === "biteSaverOffers";
  const collectionPath = isBiteSaver
    ? biteSaverOfferIndexCollection
    : dishSearchIndexCollection;
  const parentField = isBiteSaver
    ? "restaurantAccountId"
    : "restaurantSourceDocumentId";
  const parentPath = isBiteSaver
    ? `restaurant_accounts/${job.parentSourceDocumentId}`
    : `bitescore_restaurants/${job.parentSourceDocumentId}`;
  const documents = await database.queryDocuments({
    collectionPath,
    where: { field: parentField, value: job.parentSourceDocumentId },
    afterDocumentId:
      job.continuationCursor?.phase === "derivedCleanup"
        ? job.continuationCursor.afterDocumentId
        : null,
    limit: maximumSearchIndexWorkerBatchSize + 1,
  });
  const selected = documents.slice(0, maximumSearchIndexWorkerBatchSize);
  let processedCount = 0;
  for (const document of selected) {
    const currentParent = await database.getDocument(parentPath);
    if (currentParent !== null) {
      return {
        processedCount,
        continuationCursor: {
          phase: isBiteSaver ? "coupons" : "dishes",
          afterDocumentId: null,
        },
      };
    }
    await database.deleteDocument(documentPath(collectionPath, document.id));
    processedCount += 1;
  }
  const currentParentAfterCleanup = await database.getDocument(parentPath);
  if (currentParentAfterCleanup !== null) {
    return {
      processedCount,
      continuationCursor: {
        phase: isBiteSaver ? "coupons" : "dishes",
        afterDocumentId: null,
      },
    };
  }
  return {
    processedCount,
    continuationCursor: documents.length > selected.length && selected.length > 0
      ? {
          phase: "derivedCleanup",
          afterDocumentId: selected[selected.length - 1].id,
        }
      : null,
  };
}

async function runWorker(
  database: SearchIndexDatabase,
  job: ParsedJob,
  now: Date,
): Promise<WorkerResult> {
  const parentPath = job.jobKind === "biteSaverOffers"
    ? `restaurant_accounts/${job.parentSourceDocumentId}`
    : `bitescore_restaurants/${job.parentSourceDocumentId}`;
  const currentParent = await database.getDocument(parentPath);
  if (currentParent === null) {
    return processDerivedCleanup(database, job);
  }
  return job.jobKind === "biteSaverOffers"
    ? processBiteSaverSources(database, job, now)
    : processBiteScoreSources(database, job, now);
}

export async function processSearchIndexJob(
  database: SearchIndexDatabase,
  jobId: string,
  now: Date,
): Promise<WorkerResult> {
  const path = documentPath(privateSearchIndexJobCollection, jobId);
  const source = await database.getDocument(path);
  if (source === null) {
    return { processedCount: 0, continuationCursor: null };
  }
  const job = parseJob(source);
  if (job.status !== "pending") {
    return { processedCount: 0, continuationCursor: null };
  }
  if (job.expiresAt <= now) {
    await database.updateDocument(path, {
      status: "expired",
      processedCount: 0,
      completedAt: new Date(now.getTime()),
    });
    return { processedCount: 0, continuationCursor: null };
  }

  const result = await runWorker(database, job, now);
  let continuationJobId: string | null = null;
  if (result.continuationCursor !== null) {
    continuationJobId = await enqueueParentJob(database, {
      jobKind: job.jobKind,
      parentSource: job.parentSource,
      parentSourceDocumentId: job.parentSourceDocumentId,
      requestedSourceFingerprint: job.requestedSourceFingerprint,
      continuationCursor: result.continuationCursor,
      now,
      expiresAt: job.expiresAt,
    });
  }
  await database.updateDocument(path, {
    status: "completed",
    processedCount: result.processedCount,
    continuationJobId,
    completedAt: new Date(now.getTime()),
  });
  return result;
}
