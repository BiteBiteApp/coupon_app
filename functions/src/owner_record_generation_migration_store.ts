import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";

import {
  ownerRecordGenerationMigrationAccountChildCollections,
  type OwnerRecordGenerationMigrationAccountChildCollection,
  type OwnerRecordGenerationMigrationFirestoreUpdateTime,
} from "./owner_record_generation_migration_contract.js";
import {requireOwnerRecordUid} from "./owner_record_state_contract.js";

export const ownerRecordGenerationMigrationFirestorePageLimit = 100 as const;
export const ownerRecordGenerationMigrationFirestoreCursorVersion =
  "bitestar.owner-record-generation-migration-firestore-cursor.v1" as const;

export const ownerRecordGenerationMigrationChildCollections =
  ownerRecordGenerationMigrationAccountChildCollections;

export type OwnerRecordGenerationMigrationChildCollection =
  OwnerRecordGenerationMigrationAccountChildCollection;

export type OwnerRecordGenerationMigrationFirestorePageScope =
  | `child:${OwnerRecordGenerationMigrationChildCollection}`
  | "claimed_rating_restaurants"
  | "removal_jobs";

export type OwnerRecordGenerationMigrationFirestoreTimestamp =
  OwnerRecordGenerationMigrationFirestoreUpdateTime;

export type OwnerRecordGenerationMigrationFirestoreDocument = Readonly<{
  id: string;
  path: string;
  data: Readonly<Record<string, unknown>>;
  updateTime: OwnerRecordGenerationMigrationFirestoreTimestamp;
  readTime: OwnerRecordGenerationMigrationFirestoreTimestamp;
}>;

export type OwnerRecordGenerationMigrationFirestoreCursor = Readonly<{
  version: typeof ownerRecordGenerationMigrationFirestoreCursorVersion;
  scope: OwnerRecordGenerationMigrationFirestorePageScope;
  targetUid: string;
  afterDocumentId: string;
}>;

export type OwnerRecordGenerationMigrationFirestorePage = Readonly<{
  documents: readonly OwnerRecordGenerationMigrationFirestoreDocument[];
  nextCursor: OwnerRecordGenerationMigrationFirestoreCursor | null;
  readTime: OwnerRecordGenerationMigrationFirestoreTimestamp;
}>;

export type OwnerRecordGenerationMigrationFirestorePageRequest = Readonly<{
  targetUid: string;
  pageSize: number;
  cursor?: OwnerRecordGenerationMigrationFirestoreCursor | null;
}>;

export type OwnerRecordGenerationMigrationChildPageRequest = Readonly<{
  targetUid: string;
  collection: OwnerRecordGenerationMigrationChildCollection;
  pageSize: number;
  cursor?: OwnerRecordGenerationMigrationFirestoreCursor | null;
}>;

/**
 * The only Firestore reads available to the migration planner. Paths and
 * query predicates are derived internally; callers cannot supply either.
 */
export interface OwnerRecordGenerationMigrationFirestoreReader {
  getCanonicalAccountRoot(
    targetUid: string,
  ): Promise<OwnerRecordGenerationMigrationFirestoreDocument | null>;
  getOwnerState(
    targetUid: string,
  ): Promise<OwnerRecordGenerationMigrationFirestoreDocument | null>;
  getBillingState(
    targetUid: string,
  ): Promise<OwnerRecordGenerationMigrationFirestoreDocument | null>;
  getSubscriptionReturnState(
    targetUid: string,
  ): Promise<OwnerRecordGenerationMigrationFirestoreDocument | null>;
  listChildDocuments(
    request: OwnerRecordGenerationMigrationChildPageRequest,
  ): Promise<OwnerRecordGenerationMigrationFirestorePage>;
  listClaimedRatingRestaurants(
    request: OwnerRecordGenerationMigrationFirestorePageRequest,
  ): Promise<OwnerRecordGenerationMigrationFirestorePage>;
  listRemovalJobs(
    request: OwnerRecordGenerationMigrationFirestorePageRequest,
  ): Promise<OwnerRecordGenerationMigrationFirestorePage>;
}

/** A snapshot-scoped adapter with no write-capable method. */
export interface OwnerRecordGenerationMigrationFirestoreStore {
  runReadOnlyInventory<T>(
    operation: (
      reader: OwnerRecordGenerationMigrationFirestoreReader,
    ) => Promise<T>,
  ): Promise<T>;
}

export type OwnerRecordGenerationMigrationFirestoreFixture = Readonly<{
  path: string;
  data: Readonly<Record<string, unknown>>;
  updateTime: OwnerRecordGenerationMigrationFirestoreTimestamp;
}>;

export type OwnerRecordGenerationMigrationInventoryErrorCode =
  | "invalid_request"
  | "invalid_cursor"
  | "invalid_provider_response";

export class OwnerRecordGenerationMigrationInventoryError extends Error {
  public readonly code: OwnerRecordGenerationMigrationInventoryErrorCode;

  public constructor(code: OwnerRecordGenerationMigrationInventoryErrorCode) {
    super("Owner-record generation inventory is invalid.");
    this.name = "OwnerRecordGenerationMigrationInventoryError";
    this.code = code;
  }
}

const accountCollection = "restaurant_accounts" as const;
const ownerStateCollection = "private_owner_record_states" as const;
const billingStateCollection = "private_owner_billing_states" as const;
const subscriptionReturnStateCollection =
  "private_subscription_return_state" as const;
const removalJobCollection = "private_owner_record_removal_jobs" as const;
const ratingRestaurantCollection = "bitescore_restaurants" as const;

type TimestampLike = Readonly<{seconds: unknown; nanoseconds: unknown}>;

type SnapshotLike = Readonly<{
  id: unknown;
  exists: boolean;
  ref: Readonly<{path: unknown}>;
  updateTime?: TimestampLike;
  readTime: TimestampLike;
  data(): DocumentData | undefined;
}>;

function fail(
  code: OwnerRecordGenerationMigrationInventoryErrorCode,
): never {
  throw new OwnerRecordGenerationMigrationInventoryError(code);
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

function documentId(
  value: unknown,
  code: OwnerRecordGenerationMigrationInventoryErrorCode,
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

function pageSize(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > ownerRecordGenerationMigrationFirestorePageLimit
  ) {
    return fail("invalid_request");
  }
  return value;
}

function childCollection(
  value: unknown,
): OwnerRecordGenerationMigrationChildCollection {
  if (
    typeof value !== "string" ||
    !ownerRecordGenerationMigrationChildCollections.some(
      (candidate) => candidate === value,
    )
  ) {
    return fail("invalid_request");
  }
  return value as OwnerRecordGenerationMigrationChildCollection;
}

function timestamp(
  value: unknown,
): OwnerRecordGenerationMigrationFirestoreTimestamp {
  if (
    typeof value !== "object" ||
    value === null ||
    !("seconds" in value) ||
    !("nanoseconds" in value)
  ) {
    return fail("invalid_provider_response");
  }
  const candidate = value as TimestampLike;
  const seconds = typeof candidate.seconds === "number" &&
      Number.isSafeInteger(candidate.seconds) &&
      candidate.seconds >= 0
    ? String(candidate.seconds)
    : candidate.seconds;
  if (
    typeof seconds !== "string" ||
    !/^(?:0|[1-9][0-9]{0,11})$/u.test(seconds) ||
    typeof candidate.nanoseconds !== "number" ||
    !Number.isSafeInteger(candidate.nanoseconds) ||
    candidate.nanoseconds < 0 ||
    candidate.nanoseconds > 999_999_999
  ) {
    return fail("invalid_provider_response");
  }
  return Object.freeze({
    seconds,
    nanoseconds: candidate.nanoseconds,
  });
}

function compareDocumentIds(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function scopeForChild(
  collection: OwnerRecordGenerationMigrationChildCollection,
): OwnerRecordGenerationMigrationFirestorePageScope {
  return `child:${collection}`;
}

function cursorForRequest(
  value: unknown,
  expectedTargetUid: string,
  expectedScope: OwnerRecordGenerationMigrationFirestorePageScope,
): OwnerRecordGenerationMigrationFirestoreCursor | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, [
      "afterDocumentId",
      "scope",
      "targetUid",
      "version",
    ]) ||
    value.version !== ownerRecordGenerationMigrationFirestoreCursorVersion ||
    value.scope !== expectedScope ||
    value.targetUid !== expectedTargetUid
  ) {
    return fail("invalid_cursor");
  }
  return Object.freeze({
    version: ownerRecordGenerationMigrationFirestoreCursorVersion,
    scope: expectedScope,
    targetUid: expectedTargetUid,
    afterDocumentId: documentId(value.afterDocumentId, "invalid_cursor"),
  });
}

function exactPageRequest(
  value: unknown,
  scope: OwnerRecordGenerationMigrationFirestorePageScope,
): Readonly<{
  targetUid: string;
  pageSize: number;
  cursor: OwnerRecordGenerationMigrationFirestoreCursor | null;
}> {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ["pageSize", "targetUid"], ["cursor"])
  ) {
    return fail("invalid_request");
  }
  const exactTargetUid = targetUid(value.targetUid);
  return Object.freeze({
    targetUid: exactTargetUid,
    pageSize: pageSize(value.pageSize),
    cursor: cursorForRequest(value.cursor, exactTargetUid, scope),
  });
}

function exactChildPageRequest(
  value: unknown,
): Readonly<{
  targetUid: string;
  collection: OwnerRecordGenerationMigrationChildCollection;
  scope: OwnerRecordGenerationMigrationFirestorePageScope;
  pageSize: number;
  cursor: OwnerRecordGenerationMigrationFirestoreCursor | null;
}> {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(
      value,
      ["collection", "pageSize", "targetUid"],
      ["cursor"],
    )
  ) {
    return fail("invalid_request");
  }
  const exactTargetUid = targetUid(value.targetUid);
  const exactCollection = childCollection(value.collection);
  const scope = scopeForChild(exactCollection);
  return Object.freeze({
    targetUid: exactTargetUid,
    collection: exactCollection,
    scope,
    pageSize: pageSize(value.pageSize),
    cursor: cursorForRequest(value.cursor, exactTargetUid, scope),
  });
}

function directPath(collection: string, uid: unknown): string {
  return `${collection}/${targetUid(uid)}`;
}

function childPath(
  uid: string,
  collection: OwnerRecordGenerationMigrationChildCollection,
): string {
  return `${accountCollection}/${uid}/${collection}`;
}

function storedDocument(
  snapshot: SnapshotLike,
  expectedPath: string,
  pageReadTime?: OwnerRecordGenerationMigrationFirestoreTimestamp,
): OwnerRecordGenerationMigrationFirestoreDocument | null {
  const id = documentId(snapshot.id, "invalid_provider_response");
  const expectedSegments = expectedPath.split("/");
  const expectedId = expectedSegments[expectedSegments.length - 1];
  if (
    snapshot.ref.path !== expectedPath ||
    id !== expectedId
  ) {
    return fail("invalid_provider_response");
  }
  const exactReadTime = pageReadTime ?? timestamp(snapshot.readTime);
  if (!snapshot.exists) {
    if (snapshot.updateTime !== undefined || snapshot.data() !== undefined) {
      return fail("invalid_provider_response");
    }
    return null;
  }
  if (snapshot.updateTime === undefined) {
    return fail("invalid_provider_response");
  }
  const data = snapshot.data();
  if (!isPlainRecord(data)) {
    return fail("invalid_provider_response");
  }
  return Object.freeze({
    id,
    path: expectedPath,
    data: Object.freeze({...data}) as Readonly<Record<string, unknown>>,
    updateTime: timestamp(snapshot.updateTime),
    readTime: exactReadTime,
  });
}

function nextCursor(
  scope: OwnerRecordGenerationMigrationFirestorePageScope,
  uid: string,
  documents: readonly OwnerRecordGenerationMigrationFirestoreDocument[],
  requestedPageSize: number,
): OwnerRecordGenerationMigrationFirestoreCursor | null {
  const last = documents.length === 0
    ? undefined
    : documents[documents.length - 1];
  if (documents.length !== requestedPageSize || last === undefined) {
    return null;
  }
  return Object.freeze({
    version: ownerRecordGenerationMigrationFirestoreCursorVersion,
    scope,
    targetUid: uid,
    afterDocumentId: last.id,
  });
}

function validatedPage(params: {
  snapshots: readonly SnapshotLike[];
  readTime: unknown;
  expectedCollectionPath: string;
  targetUid: string;
  scope: OwnerRecordGenerationMigrationFirestorePageScope;
  pageSize: number;
  cursor: OwnerRecordGenerationMigrationFirestoreCursor | null;
}): OwnerRecordGenerationMigrationFirestorePage {
  if (params.snapshots.length > params.pageSize) {
    return fail("invalid_provider_response");
  }
  const exactReadTime = timestamp(params.readTime);
  const documents: OwnerRecordGenerationMigrationFirestoreDocument[] = [];
  let previousId = params.cursor?.afterDocumentId ?? null;
  for (const snapshot of params.snapshots) {
    const id = documentId(snapshot.id, "invalid_provider_response");
    if (previousId !== null && compareDocumentIds(id, previousId) <= 0) {
      return fail("invalid_provider_response");
    }
    const expectedPath = `${params.expectedCollectionPath}/${id}`;
    const document = storedDocument(snapshot, expectedPath, exactReadTime);
    if (document === null) {
      return fail("invalid_provider_response");
    }
    documents.push(document);
    previousId = id;
  }
  const frozenDocuments = Object.freeze(documents);
  return Object.freeze({
    documents: frozenDocuments,
    nextCursor: nextCursor(
      params.scope,
      params.targetUid,
      frozenDocuments,
      params.pageSize,
    ),
    readTime: exactReadTime,
  });
}

function queryWithCursor(
  query: Query<DocumentData, DocumentData>,
  cursor: OwnerRecordGenerationMigrationFirestoreCursor | null,
): Query<DocumentData, DocumentData> {
  return cursor === null ? query : query.startAfter(cursor.afterDocumentId);
}

function firestoreReader(
  database: Firestore,
  transaction: Transaction,
): OwnerRecordGenerationMigrationFirestoreReader {
  async function getExact(path: string) {
    const snapshot = await transaction.get(database.doc(path));
    return storedDocument(snapshot as SnapshotLike, path);
  }

  async function getPage(params: {
    collectionPath: string;
    targetUid: string;
    scope: OwnerRecordGenerationMigrationFirestorePageScope;
    pageSize: number;
    cursor: OwnerRecordGenerationMigrationFirestoreCursor | null;
    where?: Readonly<{field: "ownerUserId" | "targetUid"; value: string}>;
  }) {
    let query: Query<DocumentData, DocumentData> = database.collection(
      params.collectionPath,
    );
    if (params.where !== undefined) {
      query = query.where(params.where.field, "==", params.where.value);
    }
    query = query.orderBy(FieldPath.documentId(), "asc");
    query = queryWithCursor(query, params.cursor);
    const snapshot = await transaction.get(query.limit(params.pageSize));
    return validatedPage({
      snapshots: snapshot.docs as readonly SnapshotLike[],
      readTime: snapshot.readTime,
      expectedCollectionPath: params.collectionPath,
      targetUid: params.targetUid,
      scope: params.scope,
      pageSize: params.pageSize,
      cursor: params.cursor,
    });
  }

  const reader: OwnerRecordGenerationMigrationFirestoreReader = {
    getCanonicalAccountRoot(uid: string) {
      return getExact(directPath(accountCollection, uid));
    },
    getOwnerState(uid: string) {
      return getExact(directPath(ownerStateCollection, uid));
    },
    getBillingState(uid: string) {
      return getExact(directPath(billingStateCollection, uid));
    },
    getSubscriptionReturnState(uid: string) {
      return getExact(directPath(subscriptionReturnStateCollection, uid));
    },
    listChildDocuments(
      request: OwnerRecordGenerationMigrationChildPageRequest,
    ) {
      const exact = exactChildPageRequest(request);
      return getPage({
        collectionPath: childPath(exact.targetUid, exact.collection),
        targetUid: exact.targetUid,
        scope: exact.scope,
        pageSize: exact.pageSize,
        cursor: exact.cursor,
      });
    },
    listClaimedRatingRestaurants(
      request: OwnerRecordGenerationMigrationFirestorePageRequest,
    ) {
      const exact = exactPageRequest(request, "claimed_rating_restaurants");
      return getPage({
        collectionPath: ratingRestaurantCollection,
        targetUid: exact.targetUid,
        scope: "claimed_rating_restaurants",
        pageSize: exact.pageSize,
        cursor: exact.cursor,
        where: {field: "ownerUserId", value: exact.targetUid},
      });
    },
    listRemovalJobs(
      request: OwnerRecordGenerationMigrationFirestorePageRequest,
    ) {
      const exact = exactPageRequest(request, "removal_jobs");
      return getPage({
        collectionPath: removalJobCollection,
        targetUid: exact.targetUid,
        scope: "removal_jobs",
        pageSize: exact.pageSize,
        cursor: exact.cursor,
        where: {field: "targetUid", value: exact.targetUid},
      });
    },
  };
  return Object.freeze(reader);
}

/**
 * Creates the production Admin SDK reader. The Firestore instance is selected
 * by trusted CLI wiring, never by inventory data. The transaction is explicitly
 * read-only and the exposed boundary contains no write method.
 */
export function createFirestoreOwnerRecordGenerationMigrationStore(
  database: Firestore,
): OwnerRecordGenerationMigrationFirestoreStore {
  if (
    typeof database !== "object" ||
    database === null ||
    typeof database.doc !== "function" ||
    typeof database.collection !== "function" ||
    typeof database.runTransaction !== "function"
  ) {
    return fail("invalid_request");
  }
  const store: OwnerRecordGenerationMigrationFirestoreStore = {
    runReadOnlyInventory<T>(
      operation: (
        reader: OwnerRecordGenerationMigrationFirestoreReader,
      ) => Promise<T>,
    ): Promise<T> {
      if (typeof operation !== "function") {
        return Promise.reject(
          new OwnerRecordGenerationMigrationInventoryError("invalid_request"),
        );
      }
      return database.runTransaction(
        (transaction) => operation(firestoreReader(database, transaction)),
        {readOnly: true},
      );
    },
  };
  return Object.freeze(store);
}

function isAllowedFixturePath(path: unknown): path is string {
  if (typeof path !== "string") {
    return false;
  }
  const segments = path.split("/");
  if (segments.length === 2) {
    const [collection, id] = segments;
    if (
      collection !== accountCollection &&
      collection !== ownerStateCollection &&
      collection !== billingStateCollection &&
      collection !== subscriptionReturnStateCollection &&
      collection !== removalJobCollection &&
      collection !== ratingRestaurantCollection
    ) {
      return false;
    }
    try {
      if (
        collection === accountCollection ||
        collection === ownerStateCollection ||
        collection === billingStateCollection ||
        collection === subscriptionReturnStateCollection
      ) {
        targetUid(id);
      } else {
        documentId(id, "invalid_request");
      }
      return true;
    } catch {
      return false;
    }
  }
  if (segments.length !== 4 || segments[0] !== accountCollection) {
    return false;
  }
  try {
    targetUid(segments[1]);
    childCollection(segments[2]);
    documentId(segments[3], "invalid_request");
    return true;
  } catch {
    return false;
  }
}

function copyFixture(
  value: unknown,
): OwnerRecordGenerationMigrationFirestoreFixture {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ["data", "path", "updateTime"]) ||
    !isAllowedFixturePath(value.path) ||
    !isPlainRecord(value.data)
  ) {
    return fail("invalid_request");
  }
  return Object.freeze({
    path: value.path,
    data: Object.freeze({...value.data}),
    updateTime: timestamp(value.updateTime),
  });
}

/** A deterministic, immutable, read-only implementation for focused tests. */
export function createInMemoryOwnerRecordGenerationMigrationStore(params: {
  documents: readonly OwnerRecordGenerationMigrationFirestoreFixture[];
  readTime: OwnerRecordGenerationMigrationFirestoreTimestamp;
}): OwnerRecordGenerationMigrationFirestoreStore {
  if (
    !isPlainRecord(params) ||
    !hasOnlyKeys(params, ["documents", "readTime"]) ||
    !Array.isArray(params.documents)
  ) {
    return fail("invalid_request");
  }
  const readTime = timestamp(params.readTime);
  const documents = new Map<string, OwnerRecordGenerationMigrationFirestoreFixture>();
  for (const candidate of params.documents) {
    const copied = copyFixture(candidate);
    if (documents.has(copied.path)) {
      return fail("invalid_request");
    }
    documents.set(copied.path, copied);
  }

  function readDocument(
    fixture: OwnerRecordGenerationMigrationFirestoreFixture,
  ): OwnerRecordGenerationMigrationFirestoreDocument {
    const segments = fixture.path.split("/");
    const id = segments[segments.length - 1];
    if (id === undefined) {
      return fail("invalid_provider_response");
    }
    return Object.freeze({
      id,
      path: fixture.path,
      data: Object.freeze({...fixture.data}),
      updateTime: fixture.updateTime,
      readTime,
    });
  }

  function inMemoryPage(params: {
    collectionPath: string;
    targetUid: string;
    scope: OwnerRecordGenerationMigrationFirestorePageScope;
    pageSize: number;
    cursor: OwnerRecordGenerationMigrationFirestoreCursor | null;
    predicate?: (data: Readonly<Record<string, unknown>>) => boolean;
  }): OwnerRecordGenerationMigrationFirestorePage {
    const prefix = `${params.collectionPath}/`;
    const source = [...documents.values()]
      .filter((document) => {
        if (!document.path.startsWith(prefix)) {
          return false;
        }
        const remainder = document.path.slice(prefix.length);
        return !remainder.includes("/") &&
          (params.predicate?.(document.data) ?? true);
      })
      .sort((left, right) => compareDocumentIds(
        left.path.slice(prefix.length),
        right.path.slice(prefix.length),
      ))
      .filter((document) => params.cursor === null || compareDocumentIds(
        document.path.slice(prefix.length),
        params.cursor.afterDocumentId,
      ) > 0)
      .slice(0, params.pageSize)
      .map(readDocument);
    const frozenDocuments = Object.freeze(source);
    return Object.freeze({
      documents: frozenDocuments,
      nextCursor: nextCursor(
        params.scope,
        params.targetUid,
        frozenDocuments,
        params.pageSize,
      ),
      readTime,
    });
  }

  const reader: OwnerRecordGenerationMigrationFirestoreReader = Object.freeze({
    async getCanonicalAccountRoot(uid: string) {
      const path = directPath(accountCollection, uid);
      const fixture = documents.get(path);
      return fixture === undefined ? null : readDocument(fixture);
    },
    async getOwnerState(uid: string) {
      const path = directPath(ownerStateCollection, uid);
      const fixture = documents.get(path);
      return fixture === undefined ? null : readDocument(fixture);
    },
    async getBillingState(uid: string) {
      const path = directPath(billingStateCollection, uid);
      const fixture = documents.get(path);
      return fixture === undefined ? null : readDocument(fixture);
    },
    async getSubscriptionReturnState(uid: string) {
      const path = directPath(subscriptionReturnStateCollection, uid);
      const fixture = documents.get(path);
      return fixture === undefined ? null : readDocument(fixture);
    },
    async listChildDocuments(
      request: OwnerRecordGenerationMigrationChildPageRequest,
    ) {
      const exact = exactChildPageRequest(request);
      return inMemoryPage({
        collectionPath: childPath(exact.targetUid, exact.collection),
        targetUid: exact.targetUid,
        scope: exact.scope,
        pageSize: exact.pageSize,
        cursor: exact.cursor,
      });
    },
    async listClaimedRatingRestaurants(
      request: OwnerRecordGenerationMigrationFirestorePageRequest,
    ) {
      const exact = exactPageRequest(request, "claimed_rating_restaurants");
      return inMemoryPage({
        collectionPath: ratingRestaurantCollection,
        targetUid: exact.targetUid,
        scope: "claimed_rating_restaurants",
        pageSize: exact.pageSize,
        cursor: exact.cursor,
        predicate: (data) => data.ownerUserId === exact.targetUid,
      });
    },
    async listRemovalJobs(
      request: OwnerRecordGenerationMigrationFirestorePageRequest,
    ) {
      const exact = exactPageRequest(request, "removal_jobs");
      return inMemoryPage({
        collectionPath: removalJobCollection,
        targetUid: exact.targetUid,
        scope: "removal_jobs",
        pageSize: exact.pageSize,
        cursor: exact.cursor,
        predicate: (data) => data.targetUid === exact.targetUid,
      });
    },
  });

  const store: OwnerRecordGenerationMigrationFirestoreStore = {
    async runReadOnlyInventory<T>(
      operation: (
        reader: OwnerRecordGenerationMigrationFirestoreReader,
      ) => Promise<T>,
    ): Promise<T> {
      if (typeof operation !== "function") {
        return fail("invalid_request");
      }
      return operation(reader);
    },
  };
  return Object.freeze(store);
}
