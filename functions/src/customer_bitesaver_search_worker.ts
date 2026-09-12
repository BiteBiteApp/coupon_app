import { createHash, randomBytes } from "node:crypto";
import {
  createCustomerBiteSaverMembershipFingerprint,
  customerBiteSaverCatalogGenerationShardCount,
  customerBiteSaverExactLocationPreference,
  customerBiteSaverGenerationShardId,
  customerBiteSaverMaximumIndexedOrderKeyBytes,
  customerBiteSaverMaximumCatalogRestarts,
  customerBiteSaverOfferProjectionVersion,
  customerBiteSaverRangeFetchLimit,
  customerBiteSaverRangesPerWorker,
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverWorkerLeaseMilliseconds,
  customerBiteSaverWorkerSourceLimit,
  privateCustomerBiteSaverCandidateCollection,
  privateCustomerBiteSaverCatalogGenerationCollection,
  privateCustomerBiteSaverJobCollection,
  privateCustomerBiteSaverResultCollection,
  privateCustomerBiteSaverSearchSessionCollection,
  type CustomerBiteSaverPreparationPhase,
} from "./customer_bitesaver_search_contract.js";
import {
  customerBiteSaverMatchValuesContain,
  customerBiteSaverSearchMatchValues,
  compareCustomerBiteSaverFirestoreUtf8,
  dartUtf16FirestoreBytesOrderKey,
  dartUtf16OrderKey,
  decodeDartUtf16FirestoreBytesOrderKey,
  hasWellFormedCustomerBiteSaverUtf16,
  lowercaseDisplayNameOrderKey,
  parseDartUtf16FirestoreBytesOrderKey,
} from "./customer_bitesaver_search_matcher.js";
import {
  customerBiteSaverOfferSourceCreatedAtOrderKeyField,
  isCustomerBiteSaverTimestampOrderKey,
} from "./search_index_builders.js";
import {
  customerBiteSaverDeterministicId,
  customerBiteSaverOpaqueRestaurantId,
} from "./customer_bitesaver_search_cursor.js";
import {
  evaluateCustomerBiteSaverOfferAvailability,
  type CustomerBiteSaverOfferType,
} from "./customer_bitesaver_offer_availability.js";
import {
  exactCustomerBiteSaverDistanceMiles,
  validRestaurantCoordinates,
} from "./restaurant_geo_helpers.js";
import {
  buildCustomerBiteSaverJobDocument,
  customerBiteSaverCandidatePrefix,
  customerBiteSaverJobId,
  customerBiteSaverResultDocumentId,
  customerBiteSaverSessionInternals,
  type CustomerBiteSaverGeohashRangeState,
  type CustomerBiteSaverSearchJobDocument,
  type CustomerBiteSaverSessionDocument,
} from "./customer_bitesaver_search_session.js";
import type {
  CustomerBiteSaverSearchDatabase,
  CustomerBiteSaverStoredDocument,
} from "./customer_bitesaver_search_store.js";
import { readCustomerBiteSaverCatalogGeneration } from
  "./search_index_contract.js";

export const customerBiteSaverMaximumRawFallbackBytesPerWorker = 2 * 1024 * 1024;
export const customerBiteSaverMaximumRawFallbackDocumentsPerWorker = 1;
export const customerBiteSaverMaximumCandidateDocumentBytes = 64 * 1024;
export const customerBiteSaverMaximumResultDocumentBytes = 96 * 1024;
export {customerBiteSaverMaximumIndexedOrderKeyBytes} from
  "./customer_bitesaver_search_contract.js";
// Restaurant-card resolution consumes no more than three ordered seeds: two
// previews and, when present, one has-more/count witness. Additional-offer
// pages read the complete underlying offer index and do not consume this
// auxiliary summary.
export const customerBiteSaverWorkerPreviewSummaryLimit = 3 as const;

export type CustomerBiteSaverWorkerCounters = {
  sourceDocumentsProcessed: number;
  rangesAdvanced: number;
  candidateIdentitiesRetained: number;
  firestoreOperationsInFlightMaximum: number;
  writesCommittedMaximum: number;
  rawFallbackBytes: number;
};

export type CustomerBiteSaverWorkerContext = Readonly<{
  database: CustomerBiteSaverSearchDatabase;
  secretKey: Uint8Array;
  now?: () => number;
  randomSource?: (size: number) => Uint8Array;
  counters?: CustomerBiteSaverWorkerCounters;
}>;

type ParsedJob = Readonly<{
  id: string;
  data: CustomerBiteSaverSearchJobDocument;
}>;

type Lease = Readonly<{
  leaseId: string;
  job: ParsedJob;
  session: CustomerBiteSaverSessionDocument;
}>;

type PreviewCandidate = Readonly<{
  offerType: CustomerBiteSaverOfferType;
  sourceDocumentId: string;
  indexDocumentId: string;
  sourceCreatedAtMs: number;
  sourceCreatedAtOrderKey: string;
  sourceFingerprint: string;
}>;

type CandidateDocument = Readonly<Record<string, unknown>> & {
  authoritativeAccountId: string;
  authoritativeAccountIdOrderKey: Buffer;
  candidateDocumentId: string;
  customerParentEligibilityFingerprint: string;
  parentMatches: boolean;
  offerMatches: boolean;
  usableOfferCount: number;
  previewDailyCandidates: readonly PreviewCandidate[];
  previewCouponCandidates: readonly PreviewCandidate[];
  offerCatalogFingerprint: string;
};

class CustomerBiteSaverTerminalPreparationError extends Error {
  readonly failureCode: "invalid_private_state" | "preparation_failed";

  constructor(
    failureCode: CustomerBiteSaverTerminalPreparationError["failureCode"],
    message: string,
  ) {
    super(message);
    this.name = "CustomerBiteSaverTerminalPreparationError";
    this.failureCode = failureCode;
  }
}

class CustomerBiteSaverWorkerLeaseBusyError extends Error {
  constructor() {
    super("The BiteSaver preparation lease is still active.");
    this.name = "CustomerBiteSaverWorkerLeaseBusyError";
  }
}

function path(collection: string, id: string): string {
  return `${collection}/${id}`;
}

function nowDate(context: CustomerBiteSaverWorkerContext): Date {
  const millis = context.now?.() ?? Date.now();
  if (!Number.isSafeInteger(millis) || millis < 0) {
    throw new Error("Worker clock is invalid.");
  }
  return new Date(millis);
}

function dateValue(value: unknown): Date | null {
  return customerBiteSaverSessionInternals.dateValue(value);
}

function exactId(value: unknown): string | null {
  return typeof value === "string" &&
      value.length > 0 &&
      hasWellFormedCustomerBiteSaverUtf16(value) &&
      Buffer.byteLength(value, "utf8") <= 1_500 &&
      !value.includes("/")
    ? value
    : null;
}

function exactOfferParentId(value: unknown): string | null {
  const decoded = decodeDartUtf16FirestoreBytesOrderKey(
    value,
    customerBiteSaverMaximumIndexedOrderKeyBytes,
  );
  return decoded !== null && exactId(decoded) === decoded ? decoded : null;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new CustomerBiteSaverTerminalPreparationError(
      "invalid_private_state",
      "Worker state is not serializable.",
    );
  }
}

function boundedUtf16OrderKey(value: string): string | null {
  try {
    const key = dartUtf16OrderKey(value);
    return Buffer.byteLength(key, "utf8") <=
        customerBiteSaverMaximumIndexedOrderKeyBytes
      ? key
      : null;
  } catch {
    return null;
  }
}

function updateMaximum(
  counters: CustomerBiteSaverWorkerCounters | undefined,
  key: "firestoreOperationsInFlightMaximum" | "writesCommittedMaximum",
  value: number,
): void {
  if (counters !== undefined) {
    counters[key] = Math.max(counters[key], value);
  }
}

function incrementCounter(
  counters: CustomerBiteSaverWorkerCounters | undefined,
  key:
    | "sourceDocumentsProcessed"
    | "rangesAdvanced"
    | "candidateIdentitiesRetained"
    | "rawFallbackBytes",
  value: number,
): void {
  if (counters !== undefined) {
    counters[key] += value;
  }
}

function parseJob(
  id: string,
  document: CustomerBiteSaverStoredDocument | null,
): ParsedJob | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  const leaseExpiresAt = data.leaseExpiresAt === null
    ? null
    : dateValue(data.leaseExpiresAt);
  const completedAt = data.completedAt === undefined
    ? null
    : dateValue(data.completedAt);
  const allowedKeys = new Set([
    "absoluteExpiresAt",
    "attemptCount",
    "attemptGeneration",
    "callerBindingHash",
    "completedAt",
    "createdAt",
    "expiresAt",
    "jobKind",
    "leaseExpiresAt",
    "leaseId",
    "logicalExpiresAt",
    "occurrenceId",
    "phase",
    "protocolVersion",
    "sessionId",
    "state",
  ]);
  if (
    document.id !== id ||
    document.path !== path(privateCustomerBiteSaverJobCollection, id) ||
    Object.keys(data).some((key) => !allowedKeys.has(key)) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.jobKind !== "customerBiteSaverPreparation" ||
    data.sessionId === undefined ||
    exactId(data.sessionId) !== data.sessionId ||
    typeof data.attemptGeneration !== "number" ||
    !Number.isSafeInteger(data.attemptGeneration) ||
    data.attemptGeneration < 0 ||
    typeof data.occurrenceId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.occurrenceId) ||
    (data.phase !== "restaurantRanges" && data.phase !== "offerRanges" &&
      data.phase !== "finalizeCandidates" &&
      data.phase !== "verifyCatalogGeneration" && data.phase !== "ready") ||
    (data.state !== "pending" && data.state !== "processing" &&
      data.state !== "completed" && data.state !== "invalid" &&
      data.state !== "expired") ||
    typeof data.callerBindingHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.callerBindingHash) ||
    createdAt === null || logicalExpiresAt === null ||
    absoluteExpiresAt === null || expiresAt === null ||
    (data.leaseExpiresAt !== null && leaseExpiresAt === null) ||
    (data.completedAt !== undefined && completedAt === null) ||
    (data.attemptCount !== undefined &&
      (typeof data.attemptCount !== "number" ||
        !Number.isSafeInteger(data.attemptCount) ||
        data.attemptCount < 1)) ||
    (data.leaseId !== null &&
      (typeof data.leaseId !== "string" ||
        !/^lease_[A-Za-z0-9_-]{22}$/u.test(data.leaseId))) ||
    logicalExpiresAt.getTime() > absoluteExpiresAt.getTime() ||
    expiresAt.getTime() !== absoluteExpiresAt.getTime() ||
    (data.state === "pending" &&
      (data.leaseId !== null || leaseExpiresAt !== null)) ||
    (data.state === "processing" &&
      (data.leaseId === null || leaseExpiresAt === null ||
        data.attemptCount === undefined)) ||
    ((data.state === "completed" || data.state === "invalid" ||
      data.state === "expired") && completedAt === null)
  ) {
    return null;
  }
  return {
    id,
    data: {
      ...(data as unknown as CustomerBiteSaverSearchJobDocument),
      createdAt,
      logicalExpiresAt,
      absoluteExpiresAt,
      expiresAt,
      leaseExpiresAt,
    },
  };
}

function randomLeaseId(
  randomSource: (size: number) => Uint8Array,
): string {
  const bytes = randomSource(16);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    throw new Error("Worker entropy source is invalid.");
  }
  return `lease_${Buffer.from(bytes).toString("base64url")}`;
}

async function claimLease(
  jobId: string,
  context: CustomerBiteSaverWorkerContext,
  now: Date,
): Promise<Lease | "busy" | null> {
  const leaseId = randomLeaseId(context.randomSource ?? randomBytes);
  return context.database.runTransaction(async (transaction) => {
    const [jobSnapshot, sessionSnapshot] = await Promise.all([
      transaction.getDocument(path(privateCustomerBiteSaverJobCollection, jobId)),
      // The session ID is unknown until the job has been read, so this first
      // read validates the job before the bounded second point read.
      Promise.resolve(null),
    ]);
    void sessionSnapshot;
    const failLinkedSession = async (
      data: Readonly<Record<string, unknown>>,
    ): Promise<void> => {
      const linkedSessionId = exactId(data.sessionId);
      const linkedAttempt = typeof data.attemptGeneration === "number" &&
          Number.isSafeInteger(data.attemptGeneration) &&
          data.attemptGeneration >= 0
        ? data.attemptGeneration
        : null;
      const linkedCaller = typeof data.callerBindingHash === "string" &&
          /^[0-9a-f]{64}$/u.test(data.callerBindingHash)
        ? data.callerBindingHash
        : null;
      if (
        linkedSessionId === null ||
        linkedAttempt === null ||
        linkedCaller === null
      ) {
        return;
      }
      const linkedSnapshot = await transaction.getDocument(path(
        privateCustomerBiteSaverSearchSessionCollection,
        linkedSessionId,
      ));
      const linkedSession = customerBiteSaverSessionInternals.parseSession(
        linkedSnapshot,
      );
      if (
        linkedSnapshot !== null &&
        linkedSession !== null &&
        linkedSession.state === "preparing" &&
        linkedSession.currentJobId === jobId &&
        linkedSession.attemptGeneration === linkedAttempt &&
        linkedSession.callerBindingHash === linkedCaller
      ) {
        transaction.setDocument(linkedSnapshot.path, {
          ...linkedSnapshot.data,
          state: "failed",
          failureCode: "invalid_private_state",
          workerLeaseId: null,
          workerLeaseExpiresAt: null,
        });
      }
    };
    const job = parseJob(jobId, jobSnapshot);
    if (job === null) {
      if (jobSnapshot !== null) {
        await failLinkedSession(jobSnapshot.data);
        transaction.setDocument(jobSnapshot.path, {
          ...jobSnapshot.data,
          state: "invalid",
          completedAt: now,
        });
      }
      return null;
    }
    if (jobSnapshot === null) {
      return null;
    }
    if (job.data.state === "invalid") {
      await failLinkedSession(jobSnapshot.data);
      return null;
    }
    if (job.data.state === "completed" || job.data.state === "expired") {
      return null;
    }
    if (
      now >= job.data.logicalExpiresAt ||
      now >= job.data.absoluteExpiresAt
    ) {
      transaction.setDocument(jobSnapshot.path, {
        ...jobSnapshot.data,
        state: "expired",
        completedAt: now,
      });
      return null;
    }
    const sessionSnapshotAfterJob = await transaction.getDocument(path(
      privateCustomerBiteSaverSearchSessionCollection,
      job.data.sessionId,
    ));
    const session = customerBiteSaverSessionInternals.parseSession(
      sessionSnapshotAfterJob,
    );
    if (
      sessionSnapshotAfterJob === null || session === null ||
      session.state !== "preparing" ||
      session.currentJobId !== jobId ||
      session.attemptGeneration !== job.data.attemptGeneration ||
      session.phase !== job.data.phase ||
      session.callerBindingHash !== job.data.callerBindingHash
    ) {
      transaction.setDocument(jobSnapshot.path, {
        ...jobSnapshot.data,
        state: "invalid",
        completedAt: now,
      });
      return null;
    }
    if (
      now >= session.logicalExpiresAt ||
      now >= session.absoluteExpiresAt
    ) {
      transaction.setDocument(jobSnapshot.path, {
        ...jobSnapshot.data,
        state: "expired",
        completedAt: now,
        leaseId: null,
        leaseExpiresAt: null,
      });
      transaction.setDocument(sessionSnapshotAfterJob.path, {
        ...sessionSnapshotAfterJob.data,
        state: "expired",
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      });
      return null;
    }
    const existingLeaseExpiry = dateValue(job.data.leaseExpiresAt);
    if (
      job.data.state === "processing" &&
      existingLeaseExpiry !== null &&
      existingLeaseExpiry > now
    ) {
      return "busy";
    }
    const leaseExpiresAt = new Date(
      now.getTime() + customerBiteSaverWorkerLeaseMilliseconds,
    );
    transaction.setDocument(jobSnapshot.path, {
      ...jobSnapshot.data,
      state: "processing",
      leaseId,
      leaseExpiresAt,
      attemptCount:
        (typeof jobSnapshot.data.attemptCount === "number" &&
          Number.isSafeInteger(jobSnapshot.data.attemptCount)
          ? jobSnapshot.data.attemptCount
          : 0) + 1,
    });
    transaction.setDocument(sessionSnapshotAfterJob.path, {
      ...sessionSnapshotAfterJob.data,
      workerLeaseId: leaseId,
      workerLeaseExpiresAt: leaseExpiresAt,
    });
    return Object.freeze({leaseId, job, session});
  });
}

async function releaseLeaseAfterTransientFailure(
  lease: Lease,
  context: CustomerBiteSaverWorkerContext,
): Promise<void> {
  await context.database.runTransaction(async (transaction) => {
    const [jobSnapshot, sessionSnapshot] = await Promise.all([
      transaction.getDocument(path(
        privateCustomerBiteSaverJobCollection,
        lease.job.id,
      )),
      transaction.getDocument(path(
        privateCustomerBiteSaverSearchSessionCollection,
        lease.session.sessionId,
      )),
    ]);
    const currentJob = parseJob(lease.job.id, jobSnapshot);
    const currentSession = customerBiteSaverSessionInternals.parseSession(
      sessionSnapshot,
    );
    if (
      jobSnapshot === null ||
      sessionSnapshot === null ||
      currentJob === null ||
      currentSession === null ||
      currentJob.data.state !== "processing" ||
      currentJob.data.leaseId !== lease.leaseId ||
      currentSession.state !== "preparing" ||
      currentSession.currentJobId !== lease.job.id ||
      currentSession.attemptGeneration !== lease.session.attemptGeneration ||
      currentSession.workerLeaseId !== lease.leaseId
    ) {
      return;
    }
    transaction.setDocument(jobSnapshot.path, {
      ...jobSnapshot.data,
      state: "pending",
      leaseId: null,
      leaseExpiresAt: null,
    });
    transaction.setDocument(sessionSnapshot.path, {
      ...sessionSnapshot.data,
      workerLeaseId: null,
      workerLeaseExpiresAt: null,
    });
  });
}

function candidateId(
  key: Uint8Array,
  session: CustomerBiteSaverSessionDocument,
  authoritativeAccountId: string,
): string {
  return customerBiteSaverCandidatePrefix(
    session.sessionId,
    session.attemptGeneration,
  ) + customerBiteSaverDeterministicId(key, "c", "candidate", [
    session.sessionId,
    session.attemptGeneration.toString(10),
    authoritativeAccountId,
  ]).slice(2);
}

function candidatePath(
  key: Uint8Array,
  session: CustomerBiteSaverSessionDocument,
  authoritativeAccountId: string,
): string {
  return path(
    privateCustomerBiteSaverCandidateCollection,
    candidateId(key, session, authoritativeAccountId),
  );
}

function rangeQuery(value: {
  phase: "restaurantRanges" | "offerRanges";
  range: CustomerBiteSaverGeohashRangeState;
}): Parameters<CustomerBiteSaverSearchDatabase["queryDocuments"]>[0] {
  const range = value.range;
  if (
    !hasWellFormedCustomerBiteSaverUtf16(range.start) ||
    !hasWellFormedCustomerBiteSaverUtf16(range.end) ||
    Buffer.byteLength(range.start, "utf8") > 1_500 ||
    Buffer.byteLength(range.end, "utf8") > 1_500 ||
    compareCustomerBiteSaverFirestoreUtf8(range.start, range.end) > 0
  ) {
    throw new CustomerBiteSaverTerminalPreparationError(
      "invalid_private_state",
      "Geographic range cursor is invalid.",
    );
  }
  const cursorIsAbsent = range.afterGeohash === null &&
    range.afterDocumentId === null;
  if (
    !cursorIsAbsent &&
    (
      typeof range.afterGeohash !== "string" ||
      range.afterGeohash.length === 0 ||
      !hasWellFormedCustomerBiteSaverUtf16(range.afterGeohash) ||
      Buffer.byteLength(range.afterGeohash, "utf8") > 1_500 ||
      exactId(range.afterDocumentId) === null ||
      compareCustomerBiteSaverFirestoreUtf8(
        range.afterGeohash,
        range.start,
      ) < 0 ||
      compareCustomerBiteSaverFirestoreUtf8(
        range.afterGeohash,
        range.end,
      ) > 0
    )
  ) {
    throw new CustomerBiteSaverTerminalPreparationError(
      "invalid_private_state",
      "Geographic range cursor is invalid.",
    );
  }
  const restaurant = value.phase === "restaurantRanges";
  return Object.freeze({
    collectionPath: restaurant
      ? "restaurant_search_index"
      : "bitesaver_offer_index",
    filters: Object.freeze([
      {field: "source", operation: "==" as const, value: "biteSaver"},
      {
        field: restaurant
          ? "publicProjectionVersion"
          : "customerOfferProjectionVersion",
        operation: "==" as const,
        value: restaurant
          ? "bitestar.bitesaver-public-restaurant.v1"
          : customerBiteSaverOfferProjectionVersion,
      },
      {
        field: restaurant ? "publicVisible" : "customerDiscoverable",
        operation: "==" as const,
        value: true,
      },
      {field: "geohash", operation: ">=" as const, value: value.range.start},
      {field: "geohash", operation: "<=" as const, value: value.range.end},
    ]),
    orders: Object.freeze([
      {field: "geohash", direction: "asc" as const},
      {
        field: restaurant ? "sourceDocumentId" : "indexDocumentId",
        direction: "asc" as const,
      },
    ]),
    ...(value.range.afterGeohash === null ||
        value.range.afterDocumentId === null
      ? {}
      : {
          startAfter: Object.freeze([
            value.range.afterGeohash,
            value.range.afterDocumentId,
          ]),
        }),
    limit: customerBiteSaverRangeFetchLimit,
  });
}

function advanceRange(
  phase: "restaurantRanges" | "offerRanges",
  range: CustomerBiteSaverGeohashRangeState,
  documents: readonly CustomerBiteSaverStoredDocument[],
): CustomerBiteSaverGeohashRangeState {
  const last = documents[documents.length - 1];
  const geohash = last?.data.geohash;
  const sourceId = last === undefined
    ? null
    : exactId(phase === "restaurantRanges"
      ? last.data.sourceDocumentId
      : last.data.indexDocumentId);
  if (
    last !== undefined &&
    (
      typeof geohash !== "string" ||
      geohash.length === 0 ||
      !hasWellFormedCustomerBiteSaverUtf16(geohash) ||
      Buffer.byteLength(geohash, "utf8") > 1_500 ||
      sourceId === null ||
      compareCustomerBiteSaverFirestoreUtf8(geohash, range.start) < 0 ||
      compareCustomerBiteSaverFirestoreUtf8(geohash, range.end) > 0
    )
  ) {
    throw new CustomerBiteSaverTerminalPreparationError(
      "invalid_private_state",
      "Geographic projection cursor is invalid.",
    );
  }
  return Object.freeze({
    ...range,
    afterGeohash: last === undefined ? range.afterGeohash : geohash as string,
    afterDocumentId: last === undefined ? range.afterDocumentId : sourceId,
    exhausted: documents.length < customerBiteSaverRangeFetchLimit,
  });
}

function selectedRanges(
  ranges: readonly CustomerBiteSaverGeohashRangeState[],
): readonly number[] {
  return Object.freeze(ranges
    .map((range, index) => ({range, index}))
    .filter(({range}) => !range.exhausted)
    .slice(0, customerBiteSaverRangesPerWorker)
    .map(({index}) => index));
}

function parentSafeSnapshot(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  const displayName = typeof data.displayName === "string"
    ? data.displayName
    : null;
  const city = typeof data.city === "string" ? data.city : "";
  const state = typeof data.state === "string" ? data.state : "";
  const zipCode = typeof data.zipCode === "string" ? data.zipCode : "";
  if (displayName === null || displayName.length === 0) {
    return null;
  }
  const optionalString = (field: string): string | null =>
    typeof data[field] === "string" ? data[field] as string : null;
  return Object.freeze({
    displayName,
    streetAddress: optionalString("streetAddress"),
    city,
    state,
    zipCode,
    formattedAddress: optionalString("formattedAddress"),
    primaryImageUrl: optionalString("primaryImageUrl"),
    phone: optionalString("phone"),
    website: optionalString("website"),
    businessHours: Array.isArray(data.businessHours)
      ? data.businessHours.slice(0, 7)
      : Object.freeze([]),
    bio: optionalString("bio"),
    biteScoreCatalogRestaurantId:
      optionalString("biteScoreCatalogRestaurantId"),
    biteSaverCatalogBindingId: optionalString("biteSaverCatalogBindingId"),
  });
}

function buildRestaurantCandidate(
  context: CustomerBiteSaverWorkerContext,
  session: CustomerBiteSaverSessionDocument,
  source: CustomerBiteSaverStoredDocument,
  now: Date,
): CandidateDocument | null {
  const data = source.data;
  const authoritativeAccountId = exactId(data.sourceDocumentId);
  const coordinates = validRestaurantCoordinates(data.latitude, data.longitude);
  const safeSnapshot = parentSafeSnapshot(data);
  if (
    authoritativeAccountId === null ||
    coordinates === null ||
    safeSnapshot === null ||
    data.publicVisible !== true ||
    data.publicProjectionVersion !==
      "bitestar.bitesaver-public-restaurant.v1" ||
    typeof data.sourceFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.sourceFingerprint) ||
    typeof data.customerParentEligibilityFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.customerParentEligibilityFingerprint)
  ) {
    return null;
  }
  const distanceMiles = exactCustomerBiteSaverDistanceMiles({
    latitude: session.criteria.latitude,
    longitude: session.criteria.longitude,
  }, coordinates);
  if (distanceMiles > session.criteria.radiusMiles) {
    return null;
  }
  const displayName = safeSnapshot.displayName as string;
  const displayNameOrderKey = boundedUtf16OrderKey(displayName.toLowerCase());
  const accountIdOrderKey = dartUtf16FirestoreBytesOrderKey(
    authoritativeAccountId,
  );
  if (displayNameOrderKey === null) {
    return null;
  }
  let exactPreference: boolean;
  let parentMatches: boolean;
  try {
    exactPreference = customerBiteSaverExactLocationPreference({
      typedLocation: session.criteria.typedLocation,
      restaurantCity: data.city,
      restaurantState: data.state,
      restaurantZipCode: data.zipCode,
    });
    parentMatches = customerBiteSaverMatchValuesContain(
      session.criteria.normalizedSearchQuery,
      customerBiteSaverSearchMatchValues([
        displayName,
        data.city,
        data.zipCode,
        data.bio,
      ]),
    );
  } catch {
    return null;
  }
  const id = candidateId(
    context.secretKey,
    session,
    authoritativeAccountId,
  );
  const document: CandidateDocument = Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    criteriaFingerprint: session.criteriaFingerprint,
    queryFingerprint: session.queryFingerprint,
    callerBindingHash: session.callerBindingHash,
    state: "candidate",
    candidateDocumentId: id,
    authoritativeAccountId,
    parentProjectionDocumentId: source.id,
    parentProjectionFingerprint: data.sourceFingerprint,
    customerParentEligibilityFingerprint:
      data.customerParentEligibilityFingerprint,
    parentOfferCatalogFingerprint:
      customerBiteSaverSessionInternals
        .projectedParentCatalogGenerationFingerprint(data),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    exactPreferenceRank: exactPreference ? 0 : 1,
    distanceMiles,
    distanceSortMiles: exactPreference ? 0 : distanceMiles,
    lowercaseDisplayNameOrderKey: displayNameOrderKey,
    authoritativeAccountIdOrderKey: accountIdOrderKey,
    parentMatches,
    offerMatches: false,
    usableOfferCount: 0,
    previewDailyCandidates: Object.freeze([]),
    previewCouponCandidates: Object.freeze([]),
    offerCatalogFingerprint: digest("empty"),
    safeRestaurantSnapshot: safeSnapshot,
    createdAt: now,
    logicalExpiresAt: session.logicalExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    expiresAt: session.absoluteExpiresAt,
  });
  if (serializedBytes(document) > customerBiteSaverMaximumCandidateDocumentBytes) {
    throw new CustomerBiteSaverTerminalPreparationError(
      "preparation_failed",
      "Candidate document size bound exceeded.",
    );
  }
  return document;
}

function nextPhaseAfterRanges(
  phase: "restaurantRanges" | "offerRanges",
  ranges: readonly CustomerBiteSaverGeohashRangeState[],
): CustomerBiteSaverPreparationPhase {
  if (ranges.some((range) => !range.exhausted)) {
    return phase;
  }
  return phase === "restaurantRanges" ? "offerRanges" : "finalizeCandidates";
}

function continuationOccurrence(
  lease: Lease,
  phase: CustomerBiteSaverPreparationPhase,
  session: CustomerBiteSaverSessionDocument,
): string {
  return digest(JSON.stringify([
    lease.job.id,
    lease.leaseId,
    phase,
    session.progress,
    session.finalizeAfterCandidateDocumentId,
  ]));
}

async function commitIteration(value: {
  context: CustomerBiteSaverWorkerContext;
  lease: Lease;
  now: Date;
  nextSession: CustomerBiteSaverSessionDocument | ((
    catalogGenerationVector: readonly number[],
  ) => CustomerBiteSaverSessionDocument);
  writes?: readonly Readonly<{
    path: string;
    data: Readonly<Record<string, unknown>>;
  }>[];
}): Promise<boolean> {
  const writes = value.writes ?? [];
  if (writes.length + 3 > 199) {
    throw new CustomerBiteSaverTerminalPreparationError(
      "preparation_failed",
      "Worker write limit exceeded.",
    );
  }
  updateMaximum(
    value.context.counters,
    "writesCommittedMaximum",
    writes.length + 3,
  );
  return value.context.database.runTransaction(async (transaction) => {
    const generationPaths = typeof value.nextSession === "function"
      ? Array.from(
          {length: customerBiteSaverCatalogGenerationShardCount},
          (_, index) => path(
            privateCustomerBiteSaverCatalogGenerationCollection,
            customerBiteSaverGenerationShardId(index),
          ),
        )
      : [];
    const [jobSnapshot, sessionSnapshot, generationDocuments] =
      await Promise.all([
      transaction.getDocument(path(
        privateCustomerBiteSaverJobCollection,
        value.lease.job.id,
      )),
      transaction.getDocument(path(
        privateCustomerBiteSaverSearchSessionCollection,
        value.lease.session.sessionId,
      )),
      transaction.getDocuments(generationPaths),
    ]);
    const currentJob = parseJob(value.lease.job.id, jobSnapshot);
    const currentSession = customerBiteSaverSessionInternals.parseSession(
      sessionSnapshot,
    );
    if (
      jobSnapshot === null || sessionSnapshot === null ||
      currentJob === null || currentSession === null ||
      currentJob.data.state !== "processing" ||
      currentJob.data.leaseId !== value.lease.leaseId ||
      currentSession.workerLeaseId !== value.lease.leaseId ||
      currentSession.currentJobId !== value.lease.job.id ||
      currentSession.attemptGeneration !==
        value.lease.session.attemptGeneration
    ) {
      return false;
    }
    for (const write of writes) {
      transaction.setDocument(write.path, write.data);
    }
    let nextSession = typeof value.nextSession === "function"
      ? value.nextSession(parseCatalogGenerationVector(generationDocuments))
      : value.nextSession;
    const terminal = nextSession.state !== "preparing";
    if (
      currentSession.lastAccessAt.getTime() >
        nextSession.lastAccessAt.getTime() ||
      currentSession.logicalExpiresAt.getTime() >
        nextSession.logicalExpiresAt.getTime()
    ) {
      nextSession = Object.freeze({
        ...nextSession,
        lastAccessAt: new Date(Math.max(
          currentSession.lastAccessAt.getTime(),
          nextSession.lastAccessAt.getTime(),
        )),
        logicalExpiresAt: new Date(Math.min(
          nextSession.absoluteExpiresAt.getTime(),
          Math.max(
            currentSession.logicalExpiresAt.getTime(),
            nextSession.logicalExpiresAt.getTime(),
          ),
        )),
      });
    }
    if (!terminal) {
      const occurrence = continuationOccurrence(
        value.lease,
        nextSession.phase,
        nextSession,
      );
      const nextJobId = customerBiteSaverJobId(
        value.context.secretKey,
        nextSession.sessionId,
        nextSession.attemptGeneration,
        nextSession.phase,
        occurrence,
      );
      nextSession = Object.freeze({...nextSession, currentJobId: nextJobId});
      transaction.createDocument(path(
        privateCustomerBiteSaverJobCollection,
        nextJobId,
      ), buildCustomerBiteSaverJobDocument({
        jobId: nextJobId,
        session: nextSession,
        now: value.now,
      }));
    }
    transaction.setDocument(jobSnapshot.path, {
      ...jobSnapshot.data,
      state: "completed",
      completedAt: value.now,
      leaseId: value.lease.leaseId,
    });
    transaction.setDocument(sessionSnapshot.path, {
      ...nextSession,
      workerLeaseId: null,
      workerLeaseExpiresAt: null,
    });
    return true;
  });
}

async function processRestaurantRanges(
  lease: Lease,
  context: CustomerBiteSaverWorkerContext,
  now: Date,
): Promise<boolean> {
  const indexes = selectedRanges(lease.session.restaurantRanges);
  updateMaximum(context.counters, "firestoreOperationsInFlightMaximum", indexes.length);
  const fetched = await Promise.all(indexes.map(async (index) => ({
    index,
    documents: await context.database.queryDocuments(rangeQuery({
      phase: "restaurantRanges",
      range: lease.session.restaurantRanges[index],
    })),
  })));
  const ranges = lease.session.restaurantRanges.map((range) => ({...range}));
  const candidates = new Map<string, CandidateDocument>();
  let processed = 0;
  for (const batch of fetched) {
    ranges[batch.index] = advanceRange(
      "restaurantRanges",
      ranges[batch.index],
      batch.documents,
    );
    processed += batch.documents.length;
    for (const document of batch.documents) {
      const candidate = buildRestaurantCandidate(context, lease.session, document, now);
      if (candidate !== null) {
        candidates.set(candidate.candidateDocumentId, candidate);
      }
    }
  }
  if (processed > customerBiteSaverWorkerSourceLimit || candidates.size > 100) {
    throw new CustomerBiteSaverTerminalPreparationError(
      "preparation_failed",
      "Worker source bound exceeded.",
    );
  }
  incrementCounter(context.counters, "sourceDocumentsProcessed", processed);
  incrementCounter(context.counters, "rangesAdvanced", fetched.length);
  incrementCounter(context.counters, "candidateIdentitiesRetained", candidates.size);
  const nextPhase = nextPhaseAfterRanges("restaurantRanges", ranges);
  const nextSession: CustomerBiteSaverSessionDocument = Object.freeze({
    ...lease.session,
    phase: nextPhase,
    restaurantRanges: Object.freeze(ranges.map((range) => Object.freeze(range))),
    progress: Object.freeze({
      ...lease.session.progress,
      processedSourceDocuments:
        lease.session.progress.processedSourceDocuments + processed,
      completedRestaurantRanges: ranges.filter((range) => range.exhausted).length,
    }),
  });
  return commitIteration({
    context,
    lease,
    now,
    nextSession,
    writes: [...candidates.values()].map((candidate) => ({
      path: path(
        privateCustomerBiteSaverCandidateCollection,
        candidate.candidateDocumentId,
      ),
      data: candidate,
    })),
  });
}

const candidateDocumentKeys = Object.freeze([
  "absoluteExpiresAt",
  "attemptGeneration",
  "authoritativeAccountId",
  "authoritativeAccountIdOrderKey",
  "callerBindingHash",
  "candidateDocumentId",
  "createdAt",
  "criteriaFingerprint",
  "customerParentEligibilityFingerprint",
  "distanceMiles",
  "distanceSortMiles",
  "exactPreferenceRank",
  "expiresAt",
  "latitude",
  "logicalExpiresAt",
  "longitude",
  "lowercaseDisplayNameOrderKey",
  "offerCatalogFingerprint",
  "offerMatches",
  "parentMatches",
  "parentOfferCatalogFingerprint",
  "parentProjectionDocumentId",
  "parentProjectionFingerprint",
  "previewCouponCandidates",
  "previewDailyCandidates",
  "protocolVersion",
  "queryFingerprint",
  "safeRestaurantSnapshot",
  "sessionId",
  "state",
  "usableOfferCount",
].sort());

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function terminalCandidateState(message: string): never {
  throw new CustomerBiteSaverTerminalPreparationError(
    "invalid_private_state",
    message,
  );
}

function parseCandidate(
  document: CustomerBiteSaverStoredDocument | null,
  session: CustomerBiteSaverSessionDocument,
): CandidateDocument | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  const prefix = customerBiteSaverCandidatePrefix(
    session.sessionId,
    session.attemptGeneration,
  );
  const authoritativeAccountId = exactId(data.authoritativeAccountId);
  const coordinates = validRestaurantCoordinates(data.latitude, data.longitude);
  const safeSnapshot = customerBiteSaverSessionInternals
    .parsePrivateSafeRestaurantSnapshot(data.safeRestaurantSnapshot);
  const dailyCandidates =
    Array.isArray(data.previewDailyCandidates) &&
      data.previewDailyCandidates.length <=
        customerBiteSaverWorkerPreviewSummaryLimit
      ? data.previewDailyCandidates.map((entry) =>
          customerBiteSaverSessionInternals.parsePrivatePreviewCandidate(
            entry,
            "dailySpecial",
          ))
      : null;
  const couponCandidates =
    Array.isArray(data.previewCouponCandidates) &&
      data.previewCouponCandidates.length <=
        customerBiteSaverWorkerPreviewSummaryLimit
      ? data.previewCouponCandidates.map((entry) =>
          customerBiteSaverSessionInternals.parsePrivatePreviewCandidate(
            entry,
            "coupon",
          ))
      : null;
  const createdAt = dateValue(data.createdAt);
  const logicalExpiresAt = dateValue(data.logicalExpiresAt);
  const absoluteExpiresAt = dateValue(data.absoluteExpiresAt);
  const expiresAt = dateValue(data.expiresAt);
  const accountIdOrderKey = parseDartUtf16FirestoreBytesOrderKey(
    data.authoritativeAccountIdOrderKey,
    customerBiteSaverMaximumIndexedOrderKeyBytes,
  );
  if (
    document.path !== path(privateCustomerBiteSaverCandidateCollection, document.id) ||
    !document.id.startsWith(prefix) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(document.id.slice(prefix.length)) ||
    !hasExactKeys(data, candidateDocumentKeys) ||
    data.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    data.sessionId !== session.sessionId ||
    data.attemptGeneration !== session.attemptGeneration ||
    data.criteriaFingerprint !== session.criteriaFingerprint ||
    data.queryFingerprint !== session.queryFingerprint ||
    data.callerBindingHash !== session.callerBindingHash ||
    data.state !== "candidate" ||
    authoritativeAccountId === null ||
    data.candidateDocumentId !== document.id ||
    exactId(data.parentProjectionDocumentId) === null ||
    typeof data.parentProjectionDocumentId !== "string" ||
    !/^si_[0-9a-f]{64}$/u.test(data.parentProjectionDocumentId) ||
    typeof data.parentProjectionFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.parentProjectionFingerprint) ||
    typeof data.parentOfferCatalogFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.parentOfferCatalogFingerprint) ||
    typeof data.parentMatches !== "boolean" ||
    typeof data.offerMatches !== "boolean" ||
    typeof data.customerParentEligibilityFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.customerParentEligibilityFingerprint) ||
    coordinates === null ||
    (data.exactPreferenceRank !== 0 && data.exactPreferenceRank !== 1) ||
    typeof data.distanceMiles !== "number" ||
    !Number.isFinite(data.distanceMiles) ||
    data.distanceMiles < 0 ||
    data.distanceMiles > session.criteria.radiusMiles ||
    typeof data.distanceSortMiles !== "number" ||
    !Number.isFinite(data.distanceSortMiles) ||
    (data.exactPreferenceRank === 0
      ? data.distanceSortMiles !== 0
      : data.distanceSortMiles !== data.distanceMiles) ||
    typeof data.lowercaseDisplayNameOrderKey !== "string" ||
    !/^(?:[0-9a-f]{4})+$/u.test(data.lowercaseDisplayNameOrderKey) ||
    accountIdOrderKey === null ||
    typeof data.usableOfferCount !== "number" ||
    !Number.isSafeInteger(data.usableOfferCount) ||
    data.usableOfferCount < 0 ||
    safeSnapshot === null ||
    dailyCandidates === null ||
    dailyCandidates.some((entry) => entry === null) ||
    couponCandidates === null ||
    couponCandidates.some((entry) => entry === null) ||
    typeof data.offerCatalogFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.offerCatalogFingerprint) ||
    createdAt === null || logicalExpiresAt === null ||
    absoluteExpiresAt === null || expiresAt === null ||
    createdAt.getTime() < session.createdAt.getTime() ||
    createdAt.getTime() >= session.absoluteExpiresAt.getTime() ||
    logicalExpiresAt.getTime() > absoluteExpiresAt.getTime() ||
    absoluteExpiresAt.getTime() !== session.absoluteExpiresAt.getTime() ||
    expiresAt.getTime() !== absoluteExpiresAt.getTime() ||
    serializedBytes(data) > customerBiteSaverMaximumCandidateDocumentBytes
  ) {
    return terminalCandidateState("Candidate state is invalid.");
  }
  const parsedDaily = dailyCandidates as readonly PreviewCandidate[];
  const parsedCoupons = couponCandidates as readonly PreviewCandidate[];
  const previewIdentities = [...parsedDaily, ...parsedCoupons].map((entry) =>
    `${entry.offerType}\0${entry.sourceDocumentId}\0${entry.indexDocumentId}`);
  const canonicalSummary = retainedPreviewCandidateSummary(
    parsedDaily,
    parsedCoupons,
  );
  if (
    previewIdentities.length > customerBiteSaverWorkerPreviewSummaryLimit ||
    new Set(previewIdentities).size !== previewIdentities.length ||
    data.usableOfferCount < previewIdentities.length ||
    !samePreviewCandidates(
      parsedDaily,
      canonicalSummary.previewDailyCandidates,
    ) ||
    !samePreviewCandidates(
      parsedCoupons,
      canonicalSummary.previewCouponCandidates,
    )
  ) {
    return terminalCandidateState("Candidate preview state is invalid.");
  }
  let distanceMiles: number;
  let exactPreferenceRank: 0 | 1;
  let parentMatches: boolean;
  let expectedDisplayNameOrderKey: string;
  let expectedAccountIdOrderKey: Buffer;
  try {
    distanceMiles = exactCustomerBiteSaverDistanceMiles(
      {
        latitude: session.criteria.latitude,
        longitude: session.criteria.longitude,
      },
      coordinates,
    );
    exactPreferenceRank = customerBiteSaverExactLocationPreference({
      typedLocation: session.criteria.typedLocation,
      restaurantCity: safeSnapshot.city,
      restaurantState: safeSnapshot.state,
      restaurantZipCode: safeSnapshot.zipCode,
    }) ? 0 : 1;
    parentMatches = customerBiteSaverMatchValuesContain(
      session.criteria.normalizedSearchQuery,
      customerBiteSaverSearchMatchValues([
        safeSnapshot.displayName,
        safeSnapshot.city,
        safeSnapshot.zipCode,
        safeSnapshot.bio,
      ]),
    );
    expectedDisplayNameOrderKey = lowercaseDisplayNameOrderKey(
      safeSnapshot.displayName as string,
    );
    expectedAccountIdOrderKey = dartUtf16FirestoreBytesOrderKey(
      authoritativeAccountId,
    );
  } catch {
    return terminalCandidateState("Candidate ordering state is invalid.");
  }
  if (
    data.distanceMiles !== distanceMiles ||
    data.exactPreferenceRank !== exactPreferenceRank ||
    data.lowercaseDisplayNameOrderKey !== expectedDisplayNameOrderKey ||
    !accountIdOrderKey.equals(expectedAccountIdOrderKey) ||
    data.parentMatches !== parentMatches
  ) {
    return terminalCandidateState("Candidate ordering state is invalid.");
  }
  return Object.freeze({
    ...data,
    authoritativeAccountId,
    authoritativeAccountIdOrderKey: accountIdOrderKey,
    candidateDocumentId: document.id,
    customerParentEligibilityFingerprint:
      data.customerParentEligibilityFingerprint as string,
    parentMatches,
    offerMatches: data.offerMatches as boolean,
    usableOfferCount: data.usableOfferCount as number,
    previewDailyCandidates: Object.freeze(parsedDaily),
    previewCouponCandidates: Object.freeze(parsedCoupons),
    offerCatalogFingerprint: data.offerCatalogFingerprint as string,
    safeRestaurantSnapshot: safeSnapshot,
    createdAt,
    logicalExpiresAt,
    absoluteExpiresAt,
    expiresAt,
  }) as CandidateDocument;
}

function previewCandidate(
  offer: CustomerBiteSaverStoredDocument,
): PreviewCandidate | null {
  const offerType = offer.data.offerType;
  const sourceDocumentId = exactId(offer.data.sourceDocumentId);
  const indexDocumentId = exactId(offer.data.indexDocumentId);
  const sourceCreatedAt = dateValue(offer.data.sourceCreatedAt);
  const sourceCreatedAtOrderKey =
    offer.data[customerBiteSaverOfferSourceCreatedAtOrderKeyField];
  const sourceFingerprint = offer.data.catalogGenerationContribution;
  if (
    (offerType !== "coupon" && offerType !== "dailySpecial") ||
    sourceDocumentId === null || indexDocumentId === null ||
    sourceCreatedAt === null ||
    !isCustomerBiteSaverTimestampOrderKey(sourceCreatedAtOrderKey) ||
    typeof sourceFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(sourceFingerprint)
  ) {
    return null;
  }
  return Object.freeze({
    offerType,
    sourceDocumentId,
    indexDocumentId,
    sourceCreatedAtMs: sourceCreatedAt.getTime(),
    sourceCreatedAtOrderKey,
    sourceFingerprint,
  });
}

function sortedPreviewCandidates(
  values: readonly PreviewCandidate[],
): readonly PreviewCandidate[] {
  return Object.freeze([...values].sort((left, right) =>
    compareCustomerBiteSaverFirestoreUtf8(
      right.sourceCreatedAtOrderKey,
      left.sourceCreatedAtOrderKey,
    ) ||
    compareCustomerBiteSaverFirestoreUtf8(
      right.sourceDocumentId,
      left.sourceDocumentId,
    )));
}

function retainedPreviewCandidateSummary(
  dailyValues: readonly PreviewCandidate[],
  couponValues: readonly PreviewCandidate[],
): Readonly<{
  previewDailyCandidates: readonly PreviewCandidate[];
  previewCouponCandidates: readonly PreviewCandidate[];
}> {
  const daily = sortedPreviewCandidates(dailyValues);
  const coupons = sortedPreviewCandidates(couponValues);
  if (daily.length === 0) {
    return Object.freeze({
      previewDailyCandidates: Object.freeze([] as PreviewCandidate[]),
      previewCouponCandidates: Object.freeze(
        coupons.slice(0, customerBiteSaverWorkerPreviewSummaryLimit),
      ),
    });
  }
  if (coupons.length === 0) {
    return Object.freeze({
      previewDailyCandidates: Object.freeze(
        daily.slice(0, customerBiteSaverWorkerPreviewSummaryLimit),
      ),
      previewCouponCandidates: Object.freeze([] as PreviewCandidate[]),
    });
  }
  // This exactly mirrors initialPreviewSeedsForParent: one candidate of each
  // type, then a second daily when available, otherwise a second coupon.
  const dailyLimit = daily.length >= 2 ? 2 : 1;
  return Object.freeze({
    previewDailyCandidates: Object.freeze(daily.slice(0, dailyLimit)),
    previewCouponCandidates: Object.freeze(
      coupons.slice(0, customerBiteSaverWorkerPreviewSummaryLimit - dailyLimit),
    ),
  });
}

function samePreviewCandidates(
  left: readonly PreviewCandidate[],
  right: readonly PreviewCandidate[],
): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const expected = right[index];
    return entry.offerType === expected.offerType &&
      entry.sourceDocumentId === expected.sourceDocumentId &&
      entry.indexDocumentId === expected.indexDocumentId &&
      entry.sourceCreatedAtMs === expected.sourceCreatedAtMs &&
      entry.sourceCreatedAtOrderKey === expected.sourceCreatedAtOrderKey &&
      entry.sourceFingerprint === expected.sourceFingerprint;
  });
}

function rawOfferPath(offer: CustomerBiteSaverStoredDocument): string | null {
  const parent = exactOfferParentId(offer.data.restaurantAccountId);
  const id = exactId(offer.data.sourceDocumentId);
  if (parent === null || id === null) {
    return null;
  }
  return `restaurant_accounts/${parent}/${
    offer.data.offerType === "coupon" ? "coupons" : "daily_specials"
  }/${id}`;
}

function offerMatches(
  session: CustomerBiteSaverSessionDocument,
  projection: Readonly<Record<string, unknown>>,
  rawFallback: Readonly<Record<string, unknown>> | null,
): boolean {
  try {
    if (session.criteria.normalizedSearchQuery.length === 0) {
      return true;
    }
    if (projection.searchMatchComplete === true &&
        Array.isArray(projection.searchMatchValues)) {
      return customerBiteSaverMatchValuesContain(
        session.criteria.normalizedSearchQuery,
        projection.searchMatchValues,
      );
    }
    if (rawFallback === null) {
      return false;
    }
    const values = projection.offerType === "coupon"
      ? [
          projection.restaurantDisplayName,
          projection.city,
          projection.zipCode,
          projection.restaurantBio,
          rawFallback.title,
          rawFallback.restaurant,
          projection.usageRule,
          rawFallback.couponCode,
        ]
      : [
          projection.restaurantDisplayName,
          projection.city,
          projection.zipCode,
          projection.restaurantBio,
          rawFallback.title,
          rawFallback.details,
        ];
    return customerBiteSaverMatchValuesContain(
      session.criteria.normalizedSearchQuery,
      customerBiteSaverSearchMatchValues(values),
    );
  } catch {
    throw new CustomerBiteSaverTerminalPreparationError(
      "invalid_private_state",
      "Offer matching state is invalid.",
    );
  }
}

function workerOfferAvailability(
  value: Parameters<typeof evaluateCustomerBiteSaverOfferAvailability>[0],
): ReturnType<typeof evaluateCustomerBiteSaverOfferAvailability> {
  try {
    return evaluateCustomerBiteSaverOfferAvailability(value);
  } catch {
    throw new CustomerBiteSaverTerminalPreparationError(
      "invalid_private_state",
      "Offer availability state is invalid.",
    );
  }
}

async function processOfferRanges(
  lease: Lease,
  context: CustomerBiteSaverWorkerContext,
  now: Date,
): Promise<boolean> {
  const indexes = selectedRanges(lease.session.offerRanges);
  updateMaximum(context.counters, "firestoreOperationsInFlightMaximum", indexes.length);
  const fetched = await Promise.all(indexes.map(async (index) => ({
    index,
    documents: await context.database.queryDocuments(rangeQuery({
      phase: "offerRanges",
      range: lease.session.offerRanges[index],
    })),
  })));
  const fetchedOffers = fetched.flatMap((entry) => entry.documents);
  if (fetchedOffers.length > customerBiteSaverWorkerSourceLimit) {
    throw new CustomerBiteSaverTerminalPreparationError(
      "preparation_failed",
      "Worker source bound exceeded.",
    );
  }
  const parentIds = [...new Set(fetchedOffers.map((offer) =>
    exactOfferParentId(offer.data.restaurantAccountId)).filter(
      (value): value is string => value !== null,
    ))];
  const candidatePaths = parentIds.map((id) =>
    candidatePath(context.secretKey, lease.session, id));
  updateMaximum(context.counters, "firestoreOperationsInFlightMaximum", Math.min(
    candidatePaths.length,
    10,
  ));
  const candidateSnapshots = await context.database.getDocuments(candidatePaths);
  const candidates = new Map<string, CandidateDocument>();
  candidateSnapshots.forEach((snapshot, index) => {
    const candidate = parseCandidate(snapshot, lease.session);
    if (candidate !== null) {
      candidates.set(parentIds[index], candidate);
    }
  });

  const rawByIndexId = new Map<string, Readonly<Record<string, unknown>> | null>();
  let fallbackBytes = 0;
  let fallbackDocuments = 0;
  const processedBatches: Array<Readonly<{
    index: number;
    documents: readonly CustomerBiteSaverStoredDocument[];
    fullyConsumed: boolean;
  }>> = [];
  for (const batch of fetched) {
    const processed: CustomerBiteSaverStoredDocument[] = [];
    for (const offer of batch.documents) {
      const parentId = exactOfferParentId(offer.data.restaurantAccountId);
      const baseCandidate = parentId === null
        ? null
        : candidates.get(parentId) ?? null;
      const preview = previewCandidate(offer);
      const needsRawFallback =
        baseCandidate !== null &&
        preview !== null &&
        offer.data.customerOfferProjectionVersion ===
          customerBiteSaverOfferProjectionVersion &&
        offer.data.customerDiscoverable === true &&
        offer.data.customerParentEligibilityFingerprint ===
          baseCandidate.customerParentEligibilityFingerprint &&
        offer.data.searchMatchComplete !== true;
      if (
        needsRawFallback &&
        fallbackDocuments >=
          customerBiteSaverMaximumRawFallbackDocumentsPerWorker
      ) {
        break;
      }
      if (needsRawFallback) {
        const rawPath = rawOfferPath(offer);
        if (rawPath === null) {
          throw new CustomerBiteSaverTerminalPreparationError(
            "invalid_private_state",
            "Offer fallback identity is invalid.",
          );
        }
        const raw = (await context.database.getDocument(rawPath))?.data ?? null;
        const bytes = raw === null ? 0 : serializedBytes(raw);
        if (
          bytes > customerBiteSaverMaximumRawFallbackBytesPerWorker -
            fallbackBytes
        ) {
          throw new CustomerBiteSaverTerminalPreparationError(
            "preparation_failed",
            "Offer matching fallback byte limit exceeded.",
          );
        }
        fallbackBytes += bytes;
        fallbackDocuments += 1;
        rawByIndexId.set(offer.id, raw);
      }
      processed.push(offer);
    }
    processedBatches.push(Object.freeze({
      index: batch.index,
      documents: Object.freeze(processed),
      fullyConsumed: processed.length === batch.documents.length,
    }));
  }
  const allOffers = processedBatches.flatMap((entry) => entry.documents);
  incrementCounter(context.counters, "rawFallbackBytes", fallbackBytes);

  const updated = new Map<string, CandidateDocument>();
  for (const offer of allOffers) {
    const parentId = exactOfferParentId(offer.data.restaurantAccountId);
    if (parentId === null) {
      continue;
    }
    const baseCandidate = parentId === null
      ? null
      : updated.get(parentId) ?? candidates.get(parentId) ?? null;
    const preview = previewCandidate(offer);
    if (
      baseCandidate === null || preview === null ||
      offer.data.customerOfferProjectionVersion !==
        customerBiteSaverOfferProjectionVersion ||
      offer.data.customerDiscoverable !== true ||
      offer.data.customerParentEligibilityFingerprint !==
        baseCandidate.customerParentEligibilityFingerprint
    ) {
      continue;
    }
    const rawFallback = offer.data.searchMatchComplete === true
      ? null
      : rawByIndexId.get(offer.id) ?? null;
    // Incomplete rows are admitted to this processed prefix only after their
    // authoritative fallback has been read. Deferred rows remain behind the
    // persisted range cursor for the next bounded worker delivery.
    if (offer.data.searchMatchComplete !== true && !rawByIndexId.has(offer.id)) {
      throw new CustomerBiteSaverTerminalPreparationError(
        "invalid_private_state",
        "Offer matching fallback state is invalid.",
      );
    }
    const coordinates = validRestaurantCoordinates(
      baseCandidate.latitude,
      baseCandidate.longitude,
    );
    const availability = workerOfferAvailability({
      offerType: preview.offerType,
      offer: offer.data,
      parentEligible: true,
      // Membership is one coherent snapshot even when the bounded phase spans
      // multiple deliveries. Delivery/redemption still revalidate at their own
      // fixed generation instants.
      now: lease.session.createdAt,
      timeZone: lease.session.criteria.timeZone,
      locationMode: lease.session.criteria.locationMode,
      restaurantCoordinates: coordinates,
      currentCoordinates: lease.session.criteria.locationMode === "current"
        ? {
            latitude: lease.session.criteria.latitude,
            longitude: lease.session.criteria.longitude,
          }
        : null,
      usage: null,
    });
    if (!availability.visible) {
      continue;
    }
    const matches = offerMatches(
      lease.session,
      offer.data,
      rawFallback,
    );
    const belongsToPreparedMembership =
      lease.session.criteria.normalizedSearchQuery.length === 0 ||
      baseCandidate.parentMatches ||
      matches;
    if (!belongsToPreparedMembership) {
      continue;
    }
    const summary = retainedPreviewCandidateSummary(
      preview.offerType === "dailySpecial"
        ? [...baseCandidate.previewDailyCandidates, preview]
        : baseCandidate.previewDailyCandidates,
      preview.offerType === "coupon"
        ? [...baseCandidate.previewCouponCandidates, preview]
        : baseCandidate.previewCouponCandidates,
    );
    const next: CandidateDocument = Object.freeze({
      ...baseCandidate,
      offerMatches: baseCandidate.offerMatches || matches,
      usableOfferCount: baseCandidate.usableOfferCount + 1,
      previewDailyCandidates: summary.previewDailyCandidates,
      previewCouponCandidates: summary.previewCouponCandidates,
      offerCatalogFingerprint: digest(
        `${baseCandidate.offerCatalogFingerprint}\0${preview.sourceFingerprint}`,
      ),
    });
    if (serializedBytes(next) > customerBiteSaverMaximumCandidateDocumentBytes) {
      throw new CustomerBiteSaverTerminalPreparationError(
        "preparation_failed",
        "Candidate document size bound exceeded.",
      );
    }
    updated.set(parentId, next);
  }

  const ranges = lease.session.offerRanges.map((range) => ({...range}));
  let rangesAdvanced = 0;
  for (const batch of processedBatches) {
    if (batch.documents.length === 0 && !batch.fullyConsumed) {
      continue;
    }
    const advanced = advanceRange(
      "offerRanges",
      ranges[batch.index],
      batch.documents,
    );
    ranges[batch.index] = batch.fullyConsumed
      ? advanced
      : Object.freeze({...advanced, exhausted: false});
    rangesAdvanced += 1;
  }
  incrementCounter(context.counters, "sourceDocumentsProcessed", allOffers.length);
  incrementCounter(context.counters, "rangesAdvanced", rangesAdvanced);
  incrementCounter(context.counters, "candidateIdentitiesRetained", updated.size);
  const nextPhase = nextPhaseAfterRanges("offerRanges", ranges);
  const nextSession: CustomerBiteSaverSessionDocument = Object.freeze({
    ...lease.session,
    phase: nextPhase,
    offerRanges: Object.freeze(ranges.map((range) => Object.freeze(range))),
    progress: Object.freeze({
      ...lease.session.progress,
      processedSourceDocuments:
        lease.session.progress.processedSourceDocuments + allOffers.length,
      completedOfferRanges: ranges.filter((range) => range.exhausted).length,
    }),
  });
  return commitIteration({
    context,
    lease,
    now,
    nextSession,
    writes: [...updated.values()].map((candidate) => ({
      path: path(
        privateCustomerBiteSaverCandidateCollection,
        candidate.candidateDocumentId,
      ),
      data: candidate,
    })),
  });
}

function resultFromCandidate(
  context: CustomerBiteSaverWorkerContext,
  session: CustomerBiteSaverSessionDocument,
  candidate: CandidateDocument,
  now: Date,
): Readonly<{id: string; data: Readonly<Record<string, unknown>>}> | null {
  if (
    candidate.usableOfferCount <= 0 ||
    (session.criteria.normalizedSearchQuery.length > 0 &&
      !candidate.parentMatches && !candidate.offerMatches)
  ) {
    return null;
  }
  const publicRestaurantId = customerBiteSaverOpaqueRestaurantId(
    context.secretKey,
    candidate.authoritativeAccountId,
  );
  const id = customerBiteSaverResultDocumentId(
    context.secretKey,
    session.sessionId,
    session.attemptGeneration,
    publicRestaurantId,
  );
  const data = Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    sessionId: session.sessionId,
    attemptGeneration: session.attemptGeneration,
    criteriaFingerprint: session.criteriaFingerprint,
    queryFingerprint: session.queryFingerprint,
    callerBindingHash: session.callerBindingHash,
    state: "result",
    eligibleAtPreparation: true,
    exactPreferenceRank: candidate.exactPreferenceRank,
    distanceSortMiles: candidate.distanceSortMiles,
    distanceMiles: candidate.distanceMiles,
    lowercaseDisplayNameOrderKey: candidate.lowercaseDisplayNameOrderKey,
    authoritativeAccountIdOrderKey: candidate.authoritativeAccountIdOrderKey,
    authoritativeAccountId: candidate.authoritativeAccountId,
    publicRestaurantId,
    parentProjectionDocumentId: candidate.parentProjectionDocumentId,
    parentProjectionFingerprint: candidate.parentProjectionFingerprint,
    parentOfferCatalogFingerprint: candidate.parentOfferCatalogFingerprint,
    offerCatalogFingerprint: candidate.offerCatalogFingerprint,
    parentMatches: candidate.parentMatches,
    offerMatches: candidate.offerMatches,
    previewDailyCandidates: candidate.previewDailyCandidates,
    previewCouponCandidates: candidate.previewCouponCandidates,
    usableOfferCountAtPreparation: candidate.usableOfferCount,
    safeRestaurantSnapshot: candidate.safeRestaurantSnapshot,
    createdAt: now,
    logicalExpiresAt: session.logicalExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    expiresAt: session.absoluteExpiresAt,
  });
  if (serializedBytes(data) > customerBiteSaverMaximumResultDocumentBytes) {
    throw new CustomerBiteSaverTerminalPreparationError(
      "preparation_failed",
      "Result document size bound exceeded.",
    );
  }
  return Object.freeze({id, data});
}

async function processFinalization(
  lease: Lease,
  context: CustomerBiteSaverWorkerContext,
  now: Date,
): Promise<boolean> {
  const prefix = customerBiteSaverCandidatePrefix(
    lease.session.sessionId,
    lease.session.attemptGeneration,
  );
  const finalizationCursor = lease.session.finalizeAfterCandidateDocumentId;
  if (
    finalizationCursor !== null &&
    (
      !finalizationCursor.startsWith(prefix) ||
      !/^[A-Za-z0-9_-]{43}$/u.test(finalizationCursor.slice(prefix.length)) ||
      finalizationCursor.length !== prefix.length + 43
    )
  ) {
    throw new CustomerBiteSaverTerminalPreparationError(
      "invalid_private_state",
      "Candidate finalization cursor is invalid.",
    );
  }
  const documents = await context.database.queryDocuments({
    collectionPath: privateCustomerBiteSaverCandidateCollection,
    filters: Object.freeze([
      {field: "__name__", operation: ">=", value: prefix},
      {field: "__name__", operation: "<=", value: `${prefix}\uf8ff`},
    ]),
    orders: Object.freeze([{field: "__name__", direction: "asc"}]),
    ...(finalizationCursor === null
      ? {}
      : {startAfter: Object.freeze([
          finalizationCursor,
        ])}),
    limit: customerBiteSaverRangeFetchLimit,
  });
  const results = documents.map((document) => {
    const candidate = parseCandidate(document, lease.session);
    return candidate === null
      ? null
      : resultFromCandidate(context, lease.session, candidate, now);
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const last = documents[documents.length - 1];
  const finished = documents.length < customerBiteSaverRangeFetchLimit;
  const nextSession: CustomerBiteSaverSessionDocument = Object.freeze({
    ...lease.session,
    phase: finished ? "verifyCatalogGeneration" : "finalizeCandidates",
    finalizeAfterCandidateDocumentId: last?.id ??
      lease.session.finalizeAfterCandidateDocumentId,
    progress: Object.freeze({
      ...lease.session.progress,
      finalizedCandidates:
        lease.session.progress.finalizedCandidates + documents.length,
    }),
  });
  incrementCounter(context.counters, "candidateIdentitiesRetained", documents.length);
  return commitIteration({
    context,
    lease,
    now,
    nextSession,
    writes: results.map((result) => ({
      path: path(privateCustomerBiteSaverResultCollection, result.id),
      data: result.data,
    })),
  });
}

function parseCatalogGenerationVector(
  documents: readonly (CustomerBiteSaverStoredDocument | null)[],
): readonly number[] {
  if (documents.length !== customerBiteSaverCatalogGenerationShardCount) {
    throw new CustomerBiteSaverTerminalPreparationError(
      "invalid_private_state",
      "Catalog generation vector is invalid.",
    );
  }
  return Object.freeze(documents.map((document, index) => {
    if (document === null) {
      throw new CustomerBiteSaverTerminalPreparationError(
        "invalid_private_state",
        "Catalog generation vector is invalid.",
      );
    }
    try {
      return readCustomerBiteSaverCatalogGeneration(document.data, index);
    } catch {
      throw new CustomerBiteSaverTerminalPreparationError(
        "invalid_private_state",
        "Catalog generation vector is invalid.",
      );
    }
  }));
}

function resetRange(
  range: CustomerBiteSaverGeohashRangeState,
): CustomerBiteSaverGeohashRangeState {
  return Object.freeze({
    start: range.start,
    end: range.end,
    afterGeohash: null,
    afterDocumentId: null,
    exhausted: false,
  });
}

async function processGenerationVerification(
  lease: Lease,
  context: CustomerBiteSaverWorkerContext,
  now: Date,
): Promise<boolean> {
  return commitIteration({
    context,
    lease,
    now,
    nextSession: (currentVector) => {
      const matches = currentVector.every((entry, index) =>
        entry === lease.session.catalogGenerationVector[index]);
      if (matches) {
        return Object.freeze({
          ...lease.session,
          state: "ready",
          phase: "ready",
        });
      }
      if (
        lease.session.catalogRestartCount >=
          customerBiteSaverMaximumCatalogRestarts
      ) {
        return Object.freeze({
          ...lease.session,
          state: "failed",
          failureCode: "catalog_changed_repeatedly",
        });
      }
      const attemptGeneration = lease.session.attemptGeneration + 1;
      return Object.freeze({
        ...lease.session,
        attemptGeneration,
        catalogRestartCount: lease.session.catalogRestartCount + 1,
        catalogGenerationVector: currentVector,
        queryFingerprint: createCustomerBiteSaverMembershipFingerprint({
          criteria: lease.session.criteria,
          attemptGeneration,
          catalogGenerationVector: currentVector,
        }),
        phase: "restaurantRanges",
        restaurantRanges: Object.freeze(
          lease.session.restaurantRanges.map(resetRange),
        ),
        offerRanges: Object.freeze(lease.session.offerRanges.map(resetRange)),
        finalizeAfterCandidateDocumentId: null,
        progress: Object.freeze({
          processedSourceDocuments: 0,
          completedRestaurantRanges: 0,
          completedOfferRanges: 0,
          finalizedCandidates: 0,
        }),
      });
    },
  });
}

async function markPreparationFailure(
  lease: Lease,
  context: CustomerBiteSaverWorkerContext,
  now: Date,
  failureCode: "invalid_private_state" | "preparation_failed" =
    "invalid_private_state",
): Promise<void> {
  await commitIteration({
    context,
    lease,
    now,
    nextSession: Object.freeze({
        ...lease.session,
        state: "failed",
        failureCode,
    }),
  });
}

export async function processCustomerBiteSaverSearchJob(
  rawJobId: unknown,
  context: CustomerBiteSaverWorkerContext,
): Promise<boolean> {
  const jobId = exactId(rawJobId);
  if (jobId === null || !/^bsj_[A-Za-z0-9_-]{43}$/u.test(jobId)) {
    return false;
  }
  const now = nowDate(context);
  const lease = await claimLease(jobId, context, now);
  if (lease === "busy") {
    // A retry that arrives before the prior lease expires must remain failed so
    // the retry-enabled trigger delivers it again after either lease release
    // or expiry. Treating this as success can strand a crashed invocation.
    throw new CustomerBiteSaverWorkerLeaseBusyError();
  }
  if (lease === null) {
    return false;
  }
  try {
    switch (lease.session.phase) {
      case "restaurantRanges":
        return await processRestaurantRanges(lease, context, now);
      case "offerRanges":
        return await processOfferRanges(lease, context, now);
      case "finalizeCandidates":
        return await processFinalization(lease, context, now);
      case "verifyCatalogGeneration":
        return await processGenerationVerification(lease, context, now);
      case "ready":
        await markPreparationFailure(lease, context, now);
        return false;
    }
  } catch (error) {
    // Deterministic private-state violations terminate safely. Ordinary
    // Firestore/network errors are retried by the v2 trigger after lease expiry.
    if (error instanceof CustomerBiteSaverTerminalPreparationError) {
      await markPreparationFailure(
        lease,
        context,
        now,
        error.failureCode,
      );
      return true;
    }
    try {
      await releaseLeaseAfterTransientFailure(lease, context);
    } catch {
      // The original error remains retryable. If releasing the lease also
      // fails, subsequent trigger retries keep failing while it is active and
      // may reclaim it at the 30-second deadline.
    }
    throw error;
  }
}

export function createCustomerBiteSaverWorkerCounters(): CustomerBiteSaverWorkerCounters {
  return {
    sourceDocumentsProcessed: 0,
    rangesAdvanced: 0,
    candidateIdentitiesRetained: 0,
    firestoreOperationsInFlightMaximum: 0,
    writesCommittedMaximum: 0,
    rawFallbackBytes: 0,
  };
}

export const customerBiteSaverWorkerQueryContracts = Object.freeze({
  restaurantGeographic: Object.freeze([
    ["source", "==", "biteSaver"],
    ["publicProjectionVersion", "==", "current"],
    ["publicVisible", "==", true],
    ["geohash", "range", "ascending"],
    ["sourceDocumentId", "order", "ascending"],
  ]),
  offerGeographic: Object.freeze([
    ["source", "==", "biteSaver"],
    ["customerOfferProjectionVersion", "==", "current"],
    ["customerDiscoverable", "==", true],
    ["geohash", "range", "ascending"],
    ["indexDocumentId", "order", "ascending"],
  ]),
});
