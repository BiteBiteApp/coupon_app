import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type Query,
  type WhereFilterOp,
} from "firebase-admin/firestore";

import {
  parseRatingDestructiveJobDocument,
  ratingDestructiveJobCollection,
  type RatingDestructiveStoredDocument,
} from "./rating_destructive_job_contract.js";
import {
  processRatingDestructiveJobStep,
} from "./rating_destructive_job_processor.js";
import type {
  RatingDestructiveDependencies,
} from "./rating_destructive_job_runtime.js";

export const ratingDestructiveScheduledWorkLimit = 25;

export const ratingDestructiveScheduledFunctionOptions = Object.freeze({
  schedule: "every 1 minute",
  region: "us-central1",
} as const);

export type RatingDestructiveSchedulerFilter = Readonly<{
  field: string;
  operator: Extract<WhereFilterOp, "in">;
  value: unknown;
}>;

export type RatingDestructiveSchedulerOrder = Readonly<{
  field: string;
  direction: "asc" | "desc";
}>;

export type RatingDestructiveSchedulerQuery = Readonly<{
  collectionPath: string;
  where: readonly RatingDestructiveSchedulerFilter[];
  orderBy: readonly RatingDestructiveSchedulerOrder[];
  limit: number;
}>;

/** Read-only seam for the single bounded scheduler discovery query. */
export interface RatingDestructiveSchedulerDiscoveryDatabase {
  queryDocuments(
    query: RatingDestructiveSchedulerQuery,
  ): Promise<readonly RatingDestructiveStoredDocument[]>;
}

function firestoreField(field: string): string | FieldPath {
  return field === "__name__" ? FieldPath.documentId() : field;
}

export function createFirestoreRatingDestructiveSchedulerDiscoveryDatabase(
  firestore: Firestore,
): RatingDestructiveSchedulerDiscoveryDatabase {
  return {
    async queryDocuments(options) {
      if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
        throw new Error(
          "Rating destructive scheduler query limit is invalid.",
        );
      }
      let query: Query<DocumentData, DocumentData> = firestore.collection(
        options.collectionPath,
      );
      for (const condition of options.where) {
        query = query.where(
          firestoreField(condition.field),
          condition.operator,
          condition.value,
        );
      }
      for (const order of options.orderBy) {
        query = query.orderBy(
          firestoreField(order.field),
          order.direction,
        );
      }
      const snapshot = await query.limit(options.limit).get();
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data() as Readonly<Record<string, unknown>>,
      }));
    },
  };
}

export type RatingDestructiveScheduledWorkSummary = Readonly<{
  selectedJobs: number;
  processedJobs: number;
  failures: number;
}>;

type ProcessStep = typeof processRatingDestructiveJobStep;

export type RatingDestructiveScheduledWorkContext = Readonly<{
  discoveryDatabase: RatingDestructiveSchedulerDiscoveryDatabase;
  dependencies: RatingDestructiveDependencies;
  now?: () => Date;
  processStep?: ProcessStep;
}>;

function currentTime(now: (() => Date) | undefined): Date {
  const value = now?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Rating destructive scheduler time is invalid.");
  }
  return new Date(value.getTime());
}

function scheduledDiscoveryQuery(): RatingDestructiveSchedulerQuery {
  return Object.freeze({
    collectionPath: ratingDestructiveJobCollection,
    where: Object.freeze([Object.freeze({
      field: "status",
      operator: "in" as const,
      value: Object.freeze(["active", "retryable"] as const),
    })]),
    orderBy: Object.freeze([
      Object.freeze({field: "updatedAt", direction: "asc" as const}),
      Object.freeze({field: "__name__", direction: "asc" as const}),
    ]),
    limit: ratingDestructiveScheduledWorkLimit,
  });
}

/**
 * Selects one bounded oldest-updated page and advances each unique runnable job
 * at most once. The processor's transactional freshness fences remain the
 * authority when scheduled deliveries overlap.
 */
export async function processRatingDestructiveOperationWorkHandler(
  context: RatingDestructiveScheduledWorkContext,
): Promise<RatingDestructiveScheduledWorkSummary> {
  const now = currentTime(context.now);
  const documents = (
    await context.discoveryDatabase.queryDocuments(scheduledDiscoveryQuery())
  ).slice(0, ratingDestructiveScheduledWorkLimit);
  const selectedIds = new Set<string>();
  const step = context.processStep ?? processRatingDestructiveJobStep;
  let selectedJobs = 0;
  let processedJobs = 0;
  let failures = 0;

  for (const document of documents) {
    if (selectedIds.has(document.id)) {
      continue;
    }
    selectedIds.add(document.id);
    selectedJobs += 1;
    try {
      const job = parseRatingDestructiveJobDocument(document);
      if (
        job === null ||
        (job.status !== "active" && job.status !== "retryable")
      ) {
        throw new Error("Selected destructive job is not runnable.");
      }
      await step(context.dependencies, job.jobId, new Date(now.getTime()));
      processedJobs += 1;
    } catch {
      failures += 1;
    }
  }

  return Object.freeze({selectedJobs, processedJobs, failures});
}
