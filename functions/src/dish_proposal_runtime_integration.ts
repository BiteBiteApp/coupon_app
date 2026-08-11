import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type Query,
  type WhereFilterOp,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  buildDishProposalResolutionIdentity,
  dishProposalGroupCollection,
  dishProposalGroupPath,
  dishProposalJobCollection,
  dishProposalJobPath,
  type DishProposalGroupDocument,
  type DishProposalJobDocument,
  type DishProposalResolutionType,
} from "./dish_proposal_private_contract.js";
import {
  parseDishProposalGroupDocument,
} from "./dish_proposal_private_maintenance.js";
import {
  claimDishProposalGroupForApply,
  claimDishProposalGroupForReject,
  parseDishProposalJobDocument,
  processDishProposalJobStep,
  type DishProposalClaimResult,
  type DishProposalJobStepResult,
  type DishProposalResolutionDependencies,
} from "./dish_proposal_resolution_jobs.js";
import type {
  DishProposalPrivateDatabase,
  DishProposalPrivateTransaction,
  DishProposalStoredDocument,
} from "./dish_proposal_private_store.js";

export const dishProposalActionContractVersion =
  "bitestar.dish-proposal-action.v1" as const;
export const dishProposalActionResultContractVersion =
  "bitestar.dish-proposal-action-result.v1" as const;
export const dishProposalScheduledExistingJobLimit = 15;
export const dishProposalScheduledWorkLimit = 25;

type DishProposalActionStatus =
  | "idle"
  | "applying"
  | "rejecting"
  | "retryable"
  | "manual_review_required"
  | "complete"
  | "stale"
  | "not_actionable";

type DishProposalActionMessageCategory =
  | "accepted_processing"
  | "accepted_complete"
  | "already_processing"
  | "stale_group"
  | "not_actionable"
  | "manual_review_required"
  | "retryable_processing";

export type DishProposalActionRequest = Readonly<{
  contractVersion: typeof dishProposalActionContractVersion;
  groupId: string;
  expectedFingerprint: string;
  expectedMembershipGeneration: number;
  expectedResolutionSequence: number;
  clientRequestId: string;
}>;

export type DishProposalActionResult = Readonly<{
  contractVersion: typeof dishProposalActionResultContractVersion;
  accepted: boolean;
  status: DishProposalActionStatus;
  resolutionType: DishProposalResolutionType | null;
  processing: boolean;
  complete: boolean;
  manualReviewRequired: boolean;
  messageCategory: DishProposalActionMessageCategory;
}>;

type ClaimFunction = (
  database: DishProposalPrivateDatabase,
  groupId: string,
  now: Date,
) => Promise<DishProposalClaimResult>;

type ProcessStepFunction = (
  dependencies: DishProposalResolutionDependencies,
  jobId: string,
  now: Date,
) => Promise<DishProposalJobStepResult>;

export type RatingAdminDishSuggestionActionHandlerContext = Readonly<{
  privateDatabase: DishProposalPrivateDatabase;
  resolutionDependencies: DishProposalResolutionDependencies;
  now?: () => Date;
  claimApply?: ClaimFunction;
  claimReject?: ClaimFunction;
  processStep?: ProcessStepFunction;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function invalidActionRequest(): never {
  throw new HttpsError(
    "invalid-argument",
    "The Dish Suggestions action request is invalid.",
  );
}

function requireSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidActionRequest();
  }
  return value;
}

function parseActionRequest(value: unknown): DishProposalActionRequest {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "contractVersion",
    "groupId",
    "expectedFingerprint",
    "expectedMembershipGeneration",
    "expectedResolutionSequence",
    "clientRequestId",
  ])) {
    invalidActionRequest();
  }
  const groupId = value.groupId;
  const fingerprint = value.expectedFingerprint;
  const clientRequestId = value.clientRequestId;
  if (
    value.contractVersion !== dishProposalActionContractVersion ||
    typeof groupId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(groupId) ||
    typeof fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(fingerprint) ||
    typeof clientRequestId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(clientRequestId)
  ) {
    invalidActionRequest();
  }
  return Object.freeze({
    contractVersion: dishProposalActionContractVersion,
    groupId,
    expectedFingerprint: fingerprint,
    expectedMembershipGeneration: requireSafeInteger(
      value.expectedMembershipGeneration,
    ),
    expectedResolutionSequence: requireSafeInteger(
      value.expectedResolutionSequence,
    ),
    clientRequestId,
  });
}

function currentTime(clock: (() => Date) | undefined): Date {
  const value = clock?.() ?? new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Dish-proposal runtime clock is invalid.");
  }
  return new Date(value.getTime());
}

function groupHasSafeResolutionInputs(
  group: DishProposalGroupDocument,
): boolean {
  const identity = buildDishProposalResolutionIdentity({
    type: group.proposalType,
    restaurantId: group.restaurantId,
    sourceDishId: group.sourceDishId,
    mergeTargetDishId: group.mergeTargetDishId,
    proposedName: group.normalizedProposedName,
  });
  return group.resolutionIdentitiesValid === true &&
    identity !== null &&
    identity.proposalType === group.proposalType &&
    identity.restaurantId === group.restaurantId &&
    identity.sourceDishId === group.sourceDishId &&
    identity.mergeTargetDishId === group.mergeTargetDishId &&
    identity.normalizedProposedName === group.normalizedProposedName;
}

type GroupGuardDecision =
  | "eligible"
  | "missing"
  | "already_active"
  | "stale"
  | "not_actionable"
  | "not_automatic";

type GroupGuardObservation = {
  decision: GroupGuardDecision;
  group: DishProposalGroupDocument | null;
};

function proxyTransaction(
  transaction: DishProposalPrivateTransaction,
  groupPath: string,
  observe: (group: DishProposalGroupDocument | null) => boolean,
): DishProposalPrivateTransaction {
  return {
    async getDocument(path) {
      const document = await transaction.getDocument(path);
      if (path !== groupPath) {
        return document;
      }
      const group = parseDishProposalGroupDocument(document);
      return observe(group) ? document : null;
    },
    queryDocuments(query) {
      return transaction.queryDocuments(query);
    },
    setDocument(path, data, options) {
      transaction.setDocument(path, data, options);
    },
    deleteDocument(path) {
      transaction.deleteDocument(path);
    },
  };
}

function guardedDatabase(
  database: DishProposalPrivateDatabase,
  groupId: string,
  observe: (group: DishProposalGroupDocument | null) => boolean,
): DishProposalPrivateDatabase {
  const groupPath = dishProposalGroupPath(groupId);
  return {
    runTransaction(operation) {
      return database.runTransaction((transaction) =>
        operation(proxyTransaction(transaction, groupPath, observe))
      );
    },
  };
}

function manualClaimDatabase(
  database: DishProposalPrivateDatabase,
  request: DishProposalActionRequest,
  resolutionType: DishProposalResolutionType,
  observation: GroupGuardObservation,
): DishProposalPrivateDatabase {
  return guardedDatabase(database, request.groupId, (group) => {
    observation.group = group;
    if (group === null) {
      observation.decision = "missing";
      return false;
    }
    if (
      group.fingerprint !== request.expectedFingerprint ||
      group.lastMembershipGeneration !==
        request.expectedMembershipGeneration ||
      group.resolutionSequence !== request.expectedResolutionSequence
    ) {
      observation.decision = "stale";
      return false;
    }
    if (!groupHasSafeResolutionInputs(group)) {
      observation.decision = "not_actionable";
      return false;
    }
    if (group.activeJobId !== null) {
      observation.decision = "already_active";
      return false;
    }
    if (!group.hasPendingMembers) {
      observation.decision = "not_actionable";
      return false;
    }
    observation.decision = "eligible";
    return true;
  });
}

function automaticClaimDatabase(
  database: DishProposalPrivateDatabase,
  selectedGroup: DishProposalGroupDocument,
  now: Date,
  observation: GroupGuardObservation,
): DishProposalPrivateDatabase {
  return guardedDatabase(database, selectedGroup.groupId, (group) => {
    observation.group = group;
    if (group === null) {
      observation.decision = "missing";
      return false;
    }
    if (
      group.fingerprint !== selectedGroup.fingerprint ||
      group.lastMembershipGeneration !==
        selectedGroup.lastMembershipGeneration ||
      group.resolutionSequence !== selectedGroup.resolutionSequence ||
      !groupHasSafeResolutionInputs(group) ||
      !group.hasPendingMembers ||
      !group.enoughSupporters ||
      !group.autoEligible ||
      group.activeJobId !== null ||
      group.dueAt === null ||
      group.dueAt.getTime() > now.getTime()
    ) {
      observation.decision = "not_automatic";
      return false;
    }
    observation.decision = "eligible";
    return true;
  });
}

async function readRunnableJobWithActiveGroup(
  database: DishProposalPrivateDatabase,
  jobId: string,
): Promise<DishProposalJobDocument | null> {
  return database.runTransaction(async (transaction) => {
    const job = parseDishProposalJobDocument(
      await transaction.getDocument(dishProposalJobPath(jobId)),
    );
    if (job === null) {
      throw new Error("Selected dish-proposal job state is unavailable.");
    }
    if (job.status !== "active" && job.status !== "retryable") {
      return null;
    }
    const group = parseDishProposalGroupDocument(
      await transaction.getDocument(dishProposalGroupPath(job.groupId)),
    );
    if (
      group === null ||
      !groupHasSafeResolutionInputs(group) ||
      !jobMatchesActiveGroup(job, group)
    ) {
      throw new Error("Selected dish-proposal job lost its active group gate.");
    }
    return job;
  });
}

async function readJob(
  database: DishProposalPrivateDatabase,
  jobId: string,
): Promise<DishProposalJobDocument> {
  return database.runTransaction(async (transaction) => {
    const job = parseDishProposalJobDocument(
      await transaction.getDocument(dishProposalJobPath(jobId)),
    );
    if (job === null) {
      throw new Error("Dish-proposal job state is unavailable.");
    }
    return job;
  });
}

function jobMatchesActiveGroup(
  job: DishProposalJobDocument,
  group: DishProposalGroupDocument,
): boolean {
  return group.activeJobId === job.jobId &&
    group.activeResolutionType === job.resolutionType &&
    group.groupId === job.groupId &&
    group.proposalType === job.proposalType &&
    group.restaurantId === job.restaurantId &&
    group.sourceDishId === job.sourceDishId &&
    group.mergeTargetDishId === job.mergeTargetDishId &&
    group.normalizedProposedName === job.normalizedProposedName &&
    group.resolutionSequence === job.resolutionSequence &&
    group.cycleCutoffGeneration === job.cycleCutoffGeneration &&
    group.cycleCutoffAt?.getTime() === job.cycleCutoffAt.getTime();
}

function fixedResult(value: Omit<DishProposalActionResult, "contractVersion">) {
  return Object.freeze({
    contractVersion: dishProposalActionResultContractVersion,
    ...value,
  });
}

function inactiveResult(
  status: "stale" | "not_actionable",
): DishProposalActionResult {
  return fixedResult({
    accepted: false,
    status,
    resolutionType: null,
    processing: false,
    complete: false,
    manualReviewRequired: false,
    messageCategory: status === "stale" ? "stale_group" : "not_actionable",
  });
}

function resultForJobStatus(
  status: DishProposalJobDocument["status"],
  resolutionType: DishProposalResolutionType,
  accepted: boolean,
): DishProposalActionResult {
  if (status === "active") {
    return fixedResult({
      accepted,
      status: resolutionType === "apply" ? "applying" : "rejecting",
      resolutionType,
      processing: true,
      complete: false,
      manualReviewRequired: false,
      messageCategory: accepted
        ? "accepted_processing"
        : "already_processing",
    });
  }
  if (status === "retryable") {
    return fixedResult({
      accepted,
      status: "retryable",
      resolutionType,
      processing: true,
      complete: false,
      manualReviewRequired: false,
      messageCategory: "retryable_processing",
    });
  }
  if (status === "manual_review_required") {
    return fixedResult({
      accepted,
      status: "manual_review_required",
      resolutionType,
      processing: false,
      complete: false,
      manualReviewRequired: true,
      messageCategory: "manual_review_required",
    });
  }
  if (!accepted) {
    return inactiveResult("not_actionable");
  }
  return fixedResult({
    accepted: true,
    status: "complete",
    resolutionType,
    processing: false,
    complete: true,
    manualReviewRequired: false,
    messageCategory: "accepted_complete",
  });
}

async function executeManualAction(
  rawRequest: unknown,
  resolutionType: DishProposalResolutionType,
  context: RatingAdminDishSuggestionActionHandlerContext,
): Promise<DishProposalActionResult> {
  const request = parseActionRequest(rawRequest);
  const now = currentTime(context.now);
  const observation: GroupGuardObservation = {
    decision: "missing",
    group: null,
  };
  const claim = resolutionType === "apply"
    ? context.claimApply ?? claimDishProposalGroupForApply
    : context.claimReject ?? claimDishProposalGroupForReject;
  try {
    const claimResult = await claim(
      manualClaimDatabase(
        context.privateDatabase,
        request,
        resolutionType,
        observation,
      ),
      request.groupId,
      now,
    );
    if (!claimResult.claimed || claimResult.jobId === null) {
      if (
        observation.decision === "already_active" &&
        observation.group?.activeJobId !== null &&
        observation.group?.activeJobId !== undefined
      ) {
        const job = await readJob(
          context.privateDatabase,
          observation.group.activeJobId,
        );
        if (!jobMatchesActiveGroup(job, observation.group)) {
          throw new Error("Dish-proposal group and job state do not match.");
        }
        return resultForJobStatus(job.status, job.resolutionType, false);
      }
      if (observation.decision === "stale") {
        return inactiveResult("stale");
      }
      return inactiveResult("not_actionable");
    }
    const step = context.processStep ?? processDishProposalJobStep;
    const stepResult = await step(
      context.resolutionDependencies,
      claimResult.jobId,
      now,
    );
    return resultForJobStatus(stepResult.status, resolutionType, true);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError(
      "failed-precondition",
      "Dish suggestion state is unavailable.",
    );
  }
}

export function applyRatingAdminDishSuggestionGroupHandler(
  rawRequest: unknown,
  context: RatingAdminDishSuggestionActionHandlerContext,
): Promise<DishProposalActionResult> {
  return executeManualAction(rawRequest, "apply", context);
}

export function rejectRatingAdminDishSuggestionGroupHandler(
  rawRequest: unknown,
  context: RatingAdminDishSuggestionActionHandlerContext,
): Promise<DishProposalActionResult> {
  return executeManualAction(rawRequest, "reject", context);
}

export type DishProposalRuntimeFilter = Readonly<{
  field: string;
  operator: Extract<WhereFilterOp, "==" | "<=" | "in">;
  value: unknown;
}>;

export type DishProposalRuntimeOrder = Readonly<{
  field: string;
  direction: "asc" | "desc";
}>;

export type DishProposalRuntimeQuery = Readonly<{
  collectionPath: string;
  where: readonly DishProposalRuntimeFilter[];
  orderBy: readonly DishProposalRuntimeOrder[];
  limit: number;
}>;

export interface DishProposalRuntimeDiscoveryDatabase {
  queryDocuments(
    query: DishProposalRuntimeQuery,
  ): Promise<readonly DishProposalStoredDocument[]>;
}

function firestoreField(field: string): string | FieldPath {
  return field === "__name__" ? FieldPath.documentId() : field;
}

export function createFirestoreDishProposalRuntimeDiscoveryDatabase(
  firestore: Firestore,
): DishProposalRuntimeDiscoveryDatabase {
  return {
    async queryDocuments(options) {
      if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
        throw new Error("Dish-proposal runtime query limit is invalid.");
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
        createTime: document.createTime.toDate(),
      }));
    },
  };
}

export type DishProposalScheduledWorkSummary = Readonly<{
  selectedExistingJobs: number;
  selectedDueGroups: number;
  processedExistingJobs: number;
  claimedDueGroups: number;
  processedDueGroups: number;
  failures: number;
}>;

export type DishProposalScheduledWorkHandlerContext = Readonly<{
  discoveryDatabase: DishProposalRuntimeDiscoveryDatabase;
  privateDatabase: DishProposalPrivateDatabase;
  resolutionDependencies: DishProposalResolutionDependencies;
  now?: () => Date;
  claimApply?: ClaimFunction;
  processStep?: ProcessStepFunction;
}>;

export async function processDishProposalResolutionWorkHandler(
  context: DishProposalScheduledWorkHandlerContext,
): Promise<DishProposalScheduledWorkSummary> {
  const now = currentTime(context.now);
  const activeDocuments = (
    await context.discoveryDatabase.queryDocuments({
      collectionPath: dishProposalJobCollection,
      where: [{
        field: "status",
        operator: "in",
        value: ["active", "retryable"],
      }],
      orderBy: [
        {field: "updatedAt", direction: "asc"},
        {field: "__name__", direction: "asc"},
      ],
      limit: dishProposalScheduledExistingJobLimit,
    })
  ).slice(0, dishProposalScheduledExistingJobLimit);
  let processedExistingJobs = 0;
  let failures = 0;
  const step = context.processStep ?? processDishProposalJobStep;
  for (const document of activeDocuments) {
    try {
      const selectedJob = parseDishProposalJobDocument(document);
      if (
        selectedJob === null ||
        (selectedJob.status !== "active" &&
          selectedJob.status !== "retryable")
      ) {
        throw new Error("Selected dish-proposal job is not runnable.");
      }
      const job = await readRunnableJobWithActiveGroup(
        context.privateDatabase,
        selectedJob.jobId,
      );
      if (job === null) {
        continue;
      }
      await step(context.resolutionDependencies, job.jobId, now);
      processedExistingJobs += 1;
    } catch {
      failures += 1;
    }
  }

  const dueCapacity = dishProposalScheduledWorkLimit - activeDocuments.length;
  const dueDocuments = (
    await context.discoveryDatabase.queryDocuments({
      collectionPath: dishProposalGroupCollection,
      where: [
        {
          field: "resolutionIdentitiesValid",
          operator: "==",
          value: true,
        },
        {field: "autoEligible", operator: "==", value: true},
        {field: "dueAt", operator: "<=", value: now},
      ],
      orderBy: [
        {field: "dueAt", direction: "asc"},
        {field: "__name__", direction: "asc"},
      ],
      limit: dueCapacity,
    })
  ).slice(0, dueCapacity);
  let claimedDueGroups = 0;
  let processedDueGroups = 0;
  const claimApply = context.claimApply ?? claimDishProposalGroupForApply;
  for (const document of dueDocuments) {
    try {
      const selectedGroup = parseDishProposalGroupDocument(document);
      if (
        selectedGroup === null ||
        !groupHasSafeResolutionInputs(selectedGroup) ||
        !selectedGroup.hasPendingMembers ||
        !selectedGroup.enoughSupporters ||
        !selectedGroup.autoEligible ||
        selectedGroup.activeJobId !== null ||
        selectedGroup.dueAt === null ||
        selectedGroup.dueAt.getTime() > now.getTime()
      ) {
        throw new Error("Selected dish-proposal group is not automatic.");
      }
      const observation: GroupGuardObservation = {
        decision: "missing",
        group: null,
      };
      const claim = await claimApply(
        automaticClaimDatabase(
          context.privateDatabase,
          selectedGroup,
          now,
          observation,
        ),
        selectedGroup.groupId,
        now,
      );
      if (!claim.claimed || claim.jobId === null) {
        continue;
      }
      claimedDueGroups += 1;
      await step(context.resolutionDependencies, claim.jobId, now);
      processedDueGroups += 1;
    } catch {
      failures += 1;
    }
  }
  return Object.freeze({
    selectedExistingJobs: activeDocuments.length,
    selectedDueGroups: dueDocuments.length,
    processedExistingJobs,
    claimedDueGroups,
    processedDueGroups,
    failures,
  });
}
