import {randomUUID} from "node:crypto";
import {HttpsError} from "firebase-functions/v2/https";
import {
  adminUserClaimedRestaurantCollection, adminUserDirectoryCollection, adminUserDirectoryVersion,
  adminUserSourceKinds, adminUserSourceSummaryCollection, exactAdminUserUid,
  isAdminUserSourceKind, requireAdminUserProgressSize, type AdminUserSourceKind,
} from "./admin_user_directory_contract.js";
import {effectiveAdminUserSourceUid, readAdminUserDate} from "./admin_user_directory_builders.js";
import {
  advanceAdminUserSource, adminUserScanPageSize, adminUserSourceConfigurations, hasAdminUserRestaurantOwnerValue,
  parseAdminUserWork, prepareAdminUserWork, reconcileAdminUserClaimedRestaurantInTransaction,
  setAdminUserProgress,
  type AdminUserDirectoryDatabase, type AdminUserDirectoryTransaction,
} from "./admin_user_directory_maintenance.js";

export const adminUserVerificationPath = `${adminUserSourceSummaryCollection}/auverify_v1`;
export const adminUserVerificationMaximumSteps = 20;
export const adminUserVerificationAdmissionMillis = 3_000;
const version = "bitestar.admin-user-verification.v1";
type Verification = {
  verificationVersion: string;
  passId: string;
  revision: string;
  status: "pending" | "paused" | "failed" | "complete";
  family: number;
  cursor: string | null;
  examined: number;
  steps: number;
  startedAt: Date;
  updatedAt: Date;
  lastCompletedAt: Date | null;
};
const families = [
  ...adminUserSourceKinds.map(kind => ({collection: adminUserSourceConfigurations[kind].collectionPath, kind})),
  {collection: adminUserDirectoryCollection, kind: null},
  {collection: adminUserSourceSummaryCollection, kind: null},
  {collection: adminUserClaimedRestaurantCollection, kind: null},
];

function readState(data: Readonly<Record<string, unknown>> | undefined): Verification | null {
  if (!data) return null;
  requireAdminUserProgressSize(data);
  if (data.verificationVersion !== version || typeof data.passId !== "string" || typeof data.revision !== "string" ||
      !["pending", "paused", "failed", "complete"].includes(String(data.status)) ||
      !Number.isInteger(data.family) || (data.family as number) < 0 || (data.family as number) > families.length ||
      !(data.cursor === null || typeof data.cursor === "string") ||
      !Number.isSafeInteger(data.examined) || !Number.isSafeInteger(data.steps)) {
    throw new HttpsError("failed-precondition", "Directory verification state needs review.");
  }
  const startedAt = readAdminUserDate(data.startedAt), updatedAt = readAdminUserDate(data.updatedAt);
  if (!startedAt || !updatedAt) throw new HttpsError("failed-precondition", "Invalid verification timestamps.");
  return {...data, startedAt, updatedAt, lastCompletedAt: readAdminUserDate(data.lastCompletedAt)} as Verification;
}
function status(state: Verification | null): Readonly<Record<string, unknown>> {
  return {schemaVersion: 1, passId: state?.passId ?? null, revision: state?.revision ?? null,
    status: state?.status ?? "notStarted", phase: state?.family === families.length ? "reconciling" : "discovering",
    examined: state?.examined ?? 0, steps: state?.steps ?? 0,
    lastCompletedAtMillis: state?.lastCompletedAt?.getTime() ?? null,
    updatedAtMillis: state?.updatedAt.getTime() ?? null};
}

/** One atomic bounded discovery/work page within a foreground request.
 * The control document serializes concurrent Admin requests with that page's
 * progress. No lease, scheduler, source rewrite or background loop is needed. */
async function step(tx: AdminUserDirectoryTransaction, state: Verification, now: Date): Promise<Verification> {
  const next = {...state, revision: randomUUID(), steps: state.steps + 1, updatedAt: now};
  if (state.family < families.length) {
    const family = families[state.family];
    const rows = await tx.queryDocuments({collectionPath: family.collection,
      orderBy: [{field: "__name__", direction: "asc"}], limit: adminUserScanPageSize,
      ...(family.collection === adminUserSourceSummaryCollection ? {idPrefix: "auss_"} : {}),
      ...(state.cursor === null ? {} : {startAfter: state.cursor})});
    const scopes = new Map<string, {uid: string; sourceKind: AdminUserSourceKind} | {restaurantId: string}>();
    const person = (raw: unknown, sourceKind?: AdminUserSourceKind) => {
      const uid = exactAdminUserUid(raw);
      if (uid === null) return;
      for (const kind of sourceKind ? [sourceKind] : adminUserSourceKinds) scopes.set(JSON.stringify([uid, kind]), {uid, sourceKind: kind});
    };
    const restaurant = (id: unknown) => {
      if (typeof id === "string" && id.length && !id.includes("/") && id !== "." && id !== "..") scopes.set(JSON.stringify(["restaurant", id]), {restaurantId: id});
    };
    for (const row of rows) {
      if (family.kind) {
        person(effectiveAdminUserSourceUid(family.kind, row.id, row.data), family.kind);
        if (family.kind === "biteScoreRestaurant" && hasAdminUserRestaurantOwnerValue(row.data)) restaurant(row.id);
      } else if (family.collection === adminUserDirectoryCollection) {
        // Hints only: full source, summary and relationship censuses remain authoritative.
        const kinds = row.data.sourceKinds;
        if (row.data.directoryVersion === adminUserDirectoryVersion && row.data.uid === row.id &&
            Array.isArray(kinds) && kinds.length > 0 && kinds.length <= adminUserSourceKinds.length &&
            kinds.every(isAdminUserSourceKind)) {
          for (const kind of kinds) person(row.id, kind);
        } else person(row.id); // Unknown/inconsistent metadata keeps the conservative all-kind repair.
      }
      else if (family.collection === adminUserSourceSummaryCollection) {
        if (isAdminUserSourceKind(row.data.sourceKind)) person(row.data.uid, row.data.sourceKind);
      } else {restaurant(row.data.sourceRestaurantId); person(row.data.ownerUid, "biteScoreRestaurant");}
    }
    // Do not issue writes until every registration/fence read has completed.
    const writes: (() => void)[] = [];
    const fencedUids = new Set<string>();
    for (const scope of scopes.values()) writes.push(await prepareAdminUserWork(tx, scope, now, {verificationId: state.passId, fencedUids}));
    writes.forEach(apply => apply());
    next.examined += rows.length;
    if (rows.length < adminUserScanPageSize) {next.family++; next.cursor = null;}
    else next.cursor = rows[rows.length - 1].id;
    return next;
  }
  const rows = await tx.queryDocuments({collectionPath: adminUserSourceSummaryCollection,
    idPrefix: "auw_", orderBy: [{field: "__name__", direction: "asc"}], limit: 1,
    ...(state.cursor === null ? {} : {startAfter: state.cursor})});
  if (rows.length === 0) {
    // Work invalidated behind this pass's cursor is not silently abandoned.
    const pending = await tx.queryDocuments({collectionPath: adminUserSourceSummaryCollection,
      where: {field: "state", value: "pending"}, orderBy: [{field: "__name__", direction: "asc"}], limit: 1});
    if (pending.length) {parseAdminUserWork(pending[0]); next.cursor = null;}
    else {next.status = "complete"; next.lastCompletedAt = now;}
    return next;
  }
  const work = parseAdminUserWork(rows[0])!;
  let complete = work.state === "complete";
  if (work.workType === "source") complete = (await advanceAdminUserSource(tx, work, now)).state === "complete";
  else if (!complete) {
    await reconcileAdminUserClaimedRestaurantInTransaction(tx, work.restaurantId!, now);
    setAdminUserProgress(tx, `${adminUserSourceSummaryCollection}/${rows[0].id}`, {...work, state: "complete", updatedAt: now});
    complete = true;
  }
  if (complete) next.cursor = rows[0].id;
  return next;
}

type VerificationRequest = Record<string, unknown>;
type AtomicResult = {state: Verification | null; advanced: boolean};

/** Commits one step and reports whether THIS request advanced, never a competing caller. */
async function atomicRequest(database: AdminUserDirectoryDatabase,
  request: VerificationRequest, now: Date): Promise<AtomicResult> {
  let attempted: Verification | null = null;
  try {
    return await database.runTransaction(async tx => {
      const current = readState((await tx.getDocument(adminUserVerificationPath))?.data);
      attempted = null; // A retry must not retain an earlier attempt's revision.
      if (request.action === "status") return {state: current, advanced: false};
      let next = current;
      let advanced = false;
      if (request.action === "start") {
        next = !current || current.status === "complete" ? {
          verificationVersion: version, passId: randomUUID(), revision: randomUUID(), status: "pending",
          family: 0, cursor: null, examined: 0, steps: 0, startedAt: now, updatedAt: now,
          lastCompletedAt: current?.lastCompletedAt ?? null,
        } : {...current, status: "pending", revision: randomUUID(), updatedAt: now};
      } else if (!current || request.passId !== current.passId || request.revision !== current.revision) {
        return {state: current, advanced: false};
      } else if (request.action === "pause") {
        if (current.status === "complete") return {state: current, advanced: false};
        next = {...current, status: "paused", revision: randomUUID(), updatedAt: now};
      } else if (current.status === "pending") {
        attempted = current;
        next = await step(tx, current, now);
        advanced = true;
      } else return {state: current, advanced: false};
      if (next) setAdminUserProgress(tx, adminUserVerificationPath, next);
      return {state: next, advanced};
    });
  } catch (error) {
    // Earlier burst steps stay committed; never overwrite a newer batch/pause.
    const failed = attempted as Verification | null;
    if (failed) {
      try {
        return await database.runTransaction(async tx => {
          const current = readState((await tx.getDocument(adminUserVerificationPath))?.data);
          if (current?.passId !== failed.passId || current.revision !== failed.revision) return {state: current, advanced: false};
          const next = {...current, status: "failed" as const, revision: randomUUID(), updatedAt: now};
          setAdminUserProgress(tx, adminUserVerificationPath, next);
          return {state: next, advanced: false};
        });
      } catch { /* A failed status write must not acknowledge successful work. */ }
    }
    throw error;
  }
}

export async function verifyAdminUserDirectoryHandler(database: AdminUserDirectoryDatabase,
  raw: unknown, now: Date | (() => Date) = () => new Date(),
  execution: {monotonicNow?: () => number; assertAccess?: () => void} = {},
): Promise<Readonly<Record<string, unknown>>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpsError("invalid-argument", "Invalid verification request.");
  let request = raw as VerificationRequest;
  if (request.schemaVersion !== 1 || !["status", "start", "continue", "pause"].includes(String(request.action)) ||
      Object.keys(request).some(key => !["schemaVersion", "action", "passId", "revision"].includes(key)) ||
      ((request.action === "continue" || request.action === "pause") &&
        (typeof request.passId !== "string" || typeof request.revision !== "string"))) {
    throw new HttpsError("invalid-argument", "Invalid verification request.");
  }
  const clock = execution.monotonicNow ?? (() => performance.now());
  const started = clock();
  for (let count = 0; ; count++) {
    // The callable supplies the existing authorization boundary. A rejection stops
    // before the next transaction; request-auth is not a live token-revocation feed.
    execution.assertAccess?.();
    const result = await atomicRequest(database, request, typeof now === "function" ? now() : now);
    if (request.action !== "continue" || !result.advanced || result.state?.status !== "pending" ||
        count + 1 >= adminUserVerificationMaximumSteps || clock() - started >= adminUserVerificationAdmissionMillis) {
      return status(result.state);
    }
    request = {...request, passId: result.state.passId, revision: result.state.revision};
  }
}
