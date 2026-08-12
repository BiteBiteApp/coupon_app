import {createHash} from "node:crypto";

import type Stripe from "stripe";

import {
  buildOwnerRecordStateDocument,
  type OwnerRecordStateDocument,
  type OwnerRecordStateStoredDocument,
  parseOwnerRecordStateDocument,
  requireOwnerRecordGeneration,
  requireOwnerRecordUid,
} from "./owner_record_state_contract.js";

export const ownerBillingStateCollection =
  "private_owner_billing_states" as const;
export const ownerBillingStateVersion =
  "bitestar.owner-billing-state.v1" as const;

export type OwnerBillingLifecycleState =
  | "none"
  | "checkout_pending"
  | "subscription_known"
  | "unknown";

export type OwnerBillingPosture = "inactive" | "blocking" | "unknown";
export type OwnerBillingRawStripeStatus = Stripe.Subscription.Status;
export type OwnerBillingStripeEventConflictKind =
  | "event_order"
  | "identity"
  | "unsupported_status";

export type OwnerBillingStateDocument = Readonly<{
  version: typeof ownerBillingStateVersion;
  ownerUid: string;
  ownerRecordGeneration: number;
  lifecycleState: OwnerBillingLifecycleState;
  rawStripeStatus: OwnerBillingRawStripeStatus | null;
  billingPosture: OwnerBillingPosture;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  checkoutAttemptId: string | null;
  checkoutRequestFingerprint: string | null;
  checkoutAttemptCreatedAt: Date | null;
  checkoutSessionId: string | null;
  lastStripeEventCreated: number | null;
  lastStripeEventId: string | null;
  lastStripeEventPayloadFingerprint: string | null;
  stripeEventConflictKind: OwnerBillingStripeEventConflictKind | null;
  createdAt: Date;
  updatedAt: Date;
  fingerprint: string;
}>;

export type OwnerBillingStateStoredDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type OwnerBillingStateCore = Omit<
  OwnerBillingStateDocument,
  "version" | "fingerprint"
>;

export class OwnerBillingStateContractError extends Error {
  public readonly code: "invalid-request" | "invalid-state";

  public constructor(code: "invalid-request" | "invalid-state") {
    super(code === "invalid-state"
      ? "Stored owner billing state is invalid."
      : "Owner billing state request is invalid.");
    this.name = "OwnerBillingStateContractError";
    this.code = code;
  }
}

const rawStripeStatusPostures = Object.freeze({
  active: "blocking",
  canceled: "inactive",
  incomplete: "blocking",
  incomplete_expired: "inactive",
  past_due: "blocking",
  paused: "blocking",
  trialing: "blocking",
  unpaid: "blocking",
} satisfies Record<Stripe.Subscription.Status, Exclude<OwnerBillingPosture, "unknown">>);

export const ownerBillingRawStripeStatuses = Object.freeze(
  Object.keys(rawStripeStatusPostures) as OwnerBillingRawStripeStatus[],
);

const coreKeys = Object.freeze([
  "ownerUid",
  "ownerRecordGeneration",
  "lifecycleState",
  "rawStripeStatus",
  "billingPosture",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "checkoutAttemptId",
  "checkoutRequestFingerprint",
  "checkoutAttemptCreatedAt",
  "checkoutSessionId",
  "lastStripeEventCreated",
  "lastStripeEventId",
  "lastStripeEventPayloadFingerprint",
  "stripeEventConflictKind",
  "createdAt",
  "updatedAt",
] as const);

function fail(code: "invalid-request" | "invalid-state"): never {
  throw new OwnerBillingStateContractError(code);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function exactIdentifier(
  value: unknown,
  prefix: string | null,
  maximumBytes: number,
  code: "invalid-request" | "invalid-state",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (prefix !== null && !value.startsWith(prefix)) ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f/]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    return fail(code);
  }
  if (
    (prefix === "cus_" && !/^cus_[A-Za-z0-9]+$/u.test(value)) ||
    (prefix === "sub_" && !/^sub_[A-Za-z0-9]+$/u.test(value)) ||
    (prefix === "cs_" &&
      !/^cs_(?:(?:test|live)_)?[A-Za-z0-9]+$/u.test(value)) ||
    (prefix === "evt_" && !/^evt_[A-Za-z0-9]+$/u.test(value)) ||
    (prefix === null && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value))
  ) {
    return fail(code);
  }
  return value;
}

function nullableIdentifier(
  value: unknown,
  prefix: string | null,
  maximumBytes: number,
  code: "invalid-request" | "invalid-state",
): string | null {
  return value === null
    ? null
    : exactIdentifier(value, prefix, maximumBytes, code);
}

function exactFingerprint(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    return fail(code);
  }
  return value;
}

function nullableFingerprint(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): string | null {
  return value === null ? null : exactFingerprint(value, code);
}

function lifecycleState(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerBillingLifecycleState {
  if (
    value !== "none" && value !== "checkout_pending" &&
    value !== "subscription_known" && value !== "unknown"
  ) {
    return fail(code);
  }
  return value;
}

function billingPosture(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerBillingPosture {
  if (value !== "inactive" && value !== "blocking" && value !== "unknown") {
    return fail(code);
  }
  return value;
}

function rawStripeStatus(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerBillingRawStripeStatus | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !Object.prototype.hasOwnProperty.call(rawStripeStatusPostures, value)
  ) {
    return fail(code);
  }
  return value as OwnerBillingRawStripeStatus;
}

function stripeEventConflictKind(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerBillingStripeEventConflictKind | null {
  if (
    value === null ||
    value === "event_order" ||
    value === "identity" ||
    value === "unsupported_status"
  ) {
    return value;
  }
  return fail(code);
}

function timestamp(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): Date {
  let parsed: unknown = value;
  if (!(parsed instanceof Date)) {
    const timestampLike = record(parsed);
    if (timestampLike === null || typeof timestampLike.toDate !== "function") {
      return fail(code);
    }
    try {
      parsed = (timestampLike.toDate as () => unknown)();
    } catch {
      return fail(code);
    }
  }
  if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) {
    return fail(code);
  }
  return new Date(parsed.getTime());
}

function nullableTimestamp(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): Date | null {
  return value === null ? null : timestamp(value, code);
}

function eventCreated(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return fail(code);
  }
  return value;
}

function nullableEventCreated(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): number | null {
  return value === null ? null : eventCreated(value, code);
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return {"$date": value.toISOString()};
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const data = record(value);
  if (data !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(data).sort()) {
      result[key] = canonicalize(data[key]);
    }
    return result;
  }
  return value;
}

function fingerprint(core: OwnerBillingStateCore): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({
      version: ownerBillingStateVersion,
      core,
    })), "utf8")
    .digest("hex");
}

function allNull(values: readonly unknown[]): boolean {
  return values.every((value) => value === null);
}

function allPresent(values: readonly unknown[]): boolean {
  return values.every((value) => value !== null);
}

function assertRelationships(
  value: OwnerBillingStateCore,
  code: "invalid-request" | "invalid-state",
): void {
  const attemptFields = [
    value.checkoutAttemptId,
    value.checkoutRequestFingerprint,
    value.checkoutAttemptCreatedAt,
  ];
  const eventFields = [
    value.lastStripeEventCreated,
    value.lastStripeEventId,
    value.lastStripeEventPayloadFingerprint,
  ];
  if (!allNull(attemptFields) && !allPresent(attemptFields)) {
    fail(code);
  }
  if (!allNull(eventFields) && !allPresent(eventFields)) {
    fail(code);
  }
  if (value.checkoutSessionId !== null && !allPresent(attemptFields)) {
    fail(code);
  }
  if (
    value.stripeEventConflictKind !== null &&
    (value.lifecycleState !== "unknown" ||
      !allPresent(eventFields) ||
      !allPresent(attemptFields) ||
      value.stripeCustomerId === null ||
      value.stripeSubscriptionId === null)
  ) {
    fail(code);
  }
  if (
    value.checkoutAttemptCreatedAt !== null &&
    (value.checkoutAttemptCreatedAt.getTime() < value.createdAt.getTime() ||
      value.checkoutAttemptCreatedAt.getTime() > value.updatedAt.getTime())
  ) {
    fail(code);
  }

  switch (value.lifecycleState) {
  case "none":
    if (
      value.billingPosture !== "inactive" ||
      !allNull([
        value.rawStripeStatus,
        value.stripeCustomerId,
        value.stripeSubscriptionId,
        ...attemptFields,
        value.checkoutSessionId,
        ...eventFields,
        value.stripeEventConflictKind,
      ])
    ) {
      fail(code);
    }
    break;
  case "checkout_pending":
    if (
      value.billingPosture !== "blocking" ||
      value.rawStripeStatus !== null ||
      value.stripeSubscriptionId !== null ||
      !allPresent(attemptFields) ||
      !allNull(eventFields) ||
      value.stripeEventConflictKind !== null
    ) {
      fail(code);
    }
    break;
  case "subscription_known":
    if (
      value.rawStripeStatus === null ||
      value.billingPosture !==
        rawStripeStatusPostures[value.rawStripeStatus] ||
      value.stripeCustomerId === null ||
      value.stripeSubscriptionId === null ||
      !allPresent(attemptFields) ||
      !allPresent(eventFields) ||
      value.stripeEventConflictKind !== null
    ) {
      fail(code);
    }
    break;
  case "unknown":
    if (value.billingPosture !== "unknown") {
      fail(code);
    }
    if (
      value.rawStripeStatus !== null &&
      (value.stripeCustomerId === null ||
        value.stripeSubscriptionId === null ||
        !allPresent(eventFields))
    ) {
      fail(code);
    }
    if (
      value.stripeSubscriptionId !== null &&
      (value.stripeCustomerId === null ||
        !allPresent(eventFields) ||
        !allPresent(attemptFields))
    ) {
      fail(code);
    }
    break;
  }
}

function readCore(
  value: unknown,
  code: "invalid-request" | "invalid-state",
): OwnerBillingStateCore {
  const data = record(value);
  if (data === null || !hasExactKeys(data, coreKeys)) {
    return fail(code);
  }
  let ownerUid: string;
  let ownerRecordGeneration: number;
  try {
    ownerUid = requireOwnerRecordUid(data.ownerUid);
    ownerRecordGeneration = requireOwnerRecordGeneration(
      data.ownerRecordGeneration,
    );
  } catch {
    return fail(code);
  }
  const createdAt = timestamp(data.createdAt, code);
  const updatedAt = timestamp(data.updatedAt, code);
  if (updatedAt.getTime() < createdAt.getTime()) {
    return fail(code);
  }
  const core: OwnerBillingStateCore = Object.freeze({
    ownerUid,
    ownerRecordGeneration,
    lifecycleState: lifecycleState(data.lifecycleState, code),
    rawStripeStatus: rawStripeStatus(data.rawStripeStatus, code),
    billingPosture: billingPosture(data.billingPosture, code),
    stripeCustomerId: nullableIdentifier(
      data.stripeCustomerId,
      "cus_",
      255,
      code,
    ),
    stripeSubscriptionId: nullableIdentifier(
      data.stripeSubscriptionId,
      "sub_",
      255,
      code,
    ),
    checkoutAttemptId: nullableIdentifier(
      data.checkoutAttemptId,
      null,
      128,
      code,
    ),
    checkoutRequestFingerprint: nullableFingerprint(
      data.checkoutRequestFingerprint,
      code,
    ),
    checkoutAttemptCreatedAt: nullableTimestamp(
      data.checkoutAttemptCreatedAt,
      code,
    ),
    checkoutSessionId: nullableIdentifier(
      data.checkoutSessionId,
      "cs_",
      255,
      code,
    ),
    lastStripeEventCreated: nullableEventCreated(
      data.lastStripeEventCreated,
      code,
    ),
    lastStripeEventId: nullableIdentifier(
      data.lastStripeEventId,
      "evt_",
      255,
      code,
    ),
    lastStripeEventPayloadFingerprint: nullableFingerprint(
      data.lastStripeEventPayloadFingerprint,
      code,
    ),
    stripeEventConflictKind: stripeEventConflictKind(
      data.stripeEventConflictKind,
      code,
    ),
    createdAt,
    updatedAt,
  });
  assertRelationships(core, code);
  return core;
}

function validOwnerRecordState(
  state: OwnerRecordStateDocument,
): OwnerRecordStateDocument | null {
  try {
    if (state.version !== "bitestar.owner-record-state.v1") {
      return null;
    }
    const rebuilt = buildOwnerRecordStateDocument({
      ownerUid: state.ownerUid,
      generation: state.generation,
      state: state.state,
      activeJobId: state.activeJobId,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    });
    return rebuilt.fingerprint === state.fingerprint ? rebuilt : null;
  } catch {
    return null;
  }
}

function validBillingState(
  state: OwnerBillingStateDocument,
): OwnerBillingStateDocument | null {
  try {
    if (state.version !== ownerBillingStateVersion) {
      return null;
    }
    const rebuilt = buildOwnerBillingStateDocument({
      ownerUid: state.ownerUid,
      ownerRecordGeneration: state.ownerRecordGeneration,
      lifecycleState: state.lifecycleState,
      rawStripeStatus: state.rawStripeStatus,
      billingPosture: state.billingPosture,
      stripeCustomerId: state.stripeCustomerId,
      stripeSubscriptionId: state.stripeSubscriptionId,
      checkoutAttemptId: state.checkoutAttemptId,
      checkoutRequestFingerprint: state.checkoutRequestFingerprint,
      checkoutAttemptCreatedAt: state.checkoutAttemptCreatedAt,
      checkoutSessionId: state.checkoutSessionId,
      lastStripeEventCreated: state.lastStripeEventCreated,
      lastStripeEventId: state.lastStripeEventId,
      lastStripeEventPayloadFingerprint:
        state.lastStripeEventPayloadFingerprint,
      stripeEventConflictKind: state.stripeEventConflictKind,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    });
    return rebuilt.fingerprint === state.fingerprint ? rebuilt : null;
  } catch {
    return null;
  }
}

/** Exact installed Stripe-status classifier; unknown input never becomes inactive. */
export function classifyOwnerBillingRawStripeStatus(
  value: unknown,
): OwnerBillingPosture {
  if (
    typeof value !== "string" ||
    !Object.prototype.hasOwnProperty.call(rawStripeStatusPostures, value)
  ) {
    return "unknown";
  }
  return rawStripeStatusPostures[value as OwnerBillingRawStripeStatus];
}

export function buildOwnerBillingStateDocument(
  value: OwnerBillingStateCore,
): OwnerBillingStateDocument {
  const core = readCore(value, "invalid-request");
  return Object.freeze({
    version: ownerBillingStateVersion,
    ...core,
    fingerprint: fingerprint(core),
  });
}

export function parseOwnerBillingStateDocument(
  document: OwnerBillingStateStoredDocument | null,
): OwnerBillingStateDocument | null {
  if (document === null) {
    return null;
  }
  try {
    const data = record(document.data);
    if (
      data === null ||
      !hasExactKeys(data, ["version", ...coreKeys, "fingerprint"]) ||
      data.version !== ownerBillingStateVersion ||
      typeof data.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/u.test(data.fingerprint)
    ) {
      return fail("invalid-state");
    }
    const coreData = {...data};
    delete coreData.version;
    delete coreData.fingerprint;
    const core = readCore(coreData, "invalid-state");
    if (
      requireOwnerRecordUid(document.id) !== core.ownerUid ||
      data.fingerprint !== fingerprint(core)
    ) {
      return fail("invalid-state");
    }
    return Object.freeze({
      version: ownerBillingStateVersion,
      ...core,
      fingerprint: data.fingerprint,
    });
  } catch {
    return fail("invalid-state");
  }
}

/** Explicit final-schema initialization for an open owner generation. */
export function createInitialOwnerBillingState(
  ownerUid: string,
  ownerRecordGeneration: number,
  now: Date,
): OwnerBillingStateDocument {
  return buildOwnerBillingStateDocument({
    ownerUid: requireOwnerRecordUid(ownerUid),
    ownerRecordGeneration: requireOwnerRecordGeneration(
      ownerRecordGeneration,
    ),
    lifecycleState: "none",
    rawStripeStatus: null,
    billingPosture: "inactive",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    checkoutAttemptId: null,
    checkoutRequestFingerprint: null,
    checkoutAttemptCreatedAt: null,
    checkoutSessionId: null,
    lastStripeEventCreated: null,
    lastStripeEventId: null,
    lastStripeEventPayloadFingerprint: null,
    stripeEventConflictKind: null,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Initializes only an absent final-schema billing record. Existing records
 * must bind exactly to the supplied open owner generation.
 */
export function initializeOwnerBillingState(
  document: OwnerBillingStateStoredDocument | null,
  ownerState: OwnerRecordStateDocument,
  now: Date,
): Readonly<{state: OwnerBillingStateDocument; created: boolean}> {
  const validOwner = validOwnerRecordState(ownerState);
  if (validOwner === null || validOwner.state !== "open") {
    return fail("invalid-state");
  }
  const existing = parseOwnerBillingStateDocument(document);
  if (existing === null) {
    return Object.freeze({
      state: createInitialOwnerBillingState(
        validOwner.ownerUid,
        validOwner.generation,
        now,
      ),
      created: true,
    });
  }
  if (
    existing.ownerUid !== validOwner.ownerUid ||
    existing.ownerRecordGeneration !== validOwner.generation
  ) {
    return fail("invalid-state");
  }
  return Object.freeze({state: existing, created: false});
}

export type OwnerBillingCheckoutPendingInput = Readonly<{
  checkoutAttemptId: string;
  checkoutRequestFingerprint: string;
  checkoutAttemptCreatedAt: Date;
  now: Date;
}>;

function transitionTime(
  current: OwnerBillingStateDocument,
  now: Date,
): Readonly<{current: OwnerBillingStateDocument; now: Date}> {
  const validCurrent = validBillingState(current);
  if (validCurrent === null) {
    return fail("invalid-state");
  }
  const parsedNow = timestamp(now, "invalid-request");
  if (parsedNow.getTime() < validCurrent.updatedAt.getTime()) {
    return fail("invalid-request");
  }
  return Object.freeze({current: validCurrent, now: parsedNow});
}

/** Creates the durable blocking reservation that must precede Stripe. */
export function createCheckoutPendingOwnerBillingState(
  current: OwnerBillingStateDocument,
  input: OwnerBillingCheckoutPendingInput,
): OwnerBillingStateDocument {
  const transition = transitionTime(current, input.now);
  const mayBeginCheckout =
    transition.current.lifecycleState === "none" ||
    (transition.current.lifecycleState === "subscription_known" &&
      transition.current.billingPosture === "inactive" &&
      (transition.current.rawStripeStatus === "canceled" ||
        transition.current.rawStripeStatus === "incomplete_expired"));
  if (!mayBeginCheckout) {
    return fail("invalid-state");
  }
  const stripeCustomerId =
    transition.current.lifecycleState === "subscription_known"
      ? transition.current.stripeCustomerId
      : null;
  return buildOwnerBillingStateDocument({
    ownerUid: transition.current.ownerUid,
    ownerRecordGeneration: transition.current.ownerRecordGeneration,
    lifecycleState: "checkout_pending",
    rawStripeStatus: null,
    billingPosture: "blocking",
    stripeCustomerId,
    stripeSubscriptionId: null,
    checkoutAttemptId: input.checkoutAttemptId,
    checkoutRequestFingerprint: input.checkoutRequestFingerprint,
    checkoutAttemptCreatedAt: input.checkoutAttemptCreatedAt,
    checkoutSessionId: null,
    lastStripeEventCreated: null,
    lastStripeEventId: null,
    lastStripeEventPayloadFingerprint: null,
    stripeEventConflictKind: null,
    createdAt: transition.current.createdAt,
    updatedAt: transition.now,
  });
}

/** Failed or uncertain external creation can never revert to inactive. */
export function markCheckoutUncertain(
  current: OwnerBillingStateDocument,
  now: Date,
): OwnerBillingStateDocument {
  const transition = transitionTime(current, now);
  if (
    (transition.current.lifecycleState !== "checkout_pending" &&
      transition.current.lifecycleState !== "unknown") ||
    transition.current.checkoutAttemptId === null ||
    transition.current.checkoutRequestFingerprint === null ||
    transition.current.checkoutAttemptCreatedAt === null ||
    transition.current.rawStripeStatus !== null ||
    transition.current.stripeSubscriptionId !== null ||
    transition.current.lastStripeEventCreated !== null ||
    transition.current.stripeEventConflictKind !== null
  ) {
    return fail("invalid-state");
  }
  return buildOwnerBillingStateDocument({
    ownerUid: transition.current.ownerUid,
    ownerRecordGeneration: transition.current.ownerRecordGeneration,
    lifecycleState: "unknown",
    rawStripeStatus: null,
    billingPosture: "unknown",
    stripeCustomerId: transition.current.stripeCustomerId,
    stripeSubscriptionId: null,
    checkoutAttemptId: transition.current.checkoutAttemptId,
    checkoutRequestFingerprint:
      transition.current.checkoutRequestFingerprint,
    checkoutAttemptCreatedAt: transition.current.checkoutAttemptCreatedAt,
    checkoutSessionId: transition.current.checkoutSessionId,
    lastStripeEventCreated: null,
    lastStripeEventId: null,
    lastStripeEventPayloadFingerprint: null,
    stripeEventConflictKind: null,
    createdAt: transition.current.createdAt,
    updatedAt: transition.now,
  });
}

export type OwnerBillingCheckoutSessionInput = Readonly<{
  checkoutSessionId: string;
  stripeCustomerId?: string | null;
  now: Date;
}>;

/** Stores exact Checkout identity but remains blocking until a webhook. */
export function recordCheckoutSession(
  current: OwnerBillingStateDocument,
  input: OwnerBillingCheckoutSessionInput,
): OwnerBillingStateDocument {
  const transition = transitionTime(current, input.now);
  if (
    (transition.current.lifecycleState !== "checkout_pending" &&
      transition.current.lifecycleState !== "unknown" &&
      transition.current.lifecycleState !== "subscription_known") ||
    transition.current.checkoutAttemptId === null ||
    transition.current.checkoutRequestFingerprint === null ||
    transition.current.checkoutAttemptCreatedAt === null
  ) {
    return fail("invalid-state");
  }
  const checkoutSessionId = exactIdentifier(
    input.checkoutSessionId,
    "cs_",
    255,
    "invalid-request",
  );
  const stripeCustomerId = input.stripeCustomerId === undefined ||
      input.stripeCustomerId === null
    ? transition.current.stripeCustomerId
    : exactIdentifier(
      input.stripeCustomerId,
      "cus_",
      255,
      "invalid-request",
    );
  if (
    (transition.current.checkoutSessionId !== null &&
      transition.current.checkoutSessionId !== checkoutSessionId) ||
    (transition.current.stripeCustomerId !== null &&
      transition.current.stripeCustomerId !== stripeCustomerId)
  ) {
    return fail("invalid-state");
  }
  const canResolveUncertainCheckout =
    transition.current.lifecycleState === "unknown" &&
    transition.current.rawStripeStatus === null &&
    transition.current.stripeSubscriptionId === null &&
    transition.current.lastStripeEventCreated === null &&
    transition.current.lastStripeEventId === null &&
    transition.current.lastStripeEventPayloadFingerprint === null &&
    transition.current.stripeEventConflictKind === null;
  const lifecycleState = canResolveUncertainCheckout ?
    "checkout_pending" :
    transition.current.lifecycleState;
  return buildOwnerBillingStateDocument({
    ownerUid: transition.current.ownerUid,
    ownerRecordGeneration: transition.current.ownerRecordGeneration,
    lifecycleState,
    rawStripeStatus: transition.current.rawStripeStatus,
    billingPosture: canResolveUncertainCheckout ?
      "blocking" :
      transition.current.billingPosture,
    stripeCustomerId,
    stripeSubscriptionId: transition.current.stripeSubscriptionId,
    checkoutAttemptId: transition.current.checkoutAttemptId,
    checkoutRequestFingerprint:
      transition.current.checkoutRequestFingerprint,
    checkoutAttemptCreatedAt: transition.current.checkoutAttemptCreatedAt,
    checkoutSessionId,
    lastStripeEventCreated: transition.current.lastStripeEventCreated,
    lastStripeEventId: transition.current.lastStripeEventId,
    lastStripeEventPayloadFingerprint:
      transition.current.lastStripeEventPayloadFingerprint,
    stripeEventConflictKind: transition.current.stripeEventConflictKind,
    createdAt: transition.current.createdAt,
    updatedAt: transition.now,
  });
}

/** Pure future-reactivation billing reset; never called automatically. */
export function resetOwnerBillingStateForReactivation(
  openOwnerState: OwnerRecordStateDocument,
  now: Date,
): OwnerBillingStateDocument {
  const validOwner = validOwnerRecordState(openOwnerState);
  if (validOwner === null || validOwner.state !== "open") {
    return fail("invalid-state");
  }
  return createInitialOwnerBillingState(
    validOwner.ownerUid,
    validOwner.generation,
    now,
  );
}

/** Conservative future owner-removal resolver. It never calls Stripe. */
export function resolveAuthoritativeOwnerBillingPosture(
  ownerState: OwnerRecordStateDocument | null,
  billingState: OwnerBillingStateDocument | null,
): OwnerBillingPosture {
  if (ownerState === null || billingState === null) {
    return "unknown";
  }
  const validOwner = validOwnerRecordState(ownerState);
  const validBilling = validBillingState(billingState);
  if (
    validOwner === null ||
    validBilling === null ||
    validOwner.state !== "open" ||
    validOwner.ownerUid !== validBilling.ownerUid ||
    validOwner.generation !== validBilling.ownerRecordGeneration
  ) {
    return "unknown";
  }
  switch (validBilling.lifecycleState) {
  case "none":
    return "inactive";
  case "checkout_pending":
    return "blocking";
  case "subscription_known":
    return classifyOwnerBillingRawStripeStatus(validBilling.rawStripeStatus);
  case "unknown":
    return "unknown";
  }
}

export function resolveAuthoritativeOwnerBillingPostureFromStoredDocuments(
  ownerDocument: OwnerRecordStateStoredDocument | null,
  billingDocument: OwnerBillingStateStoredDocument | null,
): OwnerBillingPosture {
  try {
    const ownerState = parseOwnerRecordStateDocument(ownerDocument);
    const billingState = parseOwnerBillingStateDocument(billingDocument);
    return resolveAuthoritativeOwnerBillingPosture(ownerState, billingState);
  } catch {
    return "unknown";
  }
}
