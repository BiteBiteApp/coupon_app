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
  customerBiteSaverMaximumIndexedOrderKeyBytes,
  privateCustomerBiteSaverCatalogGenerationCollection,
} from "./customer_bitesaver_search_contract.js";
import {
  dartUtf16FirestoreBytesOrderKey,
  decodeDartUtf16FirestoreBytesOrderKey,
} from "./customer_bitesaver_search_matcher.js";
import {
  biteSaverOfferIndexCollection,
  buildCustomerBiteSaverCatalogGenerationShardDocument,
  buildSearchIndexJobDocument,
  customerBiteSaverCatalogGenerationContributionField,
  customerBiteSaverCatalogGenerationShard,
  createSearchIndexDocumentId,
  createSearchIndexJobId,
  createSearchIndexSourceOccurrenceId,
  dishSearchIndexCollection,
  maximumSearchIndexWorkerBatchSize,
  parsePrivateSearchIndexJobCursor,
  privateSearchIndexJobCollection,
  readPrivateSearchIndexCursorDocumentId,
  restaurantSearchIndexCollection,
  searchIndexJobVersion,
  readCustomerBiteSaverCatalogGeneration,
  type CustomerBiteSaverCatalogIdentity,
  type SearchIndexJobCursor,
  type SearchIndexJobDocument,
  type SearchIndexJobKind,
  type SearchIndexJobParentSource,
} from "./search_index_contract.js";
import { readBiteScoreCatalogRestaurantId } from "./restaurant_invite_helpers.js";

export type SearchIndexStoredDocument = Readonly<{
  id: string;
  data: SearchIndexSourceData;
}>;

export type SearchIndexQuery = Readonly<{
  collectionPath: string;
  where?: Readonly<{
    field: string;
    value: string | Uint8Array;
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
  queryDocuments(query: SearchIndexQuery): Promise<readonly SearchIndexStoredDocument[]>;
  runTransaction<T>(
    operation: (transaction: SearchIndexTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface SearchIndexTransaction {
  getDocument(path: string): Promise<SearchIndexSourceData | null>;
  setDocument(path: string, data: SearchIndexDocument): void;
  deleteDocument(path: string): void;
  updateExistingDocumentServerTimestamp(path: string, field: string): void;
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
    async runTransaction(operation) {
      return database.runTransaction(async (transaction) =>
        operation({
          async getDocument(path) {
            const snapshot = await transaction.get(database.doc(path));
            return snapshot.exists ? recordData(snapshot.data()) : null;
          },
          setDocument(path, data) {
            transaction.set(database.doc(path), data);
          },
          deleteDocument(path) {
            transaction.delete(database.doc(path));
          },
          updateExistingDocumentServerTimestamp(path, field) {
            transaction.update(database.doc(path), {
              [field]: FieldValue.serverTimestamp(),
            });
          },
        }));
    },
  };
}

function documentPath(collection: string, documentId: string): string {
  return `${collection}/${documentId}`;
}

function hasExactNestedShape(left: unknown, right: unknown): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => hasExactNestedShape(entry, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return Object.is(left, right);
  }
  const leftKeys = Object.keys(left as Record<string, unknown>).sort();
  const rightKeys = Object.keys(right as Record<string, unknown>).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] &&
      hasExactNestedShape(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ));
}

async function applyCurrentIndex(
  transaction: SearchIndexTransaction,
  collection: string,
  indexDocumentId: string,
  document: SearchIndexDocument | null,
  customerCatalogMutation?: Readonly<{
    identity: CustomerBiteSaverCatalogIdentity;
    now: Date;
  }>,
): Promise<boolean> {
  const path = documentPath(collection, indexDocumentId);
  const existing = await transaction.getDocument(path);
  if (
    document !== null &&
    existing !== null &&
    existing.searchIndexVersion === document.searchIndexVersion &&
    existing.sourceFingerprint === document.sourceFingerprint &&
    hasExactNestedShape(
      existing.customerPublicProjection ?? null,
      document.customerPublicProjection ?? null,
    )
  ) {
    return false;
  }

  let generationWrite: Readonly<{
    path: string;
    document: SearchIndexDocument;
  }> | null = null;
  if (customerCatalogMutation !== undefined) {
    const existingHasContribution = existing !== null &&
      Object.prototype.hasOwnProperty.call(
        existing,
        customerBiteSaverCatalogGenerationContributionField,
      );
    const nextHasContribution = document !== null &&
      Object.prototype.hasOwnProperty.call(
        document,
        customerBiteSaverCatalogGenerationContributionField,
      );
    const existingContribution = existingHasContribution
      ? existing?.[customerBiteSaverCatalogGenerationContributionField]
      : null;
    const nextContribution = nextHasContribution
      ? document?.[customerBiteSaverCatalogGenerationContributionField]
      : null;
    if (
      (existingHasContribution || nextHasContribution) &&
      !Object.is(existingContribution, nextContribution)
    ) {
      const shard = customerBiteSaverCatalogGenerationShard({
        identity: customerCatalogMutation.identity,
      });
      const shardPath = documentPath(
        privateCustomerBiteSaverCatalogGenerationCollection,
        shard.documentId,
      );
      const shardSource = await transaction.getDocument(shardPath);
      const generation = readCustomerBiteSaverCatalogGeneration(
        shardSource,
        shard.index,
      );
      if (generation === Number.MAX_SAFE_INTEGER) {
        throw new Error("BiteSaver catalog generation counter is exhausted.");
      }
      generationWrite = Object.freeze({
        path: shardPath,
        document: buildCustomerBiteSaverCatalogGenerationShardDocument({
          shardIndex: shard.index,
          generation: generation + 1,
          updatedAt: customerCatalogMutation.now,
        }),
      });
    }
  }

  if (document === null) {
    transaction.deleteDocument(path);
  } else {
    transaction.setDocument(path, document);
  }
  if (generationWrite !== null) {
    transaction.setDocument(generationWrite.path, generationWrite.document);
  }
  return generationWrite !== null;
}

export async function reconcileBiteSaverRestaurantIndex(
  database: SearchIndexDatabase,
  restaurantAccountId: string,
  now: Date,
): Promise<SearchIndexSourceData | null> {
  if (readBiteScoreCatalogRestaurantId(restaurantAccountId) !== restaurantAccountId) {
    return null;
  }
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteSaverRestaurant",
    sourceDocumentId: restaurantAccountId,
  });
  return database.runTransaction(async (transaction) => {
    const source = await transaction.getDocument(
      `restaurant_accounts/${restaurantAccountId}`,
    );
    await applyCurrentIndex(
      transaction,
      restaurantSearchIndexCollection,
      indexDocumentId,
      buildBiteSaverRestaurantIndex({
        sourceDocumentId: restaurantAccountId,
        source,
        now,
      }),
      {
        identity: {
          entityType: "restaurant",
          restaurantAccountId,
        },
        now,
      },
    );
    return source;
  });
}

export async function reconcileBiteScoreRestaurantIndex(
  database: SearchIndexDatabase,
  restaurantId: string,
  now: Date,
): Promise<SearchIndexSourceData | null> {
  if (readBiteScoreCatalogRestaurantId(restaurantId) !== restaurantId) {
    return null;
  }
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "restaurant",
    sourceKind: "biteScoreRestaurant",
    sourceDocumentId: restaurantId,
  });
  return database.runTransaction(async (transaction) => {
    const source = await transaction.getDocument(
      `bitescore_restaurants/${restaurantId}`,
    );
    await applyCurrentIndex(
      transaction,
      restaurantSearchIndexCollection,
      indexDocumentId,
      buildBiteScoreRestaurantIndex({
        sourceDocumentId: restaurantId,
        source,
        now,
      }),
    );
    return source;
  });
}

export async function reconcileBiteScoreDishIndex(
  database: SearchIndexDatabase,
  dishId: string,
  now: Date,
): Promise<void> {
  if (readBiteScoreCatalogRestaurantId(dishId) !== dishId) {
    return;
  }
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  await database.runTransaction(async (transaction) => {
    await reconcileBiteScoreDishIndexInTransaction(
      transaction,
      dishId,
      indexDocumentId,
      now,
    );
  });
}

async function reconcileBiteScoreDishIndexInTransaction(
  transaction: SearchIndexTransaction,
  dishId: string,
  indexDocumentId: string,
  now: Date,
): Promise<void> {
  const dish = await transaction.getDocument(`bitescore_dishes/${dishId}`);
  const restaurantId = dish === null
    ? null
    : readBiteScoreCatalogRestaurantId(dish.restaurantId);
  const [restaurant, aggregate] = restaurantId === null
    ? [null, null]
    : await Promise.all([
        transaction.getDocument(`bitescore_restaurants/${restaurantId}`),
        transaction.getDocument(`dish_rating_aggregates/${dishId}`),
      ]);
  await applyCurrentIndex(
    transaction,
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
  recordCatalogChange = false,
): Promise<void> {
  if (
    readBiteScoreCatalogRestaurantId(restaurantAccountId) !==
      restaurantAccountId ||
    readBiteScoreCatalogRestaurantId(couponId) !== couponId
  ) {
    return;
  }
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverCoupon",
    parentSourceDocumentId: restaurantAccountId,
    sourceDocumentId: couponId,
  });
  await database.runTransaction(async (transaction) => {
    await reconcileBiteSaverCouponOfferIndexInTransaction(
      transaction,
      restaurantAccountId,
      couponId,
      indexDocumentId,
      now,
      recordCatalogChange,
    );
  });
}

async function reconcileBiteSaverCouponOfferIndexInTransaction(
  transaction: SearchIndexTransaction,
  restaurantAccountId: string,
  couponId: string,
  indexDocumentId: string,
  now: Date,
  recordCatalogChange = false,
): Promise<void> {
  const [offer, restaurant] = await Promise.all([
    transaction.getDocument(
      `restaurant_accounts/${restaurantAccountId}/coupons/${couponId}`,
    ),
    transaction.getDocument(`restaurant_accounts/${restaurantAccountId}`),
  ]);
  const customerCatalogChanged = await applyCurrentIndex(
    transaction,
    biteSaverOfferIndexCollection,
    indexDocumentId,
    buildBiteSaverCouponOfferIndex({
      restaurantAccountId,
      sourceDocumentId: couponId,
      offer,
      restaurant,
      now,
    }),
    {
      identity: {
        entityType: "offer",
        offerType: "coupon",
        restaurantAccountId,
        sourceDocumentId: couponId,
      },
      now,
    },
  );
  if (
    recordCatalogChange &&
    customerCatalogChanged &&
    restaurant !== null
  ) {
    transaction.updateExistingDocumentServerTimestamp(
      `restaurant_accounts/${restaurantAccountId}`,
      biteSaverOfferCatalogUpdatedAtField,
    );
  }
}

export async function reconcileBiteSaverDailySpecialOfferIndex(
  database: SearchIndexDatabase,
  restaurantAccountId: string,
  dailySpecialId: string,
  now: Date,
  recordCatalogChange = false,
): Promise<void> {
  if (
    readBiteScoreCatalogRestaurantId(restaurantAccountId) !==
      restaurantAccountId ||
    readBiteScoreCatalogRestaurantId(dailySpecialId) !== dailySpecialId
  ) {
    return;
  }
  const indexDocumentId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind: "biteSaverDailySpecial",
    parentSourceDocumentId: restaurantAccountId,
    sourceDocumentId: dailySpecialId,
  });
  await database.runTransaction(async (transaction) => {
    await reconcileBiteSaverDailySpecialOfferIndexInTransaction(
      transaction,
      restaurantAccountId,
      dailySpecialId,
      indexDocumentId,
      now,
      recordCatalogChange,
    );
  });
}

async function reconcileBiteSaverDailySpecialOfferIndexInTransaction(
  transaction: SearchIndexTransaction,
  restaurantAccountId: string,
  dailySpecialId: string,
  indexDocumentId: string,
  now: Date,
  recordCatalogChange = false,
): Promise<void> {
  const [offer, restaurant] = await Promise.all([
    transaction.getDocument(
      `restaurant_accounts/${restaurantAccountId}/daily_specials/${dailySpecialId}`,
    ),
    transaction.getDocument(`restaurant_accounts/${restaurantAccountId}`),
  ]);
  const customerCatalogChanged = await applyCurrentIndex(
    transaction,
    biteSaverOfferIndexCollection,
    indexDocumentId,
    buildBiteSaverDailySpecialOfferIndex({
      restaurantAccountId,
      sourceDocumentId: dailySpecialId,
      offer,
      restaurant,
      now,
    }),
    {
      identity: {
        entityType: "offer",
        offerType: "dailySpecial",
        restaurantAccountId,
        sourceDocumentId: dailySpecialId,
      },
      now,
    },
  );
  if (
    recordCatalogChange &&
    customerCatalogChanged &&
    restaurant !== null
  ) {
    transaction.updateExistingDocumentServerTimestamp(
      `restaurant_accounts/${restaurantAccountId}`,
      biteSaverOfferCatalogUpdatedAtField,
    );
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
  if (
    readBiteScoreCatalogRestaurantId(value.restaurantAccountId) !==
      value.restaurantAccountId ||
    readBiteScoreCatalogRestaurantId(value.couponId) !== value.couponId
  ) {
    return;
  }
  await reconcileBiteSaverCouponOfferIndex(
    database,
    value.restaurantAccountId,
    value.couponId,
    value.now,
    true,
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
  if (
    readBiteScoreCatalogRestaurantId(value.restaurantAccountId) !==
      value.restaurantAccountId ||
    readBiteScoreCatalogRestaurantId(value.dailySpecialId) !== value.dailySpecialId
  ) {
    return;
  }
  await reconcileBiteSaverDailySpecialOfferIndex(
    database,
    value.restaurantAccountId,
    value.dailySpecialId,
    value.now,
    true,
  );
}

async function enqueueParentJob(
  database: SearchIndexDatabase,
  value: {
    jobKind: SearchIndexJobKind;
    parentSource: SearchIndexJobParentSource;
    parentSourceDocumentId: string;
    requestedSourceFingerprint: string;
    sourceOccurrenceId: string;
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
    sourceOccurrenceId: job.sourceOccurrenceId,
    continuationCursor: job.continuationCursor,
  });
  await database.createDocumentIfAbsent(
    documentPath(privateSearchIndexJobCollection, jobId),
    job,
  );
  return jobId;
}

type ParentWriteEventPrerequisites = Readonly<{
  beforeFingerprint: string;
  afterFingerprint: string;
  sourceOccurrenceId: string;
}>;

function isSearchIndexSourceRecord(
  value: unknown,
): value is SearchIndexSourceData {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readParentWriteEventPrerequisites(
  value: {
    before: unknown;
    after: unknown;
    sourceEventId: unknown;
  },
  fingerprint: (source: SearchIndexSourceData | null) => string,
): ParentWriteEventPrerequisites | null {
  try {
    const before = value.before;
    const after = value.after;
    const beforeIsUsable = before === null || isSearchIndexSourceRecord(before);
    const afterIsUsable = after === null || isSearchIndexSourceRecord(after);
    if (
      !beforeIsUsable ||
      !afterIsUsable ||
      (before === null && after === null)
    ) {
      return null;
    }
    const sourceOccurrenceId = createSearchIndexSourceOccurrenceId(
      value.sourceEventId,
    );
    return Object.freeze({
      beforeFingerprint: fingerprint(
        before as SearchIndexSourceData | null,
      ),
      afterFingerprint: fingerprint(
        after as SearchIndexSourceData | null,
      ),
      sourceOccurrenceId,
    });
  } catch {
    return null;
  }
}

export async function handleBiteSaverRestaurantWrite(
  database: SearchIndexDatabase,
  value: {
    restaurantAccountId: unknown;
    before: unknown;
    after: unknown;
    sourceEventId: unknown;
    now: Date;
  },
): Promise<void> {
  const restaurantAccountId = readBiteScoreCatalogRestaurantId(
    value.restaurantAccountId,
  );
  if (restaurantAccountId === null) {
    return;
  }
  const event = readParentWriteEventPrerequisites(
    value,
    biteSaverOfferParentFingerprint,
  );
  if (event === null) {
    return;
  }
  await reconcileBiteSaverRestaurantIndex(
    database,
    restaurantAccountId,
    value.now,
  );
  if (event.beforeFingerprint === event.afterFingerprint) {
    return;
  }
  await enqueueParentJob(database, {
    jobKind: "biteSaverOffers",
    parentSource: "biteSaver",
    parentSourceDocumentId: restaurantAccountId,
    requestedSourceFingerprint: event.afterFingerprint,
    sourceOccurrenceId: event.sourceOccurrenceId,
    now: value.now,
  });
}

export async function handleBiteScoreRestaurantWrite(
  database: SearchIndexDatabase,
  value: {
    restaurantId: unknown;
    before: unknown;
    after: unknown;
    sourceEventId: unknown;
    now: Date;
  },
): Promise<void> {
  const restaurantId = readBiteScoreCatalogRestaurantId(value.restaurantId);
  if (restaurantId === null) {
    return;
  }
  const event = readParentWriteEventPrerequisites(
    value,
    (source) => biteScoreDishParentFingerprint(source, restaurantId),
  );
  if (event === null) {
    return;
  }
  await reconcileBiteScoreRestaurantIndex(
    database,
    restaurantId,
    value.now,
  );
  if (event.beforeFingerprint === event.afterFingerprint) {
    return;
  }
  await enqueueParentJob(database, {
    jobKind: "biteScoreDishes",
    parentSource: "biteScore",
    parentSourceDocumentId: restaurantId,
    requestedSourceFingerprint: event.afterFingerprint,
    sourceOccurrenceId: event.sourceOccurrenceId,
    now: value.now,
  });
}

type ParsedJob = Readonly<{
  jobKind: SearchIndexJobKind;
  parentSource: SearchIndexJobParentSource;
  parentSourceDocumentId: string;
  requestedSourceFingerprint: string;
  sourceOccurrenceId: string;
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
      try {
        const converted = candidate.toDate();
        return converted instanceof Date && Number.isFinite(converted.getTime())
          ? new Date(converted.getTime())
          : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseCursor(value: unknown): SearchIndexJobCursor | null {
  return parsePrivateSearchIndexJobCursor(value);
}

function parseJob(data: SearchIndexSourceData): ParsedJob {
  const jobKind = data.jobKind;
  const parentSource = data.parentSource;
  const parentSourceDocumentId = data.parentSourceDocumentId;
  const requestedSourceFingerprint = data.requestedSourceFingerprint;
  const sourceOccurrenceId = data.sourceOccurrenceId;
  const expiresAt = dateValue(data.expiresAt);
  if (
    data.searchIndexJobVersion !== searchIndexJobVersion ||
    (jobKind !== "biteSaverOffers" && jobKind !== "biteScoreDishes") ||
    (parentSource !== "biteSaver" && parentSource !== "biteScore") ||
    (jobKind === "biteSaverOffers" && parentSource !== "biteSaver") ||
    (jobKind === "biteScoreDishes" && parentSource !== "biteScore") ||
    typeof parentSourceDocumentId !== "string" ||
    readBiteScoreCatalogRestaurantId(parentSourceDocumentId) !==
      parentSourceDocumentId ||
    typeof requestedSourceFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(requestedSourceFingerprint) ||
    typeof sourceOccurrenceId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(sourceOccurrenceId) ||
    (data.status !== "pending" &&
      data.status !== "completed" &&
      data.status !== "expired" &&
      data.status !== "invalid") ||
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
    sourceOccurrenceId,
    continuationCursor,
    status: data.status,
    expiresAt,
  };
}

type WorkerResult = Readonly<{
  processedCount: number;
  continuationCursor: SearchIndexJobCursor | null;
}>;

class InvalidSearchIndexQueryDocumentIdError extends Error {
  constructor() {
    super("Search index query returned an invalid document ID.");
    this.name = "InvalidSearchIndexQueryDocumentIdError";
  }
}

function requireValidSearchIndexQueryDocumentIds(
  documents: readonly SearchIndexStoredDocument[],
): void {
  if (documents.some((document) =>
    readPrivateSearchIndexCursorDocumentId(document.id) !== document.id)) {
    throw new InvalidSearchIndexQueryDocumentIdError();
  }
}

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
  requireValidSearchIndexQueryDocumentIds(documents);
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
  let continuationCursor: SearchIndexJobCursor | null = null;
  const batches: {
    phase: typeof phases[number];
    documents: readonly SearchIndexStoredDocument[];
  }[] = [];
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
      requireValidSearchIndexQueryDocumentIds(nextPhaseDocuments);
      continuationCursor = nextPhaseDocuments.length === 0
        ? null
        : { phase, afterDocumentId: null };
      break;
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
    requireValidSearchIndexQueryDocumentIds(documents);
    const selected = documents.slice(0, remaining);
    batches.push({ phase, documents: selected });
    processedCount += selected.length;
    remaining -= selected.length;
    if (documents.length > selected.length && selected.length > 0) {
      continuationCursor = {
        phase,
        afterDocumentId: selected[selected.length - 1].id,
      };
      break;
    }
  }
  for (const batch of batches) {
    for (const document of batch.documents) {
      if (batch.phase === "coupons") {
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
  }
  return { processedCount, continuationCursor };
}

async function reconcileSelectedBiteScoreCleanupCandidate(
  transaction: SearchIndexTransaction,
  job: ParsedJob,
  indexDocumentId: string,
  currentIndex: SearchIndexSourceData,
  now: Date,
): Promise<void> {
  const dishId = readBiteScoreCatalogRestaurantId(
    currentIndex.sourceDocumentId,
  );
  if (dishId === null) {
    if (
      currentIndex.restaurantSourceDocumentId ===
        job.parentSourceDocumentId
    ) {
      transaction.deleteDocument(
        documentPath(dishSearchIndexCollection, indexDocumentId),
      );
    }
    return;
  }
  const expectedIndexDocumentId = createSearchIndexDocumentId({
    entityKind: "dish",
    sourceKind: "biteScoreDish",
    sourceDocumentId: dishId,
  });
  if (expectedIndexDocumentId !== indexDocumentId) {
    if (
      currentIndex.restaurantSourceDocumentId ===
        job.parentSourceDocumentId
    ) {
      transaction.deleteDocument(
        documentPath(dishSearchIndexCollection, indexDocumentId),
      );
    }
    return;
  }
  await reconcileBiteScoreDishIndexInTransaction(
    transaction,
    dishId,
    expectedIndexDocumentId,
    now,
  );
}

async function reconcileSelectedBiteSaverCleanupCandidate(
  transaction: SearchIndexTransaction,
  job: ParsedJob,
  indexDocumentId: string,
  currentIndex: SearchIndexSourceData,
  now: Date,
): Promise<void> {
  if (
    decodeDartUtf16FirestoreBytesOrderKey(
      currentIndex.restaurantAccountId,
      customerBiteSaverMaximumIndexedOrderKeyBytes,
    ) !== job.parentSourceDocumentId
  ) {
    return;
  }
  const offerId = readBiteScoreCatalogRestaurantId(
    currentIndex.sourceDocumentId,
  );
  const sourceKind = currentIndex.sourceKind;
  if (
    offerId === null ||
    (sourceKind !== "biteSaverCoupon" &&
      sourceKind !== "biteSaverDailySpecial")
  ) {
    transaction.deleteDocument(
      documentPath(biteSaverOfferIndexCollection, indexDocumentId),
    );
    return;
  }
  const expectedIndexDocumentId = createSearchIndexDocumentId({
    entityKind: "offer",
    sourceKind,
    parentSourceDocumentId: job.parentSourceDocumentId,
    sourceDocumentId: offerId,
  });
  if (expectedIndexDocumentId !== indexDocumentId) {
    transaction.deleteDocument(
      documentPath(biteSaverOfferIndexCollection, indexDocumentId),
    );
    return;
  }
  if (sourceKind === "biteSaverCoupon") {
    await reconcileBiteSaverCouponOfferIndexInTransaction(
      transaction,
      job.parentSourceDocumentId,
      offerId,
      expectedIndexDocumentId,
      now,
    );
    return;
  }
  await reconcileBiteSaverDailySpecialOfferIndexInTransaction(
    transaction,
    job.parentSourceDocumentId,
    offerId,
    expectedIndexDocumentId,
    now,
  );
}

async function processDerivedCleanup(
  database: SearchIndexDatabase,
  job: ParsedJob,
  now: Date,
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
  const parentQueryValue = isBiteSaver
    ? dartUtf16FirestoreBytesOrderKey(job.parentSourceDocumentId)
    : job.parentSourceDocumentId;
  const documents = await database.queryDocuments({
    collectionPath,
    where: {field: parentField, value: parentQueryValue},
    afterDocumentId:
      job.continuationCursor?.phase === "derivedCleanup"
        ? job.continuationCursor.afterDocumentId
        : null,
    limit: maximumSearchIndexWorkerBatchSize + 1,
  });
  requireValidSearchIndexQueryDocumentIds(documents);
  const selected = documents.slice(0, maximumSearchIndexWorkerBatchSize);
  let processedCount = 0;
  for (const document of selected) {
    await database.runTransaction(async (transaction) => {
      const indexPath = documentPath(collectionPath, document.id);
      const currentIndex = await transaction.getDocument(indexPath);
      // The outer query is only a bounded source of candidate identity. If a
      // direct trigger deletes that index before this transaction reads it,
      // the verified query snapshot still identifies the authoritative child
      // that must be reconciled. Otherwise an active reparent can be left
      // without its current projection.
      const candidateIndex = currentIndex ?? document.data;
      if (isBiteSaver) {
        await reconcileSelectedBiteSaverCleanupCandidate(
          transaction,
          job,
          document.id,
          candidateIndex,
          now,
        );
        return;
      }
      await reconcileSelectedBiteScoreCleanupCandidate(
        transaction,
        job,
        document.id,
        candidateIndex,
        now,
      );
    });
    processedCount += 1;
  }
  if (documents.length > selected.length && selected.length > 0) {
    return {
      processedCount,
      continuationCursor: {
        phase: "derivedCleanup",
        afterDocumentId: selected[selected.length - 1].id,
      },
    };
  }
  const currentParentAfterCleanup = await database.getDocument(parentPath);
  return {
    processedCount,
    continuationCursor: currentParentAfterCleanup === null
      ? null
      : {
          phase: isBiteSaver ? "coupons" : "dishes",
          afterDocumentId: null,
        },
  };
}

async function runWorker(
  database: SearchIndexDatabase,
  job: ParsedJob,
  now: Date,
): Promise<WorkerResult> {
  if (job.continuationCursor?.phase === "derivedCleanup") {
    return processDerivedCleanup(database, job, now);
  }
  const requestedMissingParentFingerprint = job.jobKind === "biteSaverOffers"
    ? biteSaverOfferParentFingerprint(null)
    : biteScoreDishParentFingerprint(null, job.parentSourceDocumentId);
  if (
    job.continuationCursor === null &&
    job.requestedSourceFingerprint === requestedMissingParentFingerprint
  ) {
    // A root deletion job can be delivered after the parent has already been
    // recreated. It still must consume the old-parent candidate set before a
    // child-source continuation scans the recreated parent.
    return processDerivedCleanup(database, job, now);
  }
  const parentPath = job.jobKind === "biteSaverOffers"
    ? `restaurant_accounts/${job.parentSourceDocumentId}`
    : `bitescore_restaurants/${job.parentSourceDocumentId}`;
  const currentParent = await database.getDocument(parentPath);
  if (currentParent === null) {
    return processDerivedCleanup(database, job, now);
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
  if (
    source.status === "completed" ||
    source.status === "expired" ||
    source.status === "invalid"
  ) {
    return { processedCount: 0, continuationCursor: null };
  }
  let job: ParsedJob;
  let expectedJobId: string;
  try {
    job = parseJob(source);
    expectedJobId = createSearchIndexJobId({
      jobKind: job.jobKind,
      parentSource: job.parentSource,
      parentSourceDocumentId: job.parentSourceDocumentId,
      requestedSourceFingerprint: job.requestedSourceFingerprint,
      sourceOccurrenceId: job.sourceOccurrenceId,
      continuationCursor: job.continuationCursor,
    });
  } catch {
    await database.updateDocument(path, {
      status: "invalid",
      processedCount: 0,
      completedAt: new Date(now.getTime()),
    });
    return { processedCount: 0, continuationCursor: null };
  }
  if (expectedJobId !== jobId) {
    await database.updateDocument(path, {
      status: "invalid",
      processedCount: 0,
      completedAt: new Date(now.getTime()),
    });
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

  let result: WorkerResult;
  try {
    result = await runWorker(database, job, now);
  } catch (error) {
    if (!(error instanceof InvalidSearchIndexQueryDocumentIdError)) {
      throw error;
    }
    await database.updateDocument(path, {
      status: "invalid",
      processedCount: 0,
      completedAt: new Date(now.getTime()),
    });
    return { processedCount: 0, continuationCursor: null };
  }
  let continuationJobId: string | null = null;
  if (result.continuationCursor !== null) {
    continuationJobId = await enqueueParentJob(database, {
      jobKind: job.jobKind,
      parentSource: job.parentSource,
      parentSourceDocumentId: job.parentSourceDocumentId,
      requestedSourceFingerprint: job.requestedSourceFingerprint,
      sourceOccurrenceId: job.sourceOccurrenceId,
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
