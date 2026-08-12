import {
  buildOwnerRecordGenerationMigrationPlan,
  buildOwnerRecordGenerationMigrationRedactedSummary,
  canonicalInitialOwnerRecordGeneration,
  canonicalOwnerRecordGenerationMigrationAccountPath,
  canonicalOwnerRecordGenerationMigrationOwnerStatePath,
  ownerRecordGenerationMigrationAccountChildCollections,
  ownerRecordGenerationMigrationPaginationScopes,
  ownerRecordGenerationMigrationPlanVersion,
  ownerRecordGenerationMigrationPlannerVersion,
  ownerRecordGenerationMigrationReasonCodes,
  ownerRecordGenerationMigrationSourceCheckpointCommit,
  ownerRecordGenerationMigrationStorageKinds,
  requireOwnerRecordGenerationMigrationProjectId,
  requireOwnerRecordGenerationMigrationProviderDecimal,
  requireOwnerRecordGenerationMigrationStorageGeneration,
  requireOwnerRecordGenerationMigrationStorageObjectName,
  requireOwnerRecordGenerationMigrationTimestamp,
  type OwnerRecordGenerationMigrationAccountChildCollection,
  type OwnerRecordGenerationMigrationFirestoreScope,
  type OwnerRecordGenerationMigrationManualReviewReason,
  type OwnerRecordGenerationMigrationOperation,
  type OwnerRecordGenerationMigrationPaginationScope,
  type OwnerRecordGenerationMigrationPaginationState,
  type OwnerRecordGenerationMigrationPlan,
  type OwnerRecordGenerationMigrationReasonCode,
  type OwnerRecordGenerationMigrationStorageKind,
} from "./owner_record_generation_migration_contract.js";
import {
  ownerRecordGenerationMigrationFirestorePageLimit,
  type OwnerRecordGenerationMigrationFirestoreCursor,
  type OwnerRecordGenerationMigrationFirestoreDocument,
  type OwnerRecordGenerationMigrationFirestoreReader,
  type OwnerRecordGenerationMigrationFirestoreStore,
  type OwnerRecordGenerationMigrationFirestoreTimestamp,
} from "./owner_record_generation_migration_store.js";
import {
  ownerRecordGenerationMigrationStoragePageLimit,
  type OwnerRecordGenerationMigrationStorageCursor,
  type OwnerRecordGenerationMigrationStorageInventory,
  type OwnerRecordGenerationMigrationStorageObject,
} from "./owner_record_generation_migration_storage.js";
import {parseOwnerBillingStateDocument} from
  "./owner_billing_state_contract.js";
import {parseOwnerRecordRemovalJobDocument} from
  "./owner_record_removal_contract.js";
import {
  parseOwnerRecordStateDocument,
  requireOwnerRecordGeneration,
  requireOwnerRecordUid,
} from "./owner_record_state_contract.js";
import {listSubscriptionReturnEvents} from
  "./subscription_return_ledger.js";

export const ownerRecordGenerationMigrationInventoryVersion =
  "bitestar.owner-record-generation-migration-inventory.v1" as const;
export const ownerRecordGenerationMigrationMaximumPagesPerScope = 100 as const;
export const ownerRecordGenerationMigrationMaximumStorageObjectBytes =
  5 * 1024 * 1024;

type InventoryIssue = Readonly<{
  code: OwnerRecordGenerationMigrationReasonCode;
  documentPath: string | null;
  storageObjectName: string | null;
  existingGeneration: number | string | null;
}>;

export type OwnerRecordGenerationMigrationChildInventory = Readonly<{
  collection: OwnerRecordGenerationMigrationAccountChildCollection;
  documents: readonly OwnerRecordGenerationMigrationFirestoreDocument[];
}>;

export type OwnerRecordGenerationMigrationStorageInventoryGroup = Readonly<{
  kind: OwnerRecordGenerationMigrationStorageKind;
  objects: readonly OwnerRecordGenerationMigrationStorageObject[];
}>;

/**
 * Complete read-only input to the pure planner. Business payloads remain local
 * to this object and are never copied into the plan or redacted summary.
 */
export type OwnerRecordGenerationMigrationInventory = Readonly<{
  schemaVersion: typeof ownerRecordGenerationMigrationInventoryVersion;
  projectId: string;
  generatedAt: string;
  ownerUid: string;
  accountRoot: OwnerRecordGenerationMigrationFirestoreDocument | null;
  ownerState: OwnerRecordGenerationMigrationFirestoreDocument | null;
  billingState: OwnerRecordGenerationMigrationFirestoreDocument | null;
  subscriptionReturnState:
    OwnerRecordGenerationMigrationFirestoreDocument | null;
  removalJobs: readonly OwnerRecordGenerationMigrationFirestoreDocument[];
  children: readonly OwnerRecordGenerationMigrationChildInventory[];
  ratingClaims: readonly OwnerRecordGenerationMigrationFirestoreDocument[];
  storage: readonly OwnerRecordGenerationMigrationStorageInventoryGroup[];
  pagination: readonly OwnerRecordGenerationMigrationPaginationState[];
  inventoryIssues: readonly InventoryIssue[];
}>;

export type CollectOwnerRecordGenerationMigrationInventoryInput = Readonly<{
  projectId: string;
  ownerUid: string;
  firestoreStore: OwnerRecordGenerationMigrationFirestoreStore;
  storageStore: OwnerRecordGenerationMigrationStorageInventory;
  now?: Date;
  clock?: () => Date;
}>;

type FirestoreCollected = Readonly<{
  accountRoot: OwnerRecordGenerationMigrationFirestoreDocument | null;
  ownerState: OwnerRecordGenerationMigrationFirestoreDocument | null;
  billingState: OwnerRecordGenerationMigrationFirestoreDocument | null;
  subscriptionReturnState:
    OwnerRecordGenerationMigrationFirestoreDocument | null;
  removalJobs: readonly OwnerRecordGenerationMigrationFirestoreDocument[];
  children: readonly OwnerRecordGenerationMigrationChildInventory[];
  ratingClaims: readonly OwnerRecordGenerationMigrationFirestoreDocument[];
  pagination: readonly OwnerRecordGenerationMigrationPaginationState[];
  issues: readonly InventoryIssue[];
}>;

function issue(
  code: OwnerRecordGenerationMigrationReasonCode,
  options: Partial<Omit<InventoryIssue, "code">> = {},
): InventoryIssue {
  return Object.freeze({
    code,
    documentPath: options.documentPath ?? null,
    storageObjectName: options.storageObjectName ?? null,
    existingGeneration: options.existingGeneration ?? null,
  });
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyStringKeys(value: Record<PropertyKey, unknown>): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === "string");
}

function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value !== "." &&
    value !== ".." && !value.includes("/") &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    Buffer.byteLength(value, "utf8") <= 1_500;
}

function safeGeneration(value: unknown): number | null {
  try {
    return requireOwnerRecordGeneration(value);
  } catch {
    return null;
  }
}

function validTimestamp(
  value: unknown,
): value is OwnerRecordGenerationMigrationFirestoreTimestamp {
  if (!isPlainRecord(value) || !hasOnlyStringKeys(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return keys.length === 2 && keys[0] === "nanoseconds" &&
    keys[1] === "seconds" && typeof value.seconds === "string" &&
    /^(?:0|[1-9][0-9]{0,11})$/u.test(value.seconds) &&
    typeof value.nanoseconds === "number" &&
    Number.isInteger(value.nanoseconds) && value.nanoseconds >= 0 &&
    value.nanoseconds <= 999_999_999;
}

function timestampOrder(
  left: OwnerRecordGenerationMigrationFirestoreTimestamp,
  right: OwnerRecordGenerationMigrationFirestoreTimestamp,
): number {
  const leftSeconds = BigInt(left.seconds);
  const rightSeconds = BigInt(right.seconds);
  if (leftSeconds !== rightSeconds) {
    return leftSeconds < rightSeconds ? -1 : 1;
  }
  return left.nanoseconds - right.nanoseconds;
}

function sameTimestamp(
  left: OwnerRecordGenerationMigrationFirestoreTimestamp,
  right: OwnerRecordGenerationMigrationFirestoreTimestamp,
): boolean {
  return left.seconds === right.seconds &&
    left.nanoseconds === right.nanoseconds;
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) {
      return candidate.map(normalize);
    }
    if (isPlainRecord(candidate)) {
      const result: Record<string, unknown> = {};
      for (const key of (Reflect.ownKeys(candidate) as string[]).sort()) {
        result[key] = normalize(candidate[key]);
      }
      return result;
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function cursorText(value: unknown): string {
  try {
    const result = canonicalJson(value);
    return typeof result === "string" && result.length > 0 &&
        Buffer.byteLength(result, "utf8") <= 4_096
      ? result
      : "inventory-boundary-error";
  } catch {
    return "inventory-boundary-error";
  }
}

function compareUtf8Text(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function paginationState(params: {
  scope: OwnerRecordGenerationMigrationPaginationScope;
  complete: boolean;
  nextCursor: unknown;
  pagesRead: number;
  recordsRead: number;
}): OwnerRecordGenerationMigrationPaginationState {
  return Object.freeze({
    scope: params.scope,
    complete: params.complete,
    nextCursor: params.complete
      ? null
      : params.nextCursor === "inventory-boundary-error"
        ? "inventory-boundary-error"
        : cursorText(params.nextCursor),
    pagesRead: Math.max(1, params.pagesRead),
    recordsRead: Math.max(0, params.recordsRead),
  });
}

function errorCode(value: unknown): unknown {
  return typeof value === "object" && value !== null && "code" in value
    ? value.code
    : undefined;
}

function expectedFirestoreCursorScope(
  scope: OwnerRecordGenerationMigrationPaginationScope,
): string | null {
  if (scope === "removal_jobs") {
    return "removal_jobs";
  }
  if (scope === "rating_claims") {
    return "claimed_rating_restaurants";
  }
  return ownerRecordGenerationMigrationAccountChildCollections.some(
    (collection) => collection === scope,
  ) ? `child:${scope}` : null;
}

function validReturnedFirestoreCursor(params: {
  cursor: unknown;
  ownerUid: string;
  scope: OwnerRecordGenerationMigrationPaginationScope;
  lastDocumentId: string | null;
}): params is {
  cursor: OwnerRecordGenerationMigrationFirestoreCursor;
  ownerUid: string;
  scope: OwnerRecordGenerationMigrationPaginationScope;
  lastDocumentId: string;
} {
  const expectedScope = expectedFirestoreCursorScope(params.scope);
  return isPlainRecord(params.cursor) &&
    hasOnlyStringKeys(params.cursor) &&
    Object.keys(params.cursor).length === 4 &&
    params.cursor.version ===
      "bitestar.owner-record-generation-migration-firestore-cursor.v1" &&
    params.cursor.targetUid === params.ownerUid &&
    params.cursor.scope === expectedScope &&
    params.cursor.afterDocumentId === params.lastDocumentId &&
    validDocumentId(params.cursor.afterDocumentId);
}

function validReturnedStorageCursor(params: {
  cursor: unknown;
  ownerUid: string;
  kind: OwnerRecordGenerationMigrationStorageKind;
  lastObjectName: string | null;
}): params is {
  cursor: OwnerRecordGenerationMigrationStorageCursor;
  ownerUid: string;
  kind: OwnerRecordGenerationMigrationStorageKind;
  lastObjectName: string;
} {
  if (
    !isPlainRecord(params.cursor) || !hasOnlyStringKeys(params.cursor) ||
    Object.keys(params.cursor).length !== 5 ||
    params.cursor.version !==
      "bitestar.owner-record-generation-migration-storage-cursor.v1" ||
    params.cursor.targetUid !== params.ownerUid ||
    params.cursor.kind !== params.kind ||
    params.cursor.afterObjectName !== params.lastObjectName ||
    typeof params.cursor.pageToken !== "string" ||
    params.cursor.pageToken.length === 0 ||
    Buffer.byteLength(params.cursor.pageToken, "utf8") > 4_096 ||
    /[\u0000-\u001f\u007f]/u.test(params.cursor.pageToken)
  ) {
    return false;
  }
  return safeReasonStorageName(
    params.ownerUid,
    params.kind,
    params.cursor.afterObjectName,
  ) !== null;
}

async function collectFirestorePage(params: {
  scope: OwnerRecordGenerationMigrationPaginationScope;
  ownerUid: string;
  read: (
    cursor: OwnerRecordGenerationMigrationFirestoreCursor | null,
  ) => ReturnType<OwnerRecordGenerationMigrationFirestoreReader["listRemovalJobs"]>;
  observeReadTime: (
    value: OwnerRecordGenerationMigrationFirestoreTimestamp,
  ) => void;
  issues: InventoryIssue[];
}): Promise<Readonly<{
  documents: readonly OwnerRecordGenerationMigrationFirestoreDocument[];
  pagination: OwnerRecordGenerationMigrationPaginationState;
}>> {
  const documents: OwnerRecordGenerationMigrationFirestoreDocument[] = [];
  let cursor: OwnerRecordGenerationMigrationFirestoreCursor | null = null;
  let pagesRead = 0;
  try {
    while (pagesRead < ownerRecordGenerationMigrationMaximumPagesPerScope) {
      const page = await params.read(cursor);
      pagesRead += 1;
      if (
        !isPlainRecord(page) ||
        !hasExactKeys(page, ["documents", "nextCursor", "readTime"]) ||
        !Array.isArray(page.documents) ||
        page.documents.length >
          ownerRecordGenerationMigrationFirestorePageLimit
      ) {
        throw new TypeError("invalid-provider-response");
      }
      params.observeReadTime(page.readTime);
      for (const document of page.documents) {
        if (!isPlainRecord(document) || !validTimestamp(document.readTime) ||
          !validTimestamp(document.updateTime)) {
          throw new TypeError("invalid-provider-response");
        }
        params.observeReadTime(document.readTime);
      }
      documents.push(...page.documents);
      if (page.nextCursor === null) {
        if (
          page.documents.length ===
            ownerRecordGenerationMigrationFirestorePageLimit
        ) {
          throw new TypeError("invalid-provider-response");
        }
        return Object.freeze({
          documents: Object.freeze(documents),
          pagination: paginationState({
            scope: params.scope,
            complete: true,
            nextCursor: null,
            pagesRead,
            recordsRead: documents.length,
          }),
        });
      }
      const lastDocumentId = page.documents.length === 0
        ? null
        : page.documents[page.documents.length - 1]?.id ?? null;
      if (!validReturnedFirestoreCursor({
        cursor: page.nextCursor,
        ownerUid: params.ownerUid,
        scope: params.scope,
        lastDocumentId,
      })) {
        params.issues.push(issue("pagination_cursor_invalid"));
        params.issues.push(issue("inventory_incomplete"));
        return Object.freeze({
          documents: Object.freeze(documents),
          pagination: paginationState({
            scope: params.scope,
            complete: false,
            nextCursor: "inventory-boundary-error",
            pagesRead,
            recordsRead: documents.length,
          }),
        });
      }
      if (
        cursor !== null &&
        compareUtf8Text(
          page.nextCursor.afterDocumentId,
          cursor.afterDocumentId,
        ) <= 0
      ) {
        params.issues.push(issue("pagination_cursor_invalid"));
        params.issues.push(issue("inventory_incomplete"));
        return Object.freeze({
          documents: Object.freeze(documents),
          pagination: paginationState({
            scope: params.scope,
            complete: false,
            nextCursor: "inventory-boundary-error",
            pagesRead,
            recordsRead: documents.length,
          }),
        });
      }
      cursor = page.nextCursor;
    }
    params.issues.push(issue("inventory_bounds_exceeded"));
    params.issues.push(issue("inventory_incomplete"));
    return Object.freeze({
      documents: Object.freeze(documents),
      pagination: paginationState({
        scope: params.scope,
        complete: false,
        nextCursor: cursor,
        pagesRead,
        recordsRead: documents.length,
      }),
    });
  } catch (error) {
    if (errorCode(error) === "invalid_cursor") {
      params.issues.push(issue("pagination_cursor_invalid"));
    }
    params.issues.push(issue("inventory_incomplete"));
    return Object.freeze({
      documents: Object.freeze(documents),
      pagination: paginationState({
        scope: params.scope,
        complete: false,
        nextCursor: cursor ?? "inventory-boundary-error",
        pagesRead,
        recordsRead: documents.length,
      }),
    });
  }
}

async function collectFirestore(
  store: OwnerRecordGenerationMigrationFirestoreStore,
  ownerUid: string,
): Promise<FirestoreCollected> {
  try {
    return await store.runReadOnlyInventory(async (reader) => {
      const issues: InventoryIssue[] = [];
      let snapshotReadTime:
        OwnerRecordGenerationMigrationFirestoreTimestamp | null = null;
      const observeReadTime = (
        value: OwnerRecordGenerationMigrationFirestoreTimestamp,
      ) => {
        if (!validTimestamp(value)) {
          issues.push(issue("unsafe_timestamp"));
        } else if (snapshotReadTime === null) {
          snapshotReadTime = value;
        } else if (!sameTimestamp(snapshotReadTime, value)) {
          issues.push(issue("unsafe_timestamp"));
        }
      };
      const [accountRoot, ownerState, billingState, subscriptionReturnState] =
        await Promise.all([
          reader.getCanonicalAccountRoot(ownerUid),
          reader.getOwnerState(ownerUid),
          reader.getBillingState(ownerUid),
          reader.getSubscriptionReturnState(ownerUid),
        ]);
      for (const document of [
        accountRoot,
        ownerState,
        billingState,
        subscriptionReturnState,
      ]) {
        if (document !== null) {
          observeReadTime(document.readTime);
        }
      }
      const removal = await collectFirestorePage({
        scope: "removal_jobs",
        ownerUid,
        read: (cursor) => reader.listRemovalJobs({
          targetUid: ownerUid,
          pageSize: ownerRecordGenerationMigrationFirestorePageLimit,
          cursor,
        }),
        observeReadTime,
        issues,
      });
      const children: OwnerRecordGenerationMigrationChildInventory[] = [];
      const pagination: OwnerRecordGenerationMigrationPaginationState[] = [
        removal.pagination,
      ];
      for (const collection of
        ownerRecordGenerationMigrationAccountChildCollections) {
        const page = await collectFirestorePage({
          scope: collection,
          ownerUid,
          read: (cursor) => reader.listChildDocuments({
            targetUid: ownerUid,
            collection,
            pageSize: ownerRecordGenerationMigrationFirestorePageLimit,
            cursor,
          }),
          observeReadTime,
          issues,
        });
        children.push(Object.freeze({
          collection,
          documents: page.documents,
        }));
        pagination.push(page.pagination);
      }
      const ratings = await collectFirestorePage({
        scope: "rating_claims",
        ownerUid,
        read: (cursor) => reader.listClaimedRatingRestaurants({
          targetUid: ownerUid,
          pageSize: ownerRecordGenerationMigrationFirestorePageLimit,
          cursor,
        }),
        observeReadTime,
        issues,
      });
      pagination.push(ratings.pagination);
      return Object.freeze({
        accountRoot,
        ownerState,
        billingState,
        subscriptionReturnState,
        removalJobs: removal.documents,
        children: Object.freeze(children),
        ratingClaims: ratings.documents,
        pagination: Object.freeze(pagination),
        issues: Object.freeze(issues),
      });
    });
  } catch {
    const pagination = [
      "removal_jobs" as const,
      ...ownerRecordGenerationMigrationAccountChildCollections,
      "rating_claims" as const,
    ].map((scope) => paginationState({
      scope,
      complete: false,
      nextCursor: "inventory-boundary-error",
      pagesRead: 1,
      recordsRead: 0,
    }));
    return Object.freeze({
      accountRoot: null,
      ownerState: null,
      billingState: null,
      subscriptionReturnState: null,
      removalJobs: Object.freeze([]),
      children: Object.freeze(
        ownerRecordGenerationMigrationAccountChildCollections.map(
          (collection) => Object.freeze({
            collection,
            documents: Object.freeze([]),
          }),
        ),
      ),
      ratingClaims: Object.freeze([]),
      pagination: Object.freeze(pagination),
      issues: Object.freeze([issue("inventory_incomplete")]),
    });
  }
}

async function collectStorageGroup(params: {
  store: OwnerRecordGenerationMigrationStorageInventory;
  ownerUid: string;
  kind: OwnerRecordGenerationMigrationStorageKind;
}): Promise<Readonly<{
  objects: readonly OwnerRecordGenerationMigrationStorageObject[];
  pagination: OwnerRecordGenerationMigrationPaginationState;
  issues: readonly InventoryIssue[];
}>> {
  const objects: OwnerRecordGenerationMigrationStorageObject[] = [];
  const issues: InventoryIssue[] = [];
  let cursor: OwnerRecordGenerationMigrationStorageCursor | null = null;
  let pagesRead = 0;
  const scope = `storage_${params.kind}` as
    OwnerRecordGenerationMigrationPaginationScope;
  try {
    while (pagesRead < ownerRecordGenerationMigrationMaximumPagesPerScope) {
      const page = await params.store.listObjects({
        targetUid: params.ownerUid,
        kind: params.kind,
        pageSize: ownerRecordGenerationMigrationStoragePageLimit,
        cursor,
      });
      pagesRead += 1;
      if (
        !isPlainRecord(page) ||
        !hasExactKeys(page, ["objects", "nextCursor"]) ||
        !Array.isArray(page.objects) ||
        page.objects.length > ownerRecordGenerationMigrationStoragePageLimit
      ) {
        throw new TypeError("invalid-provider-response");
      }
      objects.push(...page.objects);
      if (page.nextCursor === null) {
        return Object.freeze({
          objects: Object.freeze(objects),
          pagination: paginationState({
            scope,
            complete: true,
            nextCursor: null,
            pagesRead,
            recordsRead: objects.length,
          }),
          issues: Object.freeze(issues),
        });
      }
      const lastObjectName = page.objects.length === 0
        ? null
        : typeof page.objects[page.objects.length - 1]?.name === "string"
          ? page.objects[page.objects.length - 1].name
          : null;
      if (!validReturnedStorageCursor({
        cursor: page.nextCursor,
        ownerUid: params.ownerUid,
        kind: params.kind,
        lastObjectName,
      })) {
        issues.push(issue("pagination_cursor_invalid"));
        issues.push(issue("inventory_incomplete"));
        return Object.freeze({
          objects: Object.freeze(objects),
          pagination: paginationState({
            scope,
            complete: false,
            nextCursor: "inventory-boundary-error",
            pagesRead,
            recordsRead: objects.length,
          }),
          issues: Object.freeze(issues),
        });
      }
      if (
        cursor !== null &&
        compareUtf8Text(
          page.nextCursor.afterObjectName,
          cursor.afterObjectName,
        ) <= 0
      ) {
        issues.push(issue("pagination_cursor_invalid"));
        issues.push(issue("inventory_incomplete"));
        return Object.freeze({
          objects: Object.freeze(objects),
          pagination: paginationState({
            scope,
            complete: false,
            nextCursor: "inventory-boundary-error",
            pagesRead,
            recordsRead: objects.length,
          }),
          issues: Object.freeze(issues),
        });
      }
      cursor = page.nextCursor;
    }
    if (pagesRead >= ownerRecordGenerationMigrationMaximumPagesPerScope) {
      issues.push(issue("inventory_bounds_exceeded"));
      issues.push(issue("inventory_incomplete"));
    }
  } catch (error) {
    if (errorCode(error) === "invalid_cursor") {
      issues.push(issue("pagination_cursor_invalid"));
    }
    issues.push(issue("inventory_incomplete"));
  }
  return Object.freeze({
    objects: Object.freeze(objects),
    pagination: paginationState({
      scope,
      complete: false,
      nextCursor: cursor ?? "inventory-boundary-error",
      pagesRead,
      recordsRead: objects.length,
    }),
    issues: Object.freeze(issues),
  });
}

/** Collects every allowlisted scope through bounded, read-only interfaces. */
export async function collectOwnerRecordGenerationMigrationInventory(
  input: CollectOwnerRecordGenerationMigrationInventoryInput,
): Promise<OwnerRecordGenerationMigrationInventory> {
  const projectId = requireOwnerRecordGenerationMigrationProjectId(
    input.projectId,
  );
  const ownerUid = requireOwnerRecordUid(input.ownerUid);
  const now = input.now ?? input.clock?.() ?? new Date();
  const generatedAt = requireOwnerRecordGenerationMigrationTimestamp(
    new Date(now.getTime()).toISOString(),
  );
  const firestore = await collectFirestore(input.firestoreStore, ownerUid);
  const storage: OwnerRecordGenerationMigrationStorageInventoryGroup[] = [];
  const pagination = [...firestore.pagination];
  const issues = [...firestore.issues];
  for (const kind of ownerRecordGenerationMigrationStorageKinds) {
    const group = await collectStorageGroup({
      store: input.storageStore,
      ownerUid,
      kind,
    });
    storage.push(Object.freeze({kind, objects: group.objects}));
    pagination.push(group.pagination);
    issues.push(...group.issues);
  }
  return Object.freeze({
    schemaVersion: ownerRecordGenerationMigrationInventoryVersion,
    projectId,
    generatedAt,
    ownerUid,
    accountRoot: firestore.accountRoot,
    ownerState: firestore.ownerState,
    billingState: firestore.billingState,
    subscriptionReturnState: firestore.subscriptionReturnState,
    removalJobs: firestore.removalJobs,
    children: firestore.children,
    ratingClaims: firestore.ratingClaims,
    storage: Object.freeze(storage),
    pagination: Object.freeze(pagination),
    inventoryIssues: Object.freeze(issues),
  });
}

type PlanningContext = {
  readonly inventory: OwnerRecordGenerationMigrationInventory;
  readonly generation: number;
  readonly ownerExists: boolean;
  activeRemovalSourceGeneration: number | null;
  readonly operations: OwnerRecordGenerationMigrationOperation[];
  readonly reasons: OwnerRecordGenerationMigrationManualReviewReason[];
  readonly observedGenerations: Set<number>;
  readonly documentPaths: Set<string>;
  readonly storageObjectNames: Set<string>;
};

const inventoryEnvelopeKeys = Object.freeze([
  "schemaVersion",
  "projectId",
  "generatedAt",
  "ownerUid",
  "accountRoot",
  "ownerState",
  "billingState",
  "subscriptionReturnState",
  "removalJobs",
  "children",
  "ratingClaims",
  "storage",
  "pagination",
  "inventoryIssues",
] as const);

function hasExactKeys(
  value: Record<PropertyKey, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length &&
    keys.every((key) => typeof key === "string") &&
    expected.every((key) => keys.includes(key));
}

function compareCanonical(left: unknown, right: unknown): number {
  const a = canonicalJson(left);
  const b = canonicalJson(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedCanonical<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values].sort(compareCanonical));
}

function safeReasonDocumentPath(
  ownerUid: string,
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parts = value.split("/");
  if (
    value === `restaurant_accounts/${ownerUid}` ||
    value === `private_owner_record_states/${ownerUid}` ||
    value === `private_owner_billing_states/${ownerUid}` ||
    value === `private_subscription_return_state/${ownerUid}` ||
    (parts.length === 2 &&
      parts[0] === "private_owner_record_removal_jobs" &&
      validDocumentId(parts[1])) ||
    (parts.length === 2 && parts[0] === "bitescore_restaurants" &&
      validDocumentId(parts[1])) ||
    (parts.length === 4 && parts[0] === "restaurant_accounts" &&
      parts[1] === ownerUid &&
      ownerRecordGenerationMigrationAccountChildCollections.some(
        (collection) => collection === parts[2],
      ) && validDocumentId(parts[3]))
  ) {
    return value;
  }
  return null;
}

function possiblePath(value: unknown): unknown {
  return isPlainRecord(value) ? value.path : null;
}

function safeReasonStorageName(
  ownerUid: string,
  kind: OwnerRecordGenerationMigrationStorageKind,
  value: unknown,
): string | null {
  try {
    return requireOwnerRecordGenerationMigrationStorageObjectName({
      ownerUid,
      storageKind: kind,
      objectName: value,
    });
  } catch {
    return null;
  }
}

function addReason(
  context: PlanningContext,
  code: OwnerRecordGenerationMigrationReasonCode,
  options: Partial<Omit<
    OwnerRecordGenerationMigrationManualReviewReason,
    "code"
  >> = {},
): void {
  context.reasons.push(Object.freeze({
    code,
    documentPath: options.documentPath ?? null,
    storageObjectName: options.storageObjectName ?? null,
    existingGeneration: options.existingGeneration ?? null,
  }));
}

function validFirestoreDocument(
  value: unknown,
  expectedPath: string,
): value is OwnerRecordGenerationMigrationFirestoreDocument {
  if (!isPlainRecord(value) || !hasOnlyStringKeys(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  const expected = ["data", "id", "path", "readTime", "updateTime"].sort();
  const pathParts = expectedPath.split("/");
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    value.path === expectedPath &&
    value.id === pathParts[pathParts.length - 1] &&
    isPlainRecord(value.data) && hasOnlyStringKeys(value.data) &&
    validTimestamp(value.updateTime) && validTimestamp(value.readTime);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= 1_500;
}

function validPaginationCursorText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 4_096 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function optionalDocumentIdMatches(
  data: Record<PropertyKey, unknown>,
  documentId: string,
): boolean {
  return !Object.prototype.hasOwnProperty.call(data, "id") ||
    data.id === documentId;
}

function timestampEpoch(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (
    typeof value === "object" && value !== null &&
    "toDate" in value && typeof value.toDate === "function"
  ) {
    try {
      const parsed = value.toDate();
      return parsed instanceof Date && Number.isFinite(parsed.getTime())
        ? parsed.getTime()
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function recognizableChildShape(params: {
  ownerUid: string;
  collection: OwnerRecordGenerationMigrationAccountChildCollection;
  documentId: string;
  data: Record<PropertyKey, unknown>;
}): boolean {
  const data = params.data;
  if (!optionalDocumentIdMatches(data, params.documentId)) {
    return false;
  }
  const ownerFields = ["ownerUid", "restaurantId"] as const;
  for (const field of ownerFields) {
    if (
      Object.prototype.hasOwnProperty.call(data, field) &&
      data[field] !== params.ownerUid
    ) {
      return false;
    }
  }
  switch (params.collection) {
  case "coupons": {
    if (!nonEmptyString(data.restaurant) || !nonEmptyString(data.title)) {
      return false;
    }
    const hasStart = Object.prototype.hasOwnProperty.call(data, "startTime");
    const hasEnd = Object.prototype.hasOwnProperty.call(data, "endTime");
    if (hasStart || hasEnd) {
      const start = timestampEpoch(data.startTime);
      const end = timestampEpoch(data.endTime);
      return start !== null && end !== null && end > start;
    }
    return nonEmptyString(data.distance) && nonEmptyString(data.expires);
  }
  case "daily_specials":
    return nonEmptyString(data.title);
  case "menu_images": {
    if (!nonEmptyString(data.imageUrl)) {
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(data, "storagePath")) {
      return true;
    }
    if (data.storagePath === null) {
      return true;
    }
    try {
      requireOwnerRecordGenerationMigrationStorageObjectName({
        ownerUid: params.ownerUid,
        storageKind: "menu_images",
        objectName: data.storagePath,
      });
      return true;
    } catch {
      return false;
    }
  }
  case "menu_items":
    return nonEmptyString(data.name) && nonEmptyString(data.category);
  case "menu_sections":
    return nonEmptyString(data.title) && nonEmptyString(data.body);
  case "coupon_number_reservations":
    return nonEmptyString(data.couponId) &&
      typeof data.couponNumber === "string" &&
      /^\d{4}$/u.test(data.couponNumber) &&
      data.couponNumber === params.documentId;
  case "coupon_code_reservations": {
    if (
      !nonEmptyString(data.couponId) ||
      !nonEmptyString(data.couponCode) ||
      !nonEmptyString(data.normalizedCouponCode)
    ) {
      return false;
    }
    const normalized = data.couponCode.trim().toUpperCase();
    return data.normalizedCouponCode === normalized &&
      params.documentId === encodeURIComponent(normalized);
  }
  }
}

function generationObservation(data: Record<PropertyKey, unknown>):
  Readonly<{kind: "missing"}> |
  Readonly<{kind: "valid"; value: number}> |
  Readonly<{kind: "malformed"}> {
  if (!Object.prototype.hasOwnProperty.call(data, "ownerRecordGeneration")) {
    return Object.freeze({kind: "missing"});
  }
  const parsed = safeGeneration(data.ownerRecordGeneration);
  return parsed === null
    ? Object.freeze({kind: "malformed"})
    : Object.freeze({kind: "valid", value: parsed});
}

function generationReasonCode(
  scope: "record" | "rating" | "storage",
  value: number,
  expected: number,
): OwnerRecordGenerationMigrationReasonCode {
  const suffix = value < expected ? "older" : "newer";
  if (scope === "rating") {
    return suffix === "older"
      ? "rating_claim_generation_older"
      : "rating_claim_generation_newer";
  }
  if (scope === "storage") {
    return suffix === "older"
      ? "storage_generation_older"
      : "storage_generation_newer";
  }
  return suffix === "older"
    ? "record_generation_older"
    : "record_generation_newer";
}

function inspectFirestoreGeneration(params: {
  context: PlanningContext;
  document: OwnerRecordGenerationMigrationFirestoreDocument;
  scope: OwnerRecordGenerationMigrationFirestoreScope;
  reasonScope: "record" | "rating";
}): void {
  const observation = generationObservation(params.document.data);
  const path = safeReasonDocumentPath(
    params.context.inventory.ownerUid,
    params.document.path,
  );
  if (observation.kind === "malformed") {
    addReason(
      params.context,
      params.reasonScope === "rating"
        ? "rating_claim_generation_malformed"
        : "record_generation_malformed",
      {documentPath: path},
    );
    return;
  }
  if (observation.kind === "valid") {
    params.context.observedGenerations.add(observation.value);
    const expectedGeneration =
      params.context.activeRemovalSourceGeneration ??
      params.context.generation;
    if (observation.value !== expectedGeneration) {
      addReason(params.context, generationReasonCode(
        params.reasonScope,
        observation.value,
        expectedGeneration,
      ), {
        documentPath: path,
        existingGeneration: observation.value,
      });
    }
    return;
  }
  if (
    params.context.ownerExists ||
    params.context.activeRemovalSourceGeneration !== null
  ) {
    addReason(params.context, "record_generation_missing_after_initialization", {
      documentPath: path,
    });
    return;
  }
  if (!validTimestamp(params.document.updateTime)) {
    addReason(params.context, "unsafe_timestamp", {documentPath: path});
    return;
  }
  params.context.operations.push(Object.freeze({
    operation: "stamp_firestore_document",
    scope: params.scope,
    documentPath: params.document.path,
      ownerRecordGeneration: params.context.generation,
    existingGeneration: null,
    precondition: Object.freeze({
      kind: "update_time",
      updateTime: params.document.updateTime,
    }),
  }));
}

function inspectRoot(context: PlanningContext): void {
  const root = context.inventory.accountRoot;
  if (root === null) {
    return;
  }
  const expectedPath = canonicalOwnerRecordGenerationMigrationAccountPath(
    context.inventory.ownerUid,
  );
  if (!validFirestoreDocument(root, expectedPath)) {
    addReason(context, "record_shape_unrecognized", {
      documentPath: safeReasonDocumentPath(
        context.inventory.ownerUid,
        possiblePath(root),
      ),
    });
    return;
  }
  if (
    Object.prototype.hasOwnProperty.call(root.data, "uid") &&
    root.data.uid !== null && root.data.uid !== context.inventory.ownerUid
  ) {
    addReason(context, "account_root_owner_conflict", {
      documentPath: expectedPath,
    });
  }
  const recognizedRoot =
    nonEmptyString(root.data.restaurantName) ||
    nonEmptyString(root.data.name);
  if (!recognizedRoot) {
    addReason(context, "record_shape_unrecognized", {
      documentPath: expectedPath,
    });
  }
  inspectFirestoreGeneration({
    context,
    document: root,
    scope: "account_root",
    reasonScope: "record",
  });
}

function inspectChildren(context: PlanningContext): void {
  const seenCollections = new Set<string>();
  for (const group of sortedCanonical(context.inventory.children)) {
    if (
      !isPlainRecord(group) || group.collection === undefined ||
      !hasExactKeys(group, ["collection", "documents"]) ||
      !ownerRecordGenerationMigrationAccountChildCollections.some(
        (collection) => collection === group.collection,
      ) || !Array.isArray(group.documents) ||
      seenCollections.has(group.collection as string)
    ) {
      addReason(context, "inventory_incomplete");
      continue;
    }
    const collection = group.collection as
      OwnerRecordGenerationMigrationAccountChildCollection;
    seenCollections.add(collection);
    if (
      group.documents.length >
        ownerRecordGenerationMigrationMaximumPagesPerScope *
          ownerRecordGenerationMigrationFirestorePageLimit
    ) {
      addReason(context, "inventory_bounds_exceeded");
      continue;
    }
    for (const document of sortedCanonical(group.documents)) {
      const expectedPrefix = `restaurant_accounts/${context.inventory.ownerUid}/` +
        `${collection}/`;
      const expectedPath = typeof document?.id === "string"
        ? expectedPrefix + document.id
        : "";
      if (
        !validDocumentId(document?.id) ||
        !validFirestoreDocument(document, expectedPath)
      ) {
        addReason(context, "record_shape_unrecognized", {
          documentPath: safeReasonDocumentPath(
            context.inventory.ownerUid,
            document?.path,
          ),
        });
        continue;
      }
      if (context.documentPaths.has(document.path)) {
        addReason(context, "duplicate_document_path", {
          documentPath: document.path,
        });
      } else {
        context.documentPaths.add(document.path);
      }
      if (!recognizableChildShape({
        ownerUid: context.inventory.ownerUid,
        collection,
        documentId: document.id,
        data: document.data,
      })) {
        const ownerConflict = ["ownerUid", "restaurantId"].some((field) =>
          Object.prototype.hasOwnProperty.call(document.data, field) &&
          document.data[field] !== context.inventory.ownerUid) ||
          (collection === "menu_images" &&
            Object.prototype.hasOwnProperty.call(
              document.data,
              "storagePath",
            ) && document.data.storagePath !== null &&
            (typeof document.data.storagePath !== "string" ||
              !document.data.storagePath.startsWith(
                `bitesaver_restaurants/${context.inventory.ownerUid}/` +
                  "menu_images/",
              )));
        addReason(context, ownerConflict
          ? "record_owner_conflict"
          : "record_shape_unrecognized", {documentPath: document.path});
      }
      inspectFirestoreGeneration({
        context,
        document,
        scope: collection,
        reasonScope: "record",
      });
    }
  }
  if (
    seenCollections.size !==
      ownerRecordGenerationMigrationAccountChildCollections.length
  ) {
    addReason(context, "inventory_incomplete");
  }
}

function inspectRatings(context: PlanningContext): Set<string> {
  const claimedIds = new Set<string>();
  if (
    context.inventory.ratingClaims.length >
      ownerRecordGenerationMigrationMaximumPagesPerScope *
        ownerRecordGenerationMigrationFirestorePageLimit
  ) {
    addReason(context, "inventory_bounds_exceeded");
    return claimedIds;
  }
  for (const document of sortedCanonical(context.inventory.ratingClaims)) {
    const expectedPath = typeof document?.id === "string"
      ? `bitescore_restaurants/${document.id}`
      : "";
    if (
      !validDocumentId(document?.id) ||
      !validFirestoreDocument(document, expectedPath)
    ) {
      addReason(context, "record_shape_unrecognized", {
        documentPath: safeReasonDocumentPath(
          context.inventory.ownerUid,
            isPlainRecord(document) ? document.path : null,
        ),
      });
      continue;
    }
    if (context.documentPaths.has(document.path)) {
      addReason(context, "duplicate_document_path", {
        documentPath: document.path,
      });
    } else {
      context.documentPaths.add(document.path);
    }
    if (document.data.ownerUserId !== context.inventory.ownerUid) {
      addReason(context, "rating_claim_owner_conflict", {
        documentPath: document.path,
      });
    }
    if (document.data.isClaimed !== true) {
      addReason(context, "rating_claim_status_conflict", {
        documentPath: document.path,
      });
    }
    if (!optionalDocumentIdMatches(document.data, document.id)) {
      addReason(context, "record_shape_unrecognized", {
        documentPath: document.path,
      });
    }
    if (
      typeof document.data.restaurantWriteRevision !== "number" ||
      !Number.isSafeInteger(document.data.restaurantWriteRevision) ||
      document.data.restaurantWriteRevision < 0 ||
      typeof document.data.isActive !== "boolean" ||
      (!nonEmptyString(document.data.name) &&
        !nonEmptyString(document.data.restaurantName))
    ) {
      addReason(context, "record_shape_unrecognized", {
        documentPath: document.path,
      });
    }
    const hasBiteSaverLink = Object.prototype.hasOwnProperty.call(
      document.data,
      "linkedBiteSaverUid",
    ) && document.data.linkedBiteSaverUid !== null;
    if (document.data.menuSourceSide === "biteSaver" &&
      document.data.linkedBiteSaverUid !== context.inventory.ownerUid) {
      addReason(context, "rating_claim_owner_conflict", {
        documentPath: document.path,
      });
    } else if (
      document.data.menuSourceSide !== "biteSaver" && hasBiteSaverLink
    ) {
      addReason(context, "rating_claim_owner_conflict", {
        documentPath: document.path,
      });
    } else if (
      Object.prototype.hasOwnProperty.call(document.data, "menuSourceSide") &&
      document.data.menuSourceSide !== "biteSaver" &&
      document.data.menuSourceSide !== "biteScore"
    ) {
      addReason(context, "record_shape_unrecognized", {
        documentPath: document.path,
      });
    }
    claimedIds.add(document.id);
    inspectFirestoreGeneration({
      context,
      document,
      scope: "rating_claim",
      reasonScope: "rating",
    });
  }
  return claimedIds;
}

function inspectRootRatingLink(
  context: PlanningContext,
  claimedIds: ReadonlySet<string>,
): void {
  const root = context.inventory.accountRoot;
  if (root === null || !isPlainRecord(root.data)) {
    return;
  }
  const hasRatingLink = Object.prototype.hasOwnProperty.call(
    root.data,
    "linkedBiteScoreRestaurantId",
  ) && root.data.linkedBiteScoreRestaurantId !== null;
  if (root.data.menuSourceSide === "biteScore") {
    if (
      !validDocumentId(root.data.linkedBiteScoreRestaurantId) ||
      !claimedIds.has(root.data.linkedBiteScoreRestaurantId)
    ) {
      addReason(context, "rating_claim_owner_conflict", {
        documentPath: safeReasonDocumentPath(
          context.inventory.ownerUid,
          root.path,
        ),
      });
    } else {
      if (
        context.inventory.ratingClaims.some((document) =>
          isPlainRecord(document) &&
          document.id === root.data.linkedBiteScoreRestaurantId &&
          isPlainRecord(document.data) &&
          document.data.menuSourceSide === "biteSaver")
      ) {
        addReason(context, "rating_claim_owner_conflict", {
          documentPath: safeReasonDocumentPath(
            context.inventory.ownerUid,
            root.path,
          ),
        });
      }
    }
  } else if (hasRatingLink) {
    addReason(context, "rating_claim_owner_conflict", {
      documentPath: safeReasonDocumentPath(
        context.inventory.ownerUid,
        root.path,
      ),
    });
  } else if (
    Object.prototype.hasOwnProperty.call(root.data, "menuSourceSide") &&
    root.data.menuSourceSide !== "biteSaver"
  ) {
    addReason(context, "record_shape_unrecognized", {
      documentPath: safeReasonDocumentPath(
        context.inventory.ownerUid,
        root.path,
      ),
    });
  }
}

function positiveProviderDecimal(value: unknown): string | null {
  try {
    return requireOwnerRecordGenerationMigrationProviderDecimal(value);
  } catch {
    return null;
  }
}

function storageGeneration(value: unknown): string | null {
  try {
    return requireOwnerRecordGenerationMigrationStorageGeneration(value);
  } catch {
    return null;
  }
}

function validStorageSize(value: unknown): boolean {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <=
      BigInt(ownerRecordGenerationMigrationMaximumStorageObjectBytes);
  } catch {
    return false;
  }
}

function inspectStorage(context: PlanningContext): void {
  const seenKinds = new Set<string>();
  for (const group of sortedCanonical(context.inventory.storage)) {
    if (
      !isPlainRecord(group) ||
      !hasExactKeys(group, ["kind", "objects"]) ||
      !ownerRecordGenerationMigrationStorageKinds.some(
        (kind) => kind === group.kind,
      ) || !Array.isArray(group.objects) || seenKinds.has(group.kind as string)
    ) {
      addReason(context, "inventory_incomplete");
      continue;
    }
    const kind = group.kind as OwnerRecordGenerationMigrationStorageKind;
    seenKinds.add(kind);
    if (
      group.objects.length >
        ownerRecordGenerationMigrationMaximumPagesPerScope *
          ownerRecordGenerationMigrationStoragePageLimit
    ) {
      addReason(context, "inventory_bounds_exceeded");
      continue;
    }
    for (const object of sortedCanonical(group.objects)) {
      const name = safeReasonStorageName(
        context.inventory.ownerUid,
        kind,
        object?.name,
      );
      if (name === null) {
        addReason(context, "storage_prefix_conflict");
        continue;
      }
      if (context.storageObjectNames.has(name)) {
        addReason(context, "duplicate_storage_object_name", {
          storageObjectName: name,
        });
      } else {
        context.storageObjectNames.add(name);
      }
      if (!isPlainRecord(object) || !hasOnlyStringKeys(object)) {
        addReason(context, "record_shape_unrecognized", {
          storageObjectName: name,
        });
        continue;
      }
      const objectKeys = Object.keys(object).sort();
      const expectedKeys = [
        "contentType",
        "metageneration",
        "name",
        "ownerRecordGeneration",
        "providerGeneration",
        "size",
      ].sort();
      if (
        objectKeys.length !== expectedKeys.length ||
        !objectKeys.every((key, index) => key === expectedKeys[index]) ||
        !validStorageSize(object.size) ||
        (object.contentType !== "image/jpeg" &&
          object.contentType !== "image/png" &&
          object.contentType !== "image/webp")
      ) {
        addReason(context, "record_shape_unrecognized", {
          storageObjectName: name,
        });
      }
      const providerGeneration = positiveProviderDecimal(
        object.providerGeneration,
      );
      const metageneration = positiveProviderDecimal(object.metageneration);
      if (providerGeneration === null) {
        addReason(context, "storage_provider_generation_missing", {
          storageObjectName: name,
        });
      }
      if (metageneration === null) {
        addReason(context, "storage_metageneration_missing", {
          storageObjectName: name,
        });
      }
      if (object.ownerRecordGeneration === null) {
        if (context.ownerExists) {
          addReason(
            context,
            "record_generation_missing_after_initialization",
            {storageObjectName: name},
          );
        } else if (providerGeneration !== null && metageneration !== null) {
          context.operations.push(Object.freeze({
            operation: "stamp_storage_object_metadata",
            storageKind: kind,
            objectName: name,
            ownerRecordGeneration: String(context.generation),
            existingGeneration: null,
            providerGeneration,
            metageneration,
          }));
        }
        continue;
      }
      const exactGeneration = storageGeneration(
        object.ownerRecordGeneration,
      );
      if (exactGeneration === null) {
        addReason(context, "storage_generation_malformed", {
          storageObjectName: name,
        });
        continue;
      }
      const numericGeneration = Number(exactGeneration);
      context.observedGenerations.add(numericGeneration);
      const expectedGeneration = context.activeRemovalSourceGeneration ??
        context.generation;
      if (numericGeneration !== expectedGeneration) {
        addReason(context, generationReasonCode(
          "storage",
          numericGeneration,
          expectedGeneration,
        ), {
          storageObjectName: name,
          existingGeneration: exactGeneration,
        });
      }
    }
  }
  if (seenKinds.size !== ownerRecordGenerationMigrationStorageKinds.length) {
    addReason(context, "inventory_incomplete");
  }
}

function inspectPrivateState(
  context: PlanningContext,
  nowEpochMs: number,
): void {
  const ownerUid = context.inventory.ownerUid;
  const expectedGeneration = context.activeRemovalSourceGeneration ??
    context.generation;
  const billing = context.inventory.billingState;
  if (billing !== null) {
    const expectedPath = `private_owner_billing_states/${ownerUid}`;
    if (!validFirestoreDocument(billing, expectedPath)) {
      addReason(context, "billing_state_malformed", {
        documentPath: safeReasonDocumentPath(ownerUid, possiblePath(billing)),
      });
    } else {
      const rawGeneration = safeGeneration(
        billing.data.ownerRecordGeneration,
      );
      if (rawGeneration === null) {
        addReason(context, "billing_state_malformed", {
          documentPath: expectedPath,
        });
      } else if (rawGeneration !== expectedGeneration) {
        addReason(context, "billing_generation_conflict", {
          documentPath: expectedPath,
          existingGeneration: rawGeneration,
        });
      } else {
        try {
          parseOwnerBillingStateDocument({
            id: ownerUid,
            data: billing.data,
          });
        } catch {
          addReason(context, "billing_state_malformed", {
            documentPath: expectedPath,
          });
        }
      }
    }
  }

  const returns = context.inventory.subscriptionReturnState;
  if (returns !== null) {
    const expectedPath = `private_subscription_return_state/${ownerUid}`;
    if (!validFirestoreDocument(returns, expectedPath)) {
      addReason(context, "subscription_return_state_malformed", {
        documentPath: safeReasonDocumentPath(ownerUid, possiblePath(returns)),
      });
    } else {
      const rawGeneration = safeGeneration(
        returns.data.ownerRecordGeneration,
      );
      if (rawGeneration === null) {
        addReason(context, "subscription_return_state_malformed", {
          documentPath: expectedPath,
        });
      } else if (rawGeneration !== expectedGeneration) {
        addReason(context, "subscription_return_generation_conflict", {
          documentPath: expectedPath,
          existingGeneration: rawGeneration,
        });
      } else {
        try {
          listSubscriptionReturnEvents({
            rawState: returns.data,
            ownerUid,
            restaurantAccountDocumentId: ownerUid,
            ownerRecordGeneration: expectedGeneration,
            nowEpochMs,
          });
        } catch {
          addReason(context, "subscription_return_state_malformed", {
            documentPath: expectedPath,
          });
        }
      }
    }
  }
}

type ParsedRemovalJob = NonNullable<ReturnType<
  typeof parseOwnerRecordRemovalJobDocument
>>;

function inspectRemovalJobs(context: PlanningContext): Readonly<{
  exactActive: ParsedRemovalJob | null;
}> {
  let exactActive: ParsedRemovalJob | null = null;
  if (
    context.inventory.removalJobs.length >
      ownerRecordGenerationMigrationMaximumPagesPerScope *
        ownerRecordGenerationMigrationFirestorePageLimit
  ) {
    addReason(context, "inventory_bounds_exceeded");
    return Object.freeze({exactActive});
  }
  for (const document of sortedCanonical(context.inventory.removalJobs)) {
    const path = safeReasonDocumentPath(
      context.inventory.ownerUid,
          isPlainRecord(document) ? document.path : null,
    );
    if (
      !validDocumentId(document?.id) ||
      !validFirestoreDocument(
        document,
        `private_owner_record_removal_jobs/${document.id}`,
      )
    ) {
      addReason(context, "removal_job_malformed", {documentPath: path});
      continue;
    }
    if (context.documentPaths.has(document.path)) {
      addReason(context, "duplicate_document_path", {
        documentPath: document.path,
      });
    } else {
      context.documentPaths.add(document.path);
    }
    let job: ParsedRemovalJob;
    try {
      const parsed = parseOwnerRecordRemovalJobDocument({
        id: document.id,
        data: document.data,
      });
      if (parsed === null || parsed.targetUid !== context.inventory.ownerUid) {
        throw new Error("invalid-state");
      }
      job = parsed;
    } catch {
      addReason(context, "removal_job_malformed", {
        documentPath: document.path,
      });
      continue;
    }
    if (job.status === "active") {
      if (exactActive !== null) {
        addReason(context, "active_removal_job", {
          documentPath: document.path,
          existingGeneration: job.completionGeneration,
        });
      } else {
        exactActive = job;
      }
    } else if (job.status === "retryable") {
      addReason(context, "retryable_removal_job", {
        documentPath: document.path,
        existingGeneration: job.completionGeneration,
      });
    } else if (job.status === "manual_review_required") {
      addReason(context, "manual_review_removal_job", {
        documentPath: document.path,
        existingGeneration: job.completionGeneration,
      });
    } else {
      addReason(context, "historical_removal_job", {
        documentPath: document.path,
        existingGeneration: job.completionGeneration,
      });
      addReason(context, "prior_generation_lifecycle_evidence", {
        documentPath: document.path,
        existingGeneration: job.completionGeneration,
      });
    }
  }
  return Object.freeze({exactActive});
}

function validateOwnerState(raw: OwnerRecordGenerationMigrationInventory):
  Readonly<{
    exists: boolean;
    generation: number;
    state: "open" | "removing" | "removed" | "malformed";
    activeJobId: string | null;
  }> {
  if (raw.ownerState === null) {
    return Object.freeze({
      exists: false,
      generation: canonicalInitialOwnerRecordGeneration,
      state: "open",
      activeJobId: null,
    });
  }
  const expectedPath = canonicalOwnerRecordGenerationMigrationOwnerStatePath(
    raw.ownerUid,
  );
  if (!validFirestoreDocument(raw.ownerState, expectedPath)) {
    return Object.freeze({
      exists: true,
      generation: canonicalInitialOwnerRecordGeneration,
      state: "malformed",
      activeJobId: null,
    });
  }
  try {
    const parsed = parseOwnerRecordStateDocument({
      id: raw.ownerUid,
      data: raw.ownerState.data,
    });
    if (parsed === null) {
      throw new Error("invalid-state");
    }
    return Object.freeze({
      exists: true,
      generation: parsed.generation,
      state: parsed.state,
      activeJobId: parsed.activeJobId,
    });
  } catch {
    const rawGeneration = safeGeneration(raw.ownerState.data.generation);
    return Object.freeze({
      exists: true,
      generation: rawGeneration ?? canonicalInitialOwnerRecordGeneration,
      state: "malformed",
      activeJobId: null,
    });
  }
}

function normalizePagination(
  raw: OwnerRecordGenerationMigrationInventory,
  context: PlanningContext,
): readonly OwnerRecordGenerationMigrationPaginationState[] {
  const result = new Map<
    OwnerRecordGenerationMigrationPaginationScope,
    OwnerRecordGenerationMigrationPaginationState
  >();
  if (!Array.isArray(raw.pagination)) {
    addReason(context, "inventory_incomplete");
  } else {
    for (const value of sortedCanonical(raw.pagination)) {
      if (
        !isPlainRecord(value) ||
        !hasExactKeys(value, [
          "scope",
          "complete",
          "nextCursor",
          "pagesRead",
          "recordsRead",
        ])
      ) {
        addReason(context, "inventory_incomplete");
        continue;
      }
      const scope = typeof value.scope === "string" &&
          ownerRecordGenerationMigrationPaginationScopes.some(
            (candidate) => candidate === value.scope,
          )
        ? value.scope as OwnerRecordGenerationMigrationPaginationScope
        : null;
      const valid = scope !== null && typeof value.complete === "boolean" &&
        typeof value.pagesRead === "number" &&
        Number.isSafeInteger(value.pagesRead) && value.pagesRead >= 1 &&
        typeof value.recordsRead === "number" &&
        Number.isSafeInteger(value.recordsRead) && value.recordsRead >= 0 &&
        ((value.complete === true && value.nextCursor === null) ||
          (value.complete === false &&
            validPaginationCursorText(value.nextCursor))) &&
        !result.has(scope as OwnerRecordGenerationMigrationPaginationScope);
      if (!valid || scope === null) {
        addReason(context, "inventory_incomplete");
        continue;
      }
      result.set(scope, Object.freeze({
        scope,
        complete: value.complete as boolean,
        nextCursor: value.nextCursor as string | null,
        pagesRead: value.pagesRead as number,
        recordsRead: value.recordsRead as number,
      }));
      if (!value.complete) {
        addReason(context, "inventory_incomplete");
      }
      const perPageLimit = scope.startsWith("storage_")
        ? ownerRecordGenerationMigrationStoragePageLimit
        : ownerRecordGenerationMigrationFirestorePageLimit;
      const minimumRecords = scope.startsWith("storage_")
        ? (value.pagesRead as number) - 1
        : ((value.pagesRead as number) - 1) * perPageLimit;
      const exceedsBounds =
        (value.pagesRead as number) >
          ownerRecordGenerationMigrationMaximumPagesPerScope ||
        (value.recordsRead as number) < minimumRecords ||
        (value.recordsRead as number) >
          (value.pagesRead as number) * perPageLimit ||
        (!scope.startsWith("storage_") && value.complete === true &&
          (value.recordsRead as number) ===
            (value.pagesRead as number) * perPageLimit);
      if (exceedsBounds) {
        addReason(context, "inventory_bounds_exceeded");
        addReason(context, "inventory_incomplete");
        result.set(scope, paginationState({
          scope,
          complete: false,
          nextCursor: "inventory-boundary-error",
          pagesRead: 1,
          recordsRead: 0,
        }));
      }
    }
  }
  for (const scope of ownerRecordGenerationMigrationPaginationScopes) {
    if (!result.has(scope)) {
      addReason(context, "inventory_incomplete");
      result.set(scope, paginationState({
        scope,
        complete: false,
        nextCursor: "inventory-boundary-error",
        pagesRead: 1,
        recordsRead: 0,
      }));
    }
  }
  return Object.freeze([...result.values()]);
}

function addInventoryIssues(context: PlanningContext): void {
  if (!Array.isArray(context.inventory.inventoryIssues)) {
    addReason(context, "inventory_incomplete");
    return;
  }
  for (const raw of sortedCanonical(context.inventory.inventoryIssues)) {
    if (
      !isPlainRecord(raw) || typeof raw.code !== "string" ||
      !hasExactKeys(raw, [
        "code",
        "documentPath",
        "storageObjectName",
        "existingGeneration",
      ]) ||
      !ownerRecordGenerationMigrationReasonCodes.some(
        (code) => code === raw.code,
      )
    ) {
      addReason(context, "inventory_incomplete");
      continue;
    }
    const documentPath = raw.documentPath === null
      ? null
      : safeReasonDocumentPath(
        context.inventory.ownerUid,
        raw.documentPath,
      );
    let storageObjectName: string | null = null;
    if (raw.storageObjectName !== null) {
      for (const kind of ownerRecordGenerationMigrationStorageKinds) {
        storageObjectName ??= safeReasonStorageName(
          context.inventory.ownerUid,
          kind,
          raw.storageObjectName,
        );
      }
    }
    const existingGeneration = typeof raw.existingGeneration === "number"
      ? safeGeneration(raw.existingGeneration)
      : typeof raw.existingGeneration === "string"
        ? storageGeneration(raw.existingGeneration)
        : null;
    const invalidDocumentPath = raw.documentPath !== null &&
      documentPath === null;
    const invalidStorageName = raw.storageObjectName !== null &&
      storageObjectName === null;
    const invalidGeneration = raw.existingGeneration !== null &&
      existingGeneration === null;
    if (
      invalidDocumentPath || invalidStorageName || invalidGeneration ||
      (documentPath !== null && storageObjectName !== null)
    ) {
      addReason(context, "inventory_incomplete");
      continue;
    }
    addReason(
      context,
      raw.code as OwnerRecordGenerationMigrationReasonCode,
      {documentPath, storageObjectName, existingGeneration},
    );
  }
}

function allFirestoreDocuments(
  inventory: OwnerRecordGenerationMigrationInventory,
): readonly OwnerRecordGenerationMigrationFirestoreDocument[] {
  const direct = [
    inventory.accountRoot,
    inventory.ownerState,
    inventory.billingState,
    inventory.subscriptionReturnState,
  ].filter((value): value is OwnerRecordGenerationMigrationFirestoreDocument =>
    value !== null);
  const children = inventory.children.flatMap((group) =>
    Array.isArray(group?.documents) ? group.documents : []);
  return Object.freeze([
    ...direct,
    ...inventory.removalJobs,
    ...children,
    ...inventory.ratingClaims,
  ]);
}

function inspectFirestoreSnapshotBoundary(context: PlanningContext): void {
  const documents = sortedCanonical(allFirestoreDocuments(context.inventory));
  const validReadTimes = documents
    .map((document) => document?.readTime)
    .filter(validTimestamp)
    .map((value) => canonicalJson(value));
  const distinctReadTimes = new Set(validReadTimes);
  for (const document of documents) {
    const path = safeReasonDocumentPath(
      context.inventory.ownerUid,
      document?.path,
    );
    if (!validTimestamp(document?.readTime)) {
      addReason(context, "unsafe_timestamp", {documentPath: path});
      continue;
    }
    if (
      !validTimestamp(document?.updateTime) ||
      timestampOrder(document.updateTime, document.readTime) > 0
    ) {
      addReason(context, "unsafe_timestamp", {documentPath: path});
    }
    if (distinctReadTimes.size > 1) {
      addReason(context, "unsafe_timestamp", {documentPath: path});
    }
  }
}

function expectedRecordCounts(
  inventory: OwnerRecordGenerationMigrationInventory,
): ReadonlyMap<OwnerRecordGenerationMigrationPaginationScope, number> {
  const counts = new Map<OwnerRecordGenerationMigrationPaginationScope, number>();
  counts.set("removal_jobs", inventory.removalJobs.length);
  for (const collection of ownerRecordGenerationMigrationAccountChildCollections) {
    const matching = inventory.children.filter((group) =>
      group?.collection === collection);
    counts.set(collection, matching.length === 1 &&
        Array.isArray(matching[0].documents)
      ? matching[0].documents.length
      : -1);
  }
  counts.set("rating_claims", inventory.ratingClaims.length);
  for (const kind of ownerRecordGenerationMigrationStorageKinds) {
    const matching = inventory.storage.filter((group) => group?.kind === kind);
    counts.set(
      `storage_${kind}` as OwnerRecordGenerationMigrationPaginationScope,
      matching.length === 1 && Array.isArray(matching[0].objects)
        ? matching[0].objects.length
        : -1,
    );
  }
  return counts;
}

function deduplicateReasons(
  reasons: readonly OwnerRecordGenerationMigrationManualReviewReason[],
): readonly OwnerRecordGenerationMigrationManualReviewReason[] {
  const unique = new Map<string, OwnerRecordGenerationMigrationManualReviewReason>();
  for (const reason of reasons) {
    unique.set(canonicalJson(reason), reason);
  }
  return Object.freeze([...unique.values()]);
}

function assertInventoryEnvelope(
  raw: unknown,
): OwnerRecordGenerationMigrationInventory {
  if (
    !isPlainRecord(raw) ||
    !hasExactKeys(raw, inventoryEnvelopeKeys) ||
    raw.schemaVersion !== ownerRecordGenerationMigrationInventoryVersion ||
    !Array.isArray(raw.removalJobs) || !Array.isArray(raw.children) ||
    !Array.isArray(raw.ratingClaims) || !Array.isArray(raw.storage) ||
    !Array.isArray(raw.pagination) || !Array.isArray(raw.inventoryIssues)
  ) {
    throw new TypeError("Owner-generation migration inventory is invalid.");
  }
  requireOwnerRecordGenerationMigrationProjectId(raw.projectId);
  requireOwnerRecordUid(raw.ownerUid);
  requireOwnerRecordGenerationMigrationTimestamp(raw.generatedAt);
  return raw as OwnerRecordGenerationMigrationInventory;
}

function hasAnyChild(inventory: OwnerRecordGenerationMigrationInventory): boolean {
  return inventory.children.some((group) =>
    Array.isArray(group?.documents) && group.documents.length > 0);
}

function hasAnyStorage(
  inventory: OwnerRecordGenerationMigrationInventory,
): boolean {
  return inventory.storage.some((group) =>
    Array.isArray(group?.objects) && group.objects.length > 0);
}

/**
 * Pure, fail-closed planner. It emits descriptions and preconditions only and
 * has no access to Firestore or Storage write surfaces.
 */
export function planOwnerRecordGenerationMigration(
  rawInventory: unknown,
): OwnerRecordGenerationMigrationPlan {
  const inventory = assertInventoryEnvelope(rawInventory);
  const owner = validateOwnerState(inventory);
  const context: PlanningContext = {
    inventory,
    generation: owner.generation,
    ownerExists: owner.exists,
    activeRemovalSourceGeneration: null,
    operations: [],
    reasons: [],
    observedGenerations: new Set<number>(),
    documentPaths: new Set<string>(),
    storageObjectNames: new Set<string>(),
  };
  const pagination = normalizePagination(inventory, context);
  const expectedCounts = expectedRecordCounts(inventory);
  for (const entry of pagination) {
    if (entry.recordsRead !== expectedCounts.get(entry.scope)) {
      addReason(context, "inventory_incomplete");
    }
  }
  addInventoryIssues(context);
  inspectFirestoreSnapshotBoundary(context);

  if (owner.state === "malformed") {
    addReason(context, "owner_state_malformed", {
      documentPath: canonicalOwnerRecordGenerationMigrationOwnerStatePath(
        inventory.ownerUid,
      ),
    });
  }
  const removal = inspectRemovalJobs(context);
  const exactBlockingLifecycle = owner.state === "removing" &&
    removal.exactActive !== null &&
    owner.activeJobId === removal.exactActive.jobId &&
    removal.exactActive.completionGeneration === owner.generation;
  if (exactBlockingLifecycle && removal.exactActive !== null) {
    context.activeRemovalSourceGeneration =
      removal.exactActive.sourceGeneration;
  }
  if (
    owner.exists && owner.state !== "open" && owner.state !== "malformed" &&
    !exactBlockingLifecycle
  ) {
    addReason(context, "owner_state_not_open", {
      documentPath: canonicalOwnerRecordGenerationMigrationOwnerStatePath(
        inventory.ownerUid,
      ),
      existingGeneration: owner.generation,
    });
  }
  if (removal.exactActive !== null && !exactBlockingLifecycle) {
    addReason(context, "active_removal_job", {
      documentPath: `private_owner_record_removal_jobs/` +
        removal.exactActive.jobId,
      existingGeneration: removal.exactActive.completionGeneration,
    });
  }

  inspectRoot(context);
  inspectChildren(context);
  const claimedIds = inspectRatings(context);
  inspectRootRatingLink(context, claimedIds);
  inspectStorage(context);
  inspectPrivateState(context, new Date(inventory.generatedAt).getTime());

  if (context.observedGenerations.size > 1) {
    addReason(context, "mixed_record_generations");
  }

  const hasChildren = hasAnyChild(inventory);
  const hasRatings = inventory.ratingClaims.length > 0;
  const hasStorage = hasAnyStorage(inventory);
  if (inventory.accountRoot === null) {
    if (owner.exists && !exactBlockingLifecycle) {
      addReason(context, "account_root_missing_with_owner_state", {
        documentPath: canonicalOwnerRecordGenerationMigrationOwnerStatePath(
          inventory.ownerUid,
        ),
        existingGeneration: owner.generation,
      });
    }
    if (hasChildren) {
      addReason(context, "account_root_missing_with_child");
    }
    if (hasRatings) {
      addReason(context, "account_root_missing_with_rating_claim");
    }
    if (hasStorage) {
      addReason(context, "account_root_missing_with_storage");
    }
    if (
      !exactBlockingLifecycle && (
        inventory.billingState !== null ||
        inventory.subscriptionReturnState !== null ||
        inventory.removalJobs.length > 0
      )
    ) {
      addReason(context, "orphan_owner_local_record");
    }
  }

  let reasons = deduplicateReasons(context.reasons);
  if (exactBlockingLifecycle && removal.exactActive !== null) {
    const activeReason = issue("active_removal_job", {
      documentPath: `private_owner_record_removal_jobs/` +
        removal.exactActive.jobId,
      existingGeneration: removal.exactActive.completionGeneration,
    });
    if (reasons.length === 0) {
      return buildOwnerRecordGenerationMigrationPlan({
        schemaVersion: ownerRecordGenerationMigrationPlanVersion,
        projectId: inventory.projectId,
        generatedAt: inventory.generatedAt,
        plannerVersion: ownerRecordGenerationMigrationPlannerVersion,
        sourceCheckpointCommit:
          ownerRecordGenerationMigrationSourceCheckpointCommit,
        ownerUid: inventory.ownerUid,
        canonicalAccountPath:
          canonicalOwnerRecordGenerationMigrationAccountPath(inventory.ownerUid),
        classification: "blocked_active_removal",
        proposedGeneration: null,
        operations: Object.freeze([]),
        manualReviewReasons: Object.freeze([activeReason]),
        pagination,
      });
    }
    reasons = deduplicateReasons([...reasons, activeReason]);
  }
  const hasAnyOwnerData = inventory.accountRoot !== null || owner.exists ||
    inventory.billingState !== null ||
    inventory.subscriptionReturnState !== null ||
    inventory.removalJobs.length > 0 || hasChildren || hasRatings || hasStorage;
  if (reasons.length > 0) {
    return buildOwnerRecordGenerationMigrationPlan({
      schemaVersion: ownerRecordGenerationMigrationPlanVersion,
      projectId: inventory.projectId,
      generatedAt: inventory.generatedAt,
      plannerVersion: ownerRecordGenerationMigrationPlannerVersion,
      sourceCheckpointCommit:
        ownerRecordGenerationMigrationSourceCheckpointCommit,
      ownerUid: inventory.ownerUid,
      canonicalAccountPath:
        canonicalOwnerRecordGenerationMigrationAccountPath(inventory.ownerUid),
      classification: "manual_review_required",
      proposedGeneration: null,
      operations: Object.freeze([]),
      manualReviewReasons: reasons,
      pagination,
    });
  }
  if (!hasAnyOwnerData) {
    return buildOwnerRecordGenerationMigrationPlan({
      schemaVersion: ownerRecordGenerationMigrationPlanVersion,
      projectId: inventory.projectId,
      generatedAt: inventory.generatedAt,
      plannerVersion: ownerRecordGenerationMigrationPlannerVersion,
      sourceCheckpointCommit:
        ownerRecordGenerationMigrationSourceCheckpointCommit,
      ownerUid: inventory.ownerUid,
      canonicalAccountPath:
        canonicalOwnerRecordGenerationMigrationAccountPath(inventory.ownerUid),
      classification: "no_owner_data",
      proposedGeneration: null,
      operations: Object.freeze([]),
      manualReviewReasons: Object.freeze([]),
      pagination,
    });
  }
  if (owner.exists) {
    return buildOwnerRecordGenerationMigrationPlan({
      schemaVersion: ownerRecordGenerationMigrationPlanVersion,
      projectId: inventory.projectId,
      generatedAt: inventory.generatedAt,
      plannerVersion: ownerRecordGenerationMigrationPlannerVersion,
      sourceCheckpointCommit:
        ownerRecordGenerationMigrationSourceCheckpointCommit,
      ownerUid: inventory.ownerUid,
      canonicalAccountPath:
        canonicalOwnerRecordGenerationMigrationAccountPath(inventory.ownerUid),
      classification: "already_initialized",
      proposedGeneration: owner.generation,
      operations: Object.freeze([]),
      manualReviewReasons: Object.freeze([]),
      pagination,
    });
  }
  context.operations.push(Object.freeze({
    operation: "create_owner_state",
    documentPath: canonicalOwnerRecordGenerationMigrationOwnerStatePath(
      inventory.ownerUid,
    ),
    ownerRecordGeneration: canonicalInitialOwnerRecordGeneration,
    existingGeneration: null,
    precondition: Object.freeze({kind: "must_not_exist"}),
  }));
  return buildOwnerRecordGenerationMigrationPlan({
    schemaVersion: ownerRecordGenerationMigrationPlanVersion,
    projectId: inventory.projectId,
    generatedAt: inventory.generatedAt,
    plannerVersion: ownerRecordGenerationMigrationPlannerVersion,
    sourceCheckpointCommit: ownerRecordGenerationMigrationSourceCheckpointCommit,
    ownerUid: inventory.ownerUid,
    canonicalAccountPath:
      canonicalOwnerRecordGenerationMigrationAccountPath(inventory.ownerUid),
    classification: "legacy_safe_candidate",
    proposedGeneration: canonicalInitialOwnerRecordGeneration,
    operations: Object.freeze(context.operations),
    manualReviewReasons: Object.freeze([]),
    pagination,
  });
}

/** Aggregate-only wrapper; the returned value contains no UID or path. */
export function summarizeOwnerRecordGenerationMigrationPlan(
  plan: unknown,
) {
  return buildOwnerRecordGenerationMigrationRedactedSummary([plan]);
}
