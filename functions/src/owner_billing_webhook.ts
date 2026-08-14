import {createHash} from "node:crypto";

import {
  buildOwnerBillingStateDocument,
  classifyOwnerBillingRawStripeStatus,
  type OwnerBillingPosture,
  type OwnerBillingRawStripeStatus,
  type OwnerBillingStateDocument,
  type OwnerBillingStripeEventConflictKind,
  parseOwnerBillingStateDocument,
  requireOwnerBillingUid,
} from "./owner_billing_state_contract.js";

export const ownerBillingStripeMetadataContractVersion =
  "bitestar.owner-billing-metadata.v2" as const;
export const ownerBillingStripeMetadataSource =
  "bitesaver_subscription" as const;
export const ownerBillingStripeMetadataPlan = "coupon_monthly" as const;

export type OwnerBillingWebhookRawStripeStatus = OwnerBillingRawStripeStatus;
export type OwnerBillingWebhookStatusPosture = Exclude<
  OwnerBillingPosture,
  "unknown"
>;
export type OwnerBillingWebhookSubscriptionEventType =
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "customer.subscription.paused"
  | "customer.subscription.resumed";

export type OwnerBillingStripeMetadata = Readonly<{
  contractVersion: typeof ownerBillingStripeMetadataContractVersion;
  ownerUid: string;
  restaurantAccountId: string;
  checkoutAttemptId: string;
  billingPlanName: typeof ownerBillingStripeMetadataPlan;
  source: typeof ownerBillingStripeMetadataSource;
}>;

export type OwnerBillingWebhookEvent = Readonly<{
  ownerUid: string;
  restaurantAccountId: string;
  checkoutAttemptId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  rawStripeStatus: OwnerBillingWebhookRawStripeStatus;
  billingPosture: OwnerBillingWebhookStatusPosture;
  eventType: OwnerBillingWebhookSubscriptionEventType;
  eventCreated: number;
  eventId: string;
  payloadFingerprint: string;
}>;

export type OwnerBillingWebhookUnknownStatusEvent = Readonly<{
  ownerUid: string;
  restaurantAccountId: string;
  checkoutAttemptId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  statusKind: "unsupported";
  eventType: OwnerBillingWebhookSubscriptionEventType;
  eventCreated: number;
  eventId: string;
  payloadFingerprint: string;
}>;

type OwnerBillingWebhookComparableEvent =
  | OwnerBillingWebhookEvent
  | OwnerBillingWebhookUnknownStatusEvent;

export type OwnerBillingWebhookCurrentEvent = Readonly<{
  ownerUid: string;
  restaurantAccountId: string;
  checkoutAttemptId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  lastStripeEventCreated: number;
  lastStripeEventId: string;
  lastStripeEventPayloadFingerprint: string;
  stripeEventConflictKind: OwnerBillingStripeEventConflictKind | null;
}>;

export type OwnerBillingWebhookDecision = Readonly<{
  action:
    | "apply"
    | "ignore_exact_duplicate"
    | "ignore_equal_equivalent"
    | "ignore_older_event"
    | "mark_unknown_conflict"
    | "reject_invalid_state";
  billingEffect: "apply_incoming" | "retain_current" | "set_unknown";
  conflictKind: OwnerBillingStripeEventConflictKind | null;
  allowAccountRootUpdate: boolean;
  resolvesEventOrderConflict: boolean;
}>;

export type OwnerBillingWebhookApplyResult = Readonly<{
  state: OwnerBillingStateDocument;
  decision: OwnerBillingWebhookDecision;
  changed: boolean;
}>;

export type OwnerBillingWebhookContractErrorCode =
  | "invalid_metadata"
  | "invalid_event";

export class OwnerBillingWebhookContractError extends Error {
  readonly code: OwnerBillingWebhookContractErrorCode;

  constructor(code: OwnerBillingWebhookContractErrorCode) {
    super("Owner billing webhook data is invalid.");
    this.name = "OwnerBillingWebhookContractError";
    this.code = code;
  }
}

const metadataKeys = Object.freeze([
  "contractVersion",
  "ownerUid",
  "restaurantAccountId",
  "checkoutAttemptId",
  "billingPlanName",
  "source",
] as const);
const privateIdentityPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const stripeCustomerIdPattern = /^cus_[A-Za-z0-9]+$/;
const stripeSubscriptionIdPattern = /^sub_[A-Za-z0-9]+$/;
const stripeEventIdPattern = /^evt_[A-Za-z0-9]+$/;
const fingerprintPattern = /^[a-f0-9]{64}$/;
const subscriptionEventTypes = new Set<OwnerBillingWebhookSubscriptionEventType>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

function invalidMetadata(): never {
  throw new OwnerBillingWebhookContractError("invalid_metadata");
}

function invalidEvent(): never {
  throw new OwnerBillingWebhookContractError("invalid_event");
}

function isPlainRecord(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<PropertyKey, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Reflect.ownKeys(value);
  return actualKeys.length === keys.length &&
    keys.every((key) => actualKeys.includes(key));
}

function requireOwnerUid(value: unknown): string {
  try {
    return requireOwnerBillingUid(value);
  } catch {
    return invalidMetadata();
  }
}

function requireCheckoutAttemptId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !privateIdentityPattern.test(value)
  ) {
    invalidMetadata();
  }
  return value;
}

function isValidOwnerUid(value: unknown): value is string {
  try {
    requireOwnerBillingUid(value);
    return true;
  } catch {
    return false;
  }
}

function requireStripeIdentity(
  value: unknown,
  pattern: RegExp,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    invalidEvent();
  }
  return value;
}

function requireEventCreated(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    invalidEvent();
  }
  return value;
}

function requireSubscriptionEventType(
  value: unknown,
): OwnerBillingWebhookSubscriptionEventType {
  if (
    typeof value !== "string" ||
    !subscriptionEventTypes.has(
      value as OwnerBillingWebhookSubscriptionEventType,
    )
  ) {
    invalidEvent();
  }
  return value as OwnerBillingWebhookSubscriptionEventType;
}

function requireFingerprint(value: unknown): string {
  if (typeof value !== "string" || !fingerprintPattern.test(value)) {
    invalidEvent();
  }
  return value;
}

export function createOwnerBillingStripeMetadata(params: {
  ownerUid: unknown;
  checkoutAttemptId: unknown;
}): OwnerBillingStripeMetadata {
  const ownerUid = requireOwnerUid(params.ownerUid);
  const checkoutAttemptId = requireCheckoutAttemptId(params.checkoutAttemptId);
  return Object.freeze({
    contractVersion: ownerBillingStripeMetadataContractVersion,
    ownerUid,
    restaurantAccountId: ownerUid,
    checkoutAttemptId,
    billingPlanName: ownerBillingStripeMetadataPlan,
    source: ownerBillingStripeMetadataSource,
  });
}

export function parseOwnerBillingStripeMetadata(
  raw: unknown,
): OwnerBillingStripeMetadata {
  try {
    if (!isPlainRecord(raw) || !hasExactKeys(raw, metadataKeys)) {
      invalidMetadata();
    }
    const ownerUid = requireOwnerUid(raw.ownerUid);
    const restaurantAccountId = requireOwnerUid(raw.restaurantAccountId);
    const checkoutAttemptId = requireCheckoutAttemptId(raw.checkoutAttemptId);
    if (
      raw.contractVersion !== ownerBillingStripeMetadataContractVersion ||
      restaurantAccountId !== ownerUid ||
      raw.billingPlanName !== ownerBillingStripeMetadataPlan ||
      raw.source !== ownerBillingStripeMetadataSource
    ) {
      invalidMetadata();
    }
    return Object.freeze({
      contractVersion: ownerBillingStripeMetadataContractVersion,
      ownerUid,
      restaurantAccountId,
      checkoutAttemptId,
      billingPlanName: ownerBillingStripeMetadataPlan,
      source: ownerBillingStripeMetadataSource,
    });
  } catch (error) {
    if (error instanceof OwnerBillingWebhookContractError) {
      throw error;
    }
    return invalidMetadata();
  }
}

export function requireMatchingOwnerBillingStripeMetadata(params: {
  checkoutSessionMetadata: unknown;
  subscriptionMetadata: unknown;
}): OwnerBillingStripeMetadata {
  const session = parseOwnerBillingStripeMetadata(
    params.checkoutSessionMetadata,
  );
  const subscription = parseOwnerBillingStripeMetadata(
    params.subscriptionMetadata,
  );
  for (const key of metadataKeys) {
    if (session[key] !== subscription[key]) {
      invalidMetadata();
    }
  }
  return subscription;
}

function effectivePayloadFingerprint(params: {
  metadata: OwnerBillingStripeMetadata;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  statusFingerprint:
    | OwnerBillingWebhookRawStripeStatus
    | "unsupported_status";
}): string {
  // Delivery type, ID, and timestamp are intentionally excluded. Two supported
  // subscription events with one exact effective snapshot are equivalent, but
  // every field that can change billing meaning remains bound below.
  return createHash("sha256").update(JSON.stringify([
    params.metadata.contractVersion,
    params.metadata.ownerUid,
    params.metadata.restaurantAccountId,
    params.metadata.checkoutAttemptId,
    params.metadata.billingPlanName,
    params.metadata.source,
    params.stripeCustomerId,
    params.stripeSubscriptionId,
    params.statusFingerprint,
  ]), "utf8").digest("hex");
}

export function createOwnerBillingWebhookEvent(params: {
  metadata: unknown;
  stripeCustomerId: unknown;
  stripeSubscriptionId: unknown;
  rawStripeStatus: unknown;
  eventType: unknown;
  eventCreated: unknown;
  eventId: unknown;
}): OwnerBillingWebhookEvent {
  const metadata = parseOwnerBillingStripeMetadata(params.metadata);
  const stripeCustomerId = requireStripeIdentity(
    params.stripeCustomerId,
    stripeCustomerIdPattern,
  );
  const stripeSubscriptionId = requireStripeIdentity(
    params.stripeSubscriptionId,
    stripeSubscriptionIdPattern,
  );
  const billingPosture = classifyOwnerBillingRawStripeStatus(
    params.rawStripeStatus,
  );
  if (
    billingPosture === "unknown" ||
    typeof params.rawStripeStatus !== "string"
  ) {
    invalidEvent();
  }
  const rawStripeStatus =
    params.rawStripeStatus as OwnerBillingWebhookRawStripeStatus;
  const eventType = requireSubscriptionEventType(params.eventType);
  const eventCreated = requireEventCreated(params.eventCreated);
  const eventId = requireStripeIdentity(params.eventId, stripeEventIdPattern);
  return Object.freeze({
    ownerUid: metadata.ownerUid,
    restaurantAccountId: metadata.restaurantAccountId,
    checkoutAttemptId: metadata.checkoutAttemptId,
    stripeCustomerId,
    stripeSubscriptionId,
    rawStripeStatus,
    billingPosture,
    eventType,
    eventCreated,
    eventId,
    payloadFingerprint: effectivePayloadFingerprint({
      metadata,
      stripeCustomerId,
      stripeSubscriptionId,
      statusFingerprint: rawStripeStatus,
    }),
  });
}

/**
 * Validates every attributable event field while reducing any unsupported or
 * malformed runtime status to one non-inactive semantic category. The raw
 * unsupported value is intentionally neither retained nor returned.
 */
export function createOwnerBillingUnknownStatusWebhookEvent(params: {
  metadata: unknown;
  stripeCustomerId: unknown;
  stripeSubscriptionId: unknown;
  rawStripeStatus: unknown;
  eventType: unknown;
  eventCreated: unknown;
  eventId: unknown;
}): OwnerBillingWebhookUnknownStatusEvent {
  if (classifyOwnerBillingRawStripeStatus(params.rawStripeStatus) !== "unknown") {
    invalidEvent();
  }
  const metadata = parseOwnerBillingStripeMetadata(params.metadata);
  const stripeCustomerId = requireStripeIdentity(
    params.stripeCustomerId,
    stripeCustomerIdPattern,
  );
  const stripeSubscriptionId = requireStripeIdentity(
    params.stripeSubscriptionId,
    stripeSubscriptionIdPattern,
  );
  const eventType = requireSubscriptionEventType(params.eventType);
  const eventCreated = requireEventCreated(params.eventCreated);
  const eventId = requireStripeIdentity(params.eventId, stripeEventIdPattern);
  return Object.freeze({
    ownerUid: metadata.ownerUid,
    restaurantAccountId: metadata.restaurantAccountId,
    checkoutAttemptId: metadata.checkoutAttemptId,
    stripeCustomerId,
    stripeSubscriptionId,
    statusKind: "unsupported",
    eventType,
    eventCreated,
    eventId,
    payloadFingerprint: effectivePayloadFingerprint({
      metadata,
      stripeCustomerId,
      stripeSubscriptionId,
      statusFingerprint: "unsupported_status",
    }),
  });
}

function decision(
  action: OwnerBillingWebhookDecision["action"],
  billingEffect: OwnerBillingWebhookDecision["billingEffect"],
  options: {
    allowAccountRootUpdate?: boolean;
    conflictKind?: OwnerBillingStripeEventConflictKind | null;
    resolvesEventOrderConflict?: boolean;
  } = {},
): OwnerBillingWebhookDecision {
  return Object.freeze({
    action,
    billingEffect,
    conflictKind: options.conflictKind ?? null,
    allowAccountRootUpdate: options.allowAccountRootUpdate === true,
    resolvesEventOrderConflict:
      options.resolvesEventOrderConflict === true,
  });
}

function sameSubscriptionIdentity(
  current: OwnerBillingWebhookCurrentEvent,
  incoming: OwnerBillingWebhookComparableEvent,
): boolean {
  return current.ownerUid === incoming.ownerUid &&
    current.restaurantAccountId === incoming.restaurantAccountId &&
    current.checkoutAttemptId === incoming.checkoutAttemptId &&
    current.stripeCustomerId === incoming.stripeCustomerId &&
    current.stripeSubscriptionId === incoming.stripeSubscriptionId;
}

export function decideOwnerBillingWebhookEvent(params: {
  ownerUid: string;
  expectedCheckoutAttemptId: string | null;
  current: OwnerBillingWebhookCurrentEvent | null;
  incoming: OwnerBillingWebhookComparableEvent;
}): OwnerBillingWebhookDecision {
  if (
    params.ownerUid !== params.incoming.ownerUid ||
    params.incoming.restaurantAccountId !== params.incoming.ownerUid ||
    !isValidOwnerUid(params.ownerUid)
  ) {
    return decision("reject_invalid_state", "set_unknown");
  }

  const current = params.current;
  if (current !== null) {
    try {
      requireEventCreated(current.lastStripeEventCreated);
      requireStripeIdentity(current.lastStripeEventId, stripeEventIdPattern);
      requireFingerprint(current.lastStripeEventPayloadFingerprint);
    } catch {
      return decision("reject_invalid_state", "set_unknown");
    }
    if (
      current.ownerUid !== params.ownerUid ||
      current.restaurantAccountId !== params.ownerUid
    ) {
      return decision("reject_invalid_state", "set_unknown");
    }
    if (
      current.stripeEventConflictKind !== null &&
      current.stripeEventConflictKind !== "event_order" &&
      current.stripeEventConflictKind !== "identity" &&
      current.stripeEventConflictKind !== "unsupported_status"
    ) {
      return decision("reject_invalid_state", "set_unknown");
    }
    if (params.incoming.eventCreated < current.lastStripeEventCreated) {
      return decision("ignore_older_event", "retain_current");
    }
  }
  if (
    params.expectedCheckoutAttemptId === null ||
    !privateIdentityPattern.test(params.expectedCheckoutAttemptId)
  ) {
    return decision("reject_invalid_state", "set_unknown");
  }
  if (
    params.expectedCheckoutAttemptId !== params.incoming.checkoutAttemptId
  ) {
    return decision("mark_unknown_conflict", "set_unknown", {
      conflictKind: "identity",
    });
  }
  if (current === null) {
    return decision("apply", "apply_incoming", {
      allowAccountRootUpdate: true,
    });
  }
  if (
    current.stripeEventConflictKind === "identity" ||
    !sameSubscriptionIdentity(current, params.incoming)
  ) {
    return decision("mark_unknown_conflict", "set_unknown", {
      conflictKind: "identity",
    });
  }

  if (params.incoming.eventId === current.lastStripeEventId) {
    if (
      params.incoming.eventCreated === current.lastStripeEventCreated &&
      params.incoming.payloadFingerprint ===
        current.lastStripeEventPayloadFingerprint
    ) {
      return decision("ignore_exact_duplicate", "retain_current");
    }
    return decision("mark_unknown_conflict", "set_unknown", {
      conflictKind: "event_order",
    });
  }
  if (params.incoming.eventCreated === current.lastStripeEventCreated) {
    if (
      params.incoming.payloadFingerprint ===
        current.lastStripeEventPayloadFingerprint
    ) {
      return decision("ignore_equal_equivalent", "retain_current");
    }
    return decision("mark_unknown_conflict", "set_unknown", {
      conflictKind: "event_order",
    });
  }
  return decision("apply", "apply_incoming", {
    allowAccountRootUpdate: true,
    resolvesEventOrderConflict:
      current.stripeEventConflictKind === "event_order" ||
      current.stripeEventConflictKind === "unsupported_status",
  });
}

function requireCurrentBillingState(
  current: OwnerBillingStateDocument,
): OwnerBillingStateDocument {
  return parseOwnerBillingStateDocument({
    id: current.ownerUid,
    data: current,
  }) ?? invalidEvent();
}

function requireCanonicalIncoming(
  incoming: OwnerBillingWebhookEvent,
): OwnerBillingWebhookEvent {
  const canonical = createOwnerBillingWebhookEvent({
    metadata: createOwnerBillingStripeMetadata({
      ownerUid: incoming.ownerUid,
      checkoutAttemptId: incoming.checkoutAttemptId,
    }),
    stripeCustomerId: incoming.stripeCustomerId,
    stripeSubscriptionId: incoming.stripeSubscriptionId,
    rawStripeStatus: incoming.rawStripeStatus,
    eventType: incoming.eventType,
    eventCreated: incoming.eventCreated,
    eventId: incoming.eventId,
  });
  for (const key of Object.keys(canonical) as Array<keyof typeof canonical>) {
    if (canonical[key] !== incoming[key]) {
      invalidEvent();
    }
  }
  return canonical;
}

function requireCanonicalUnknownStatusIncoming(
  incoming: OwnerBillingWebhookUnknownStatusEvent,
): OwnerBillingWebhookUnknownStatusEvent {
  const canonical = createOwnerBillingUnknownStatusWebhookEvent({
    metadata: createOwnerBillingStripeMetadata({
      ownerUid: incoming.ownerUid,
      checkoutAttemptId: incoming.checkoutAttemptId,
    }),
    stripeCustomerId: incoming.stripeCustomerId,
    stripeSubscriptionId: incoming.stripeSubscriptionId,
    rawStripeStatus: null,
    eventType: incoming.eventType,
    eventCreated: incoming.eventCreated,
    eventId: incoming.eventId,
  });
  for (const key of Object.keys(canonical) as Array<keyof typeof canonical>) {
    if (canonical[key] !== incoming[key]) {
      invalidEvent();
    }
  }
  return canonical;
}

function currentEventFromBillingState(
  current: OwnerBillingStateDocument,
): OwnerBillingWebhookCurrentEvent | null {
  if (
    current.checkoutAttemptId === null ||
    current.stripeCustomerId === null ||
    current.stripeSubscriptionId === null ||
    current.lastStripeEventCreated === null ||
    current.lastStripeEventId === null ||
    current.lastStripeEventPayloadFingerprint === null
  ) {
    return null;
  }
  return Object.freeze({
    ownerUid: current.ownerUid,
    restaurantAccountId: current.ownerUid,
    checkoutAttemptId: current.checkoutAttemptId,
    stripeCustomerId: current.stripeCustomerId,
    stripeSubscriptionId: current.stripeSubscriptionId,
    lastStripeEventCreated: current.lastStripeEventCreated,
    lastStripeEventId: current.lastStripeEventId,
    lastStripeEventPayloadFingerprint:
      current.lastStripeEventPayloadFingerprint,
    stripeEventConflictKind: current.stripeEventConflictKind,
  });
}

function requireTransitionTime(
  now: unknown,
  current: OwnerBillingStateDocument,
): Date {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    now.getTime() < current.updatedAt.getTime()
  ) {
    invalidEvent();
  }
  return new Date(now.getTime());
}

function buildAppliedBillingState(params: {
  current: OwnerBillingStateDocument;
  incoming: OwnerBillingWebhookEvent;
  now: Date;
}): OwnerBillingStateDocument {
  if (
    params.current.checkoutAttemptId === null ||
    params.current.checkoutRequestFingerprint === null ||
    params.current.checkoutAttemptCreatedAt === null
  ) {
    invalidEvent();
  }
  return buildOwnerBillingStateDocument({
    ownerUid: params.current.ownerUid,
    lifecycleState: "subscription_known",
    rawStripeStatus: params.incoming.rawStripeStatus,
    billingPosture: params.incoming.billingPosture,
    stripeCustomerId: params.incoming.stripeCustomerId,
    stripeSubscriptionId: params.incoming.stripeSubscriptionId,
    checkoutAttemptId: params.current.checkoutAttemptId,
    checkoutRequestFingerprint:
      params.current.checkoutRequestFingerprint,
    checkoutAttemptCreatedAt: params.current.checkoutAttemptCreatedAt,
    checkoutSessionId: params.current.checkoutSessionId,
    lastStripeEventCreated: params.incoming.eventCreated,
    lastStripeEventId: params.incoming.eventId,
    lastStripeEventPayloadFingerprint:
      params.incoming.payloadFingerprint,
    stripeEventConflictKind: null,
    createdAt: params.current.createdAt,
    updatedAt: params.now,
  });
}

function buildUnknownBillingState(params: {
  current: OwnerBillingStateDocument;
  incoming: OwnerBillingWebhookComparableEvent;
  decision: OwnerBillingWebhookDecision;
  now: Date;
}): OwnerBillingStateDocument {
  const hasAttempt =
    params.current.checkoutAttemptId !== null &&
    params.current.checkoutRequestFingerprint !== null &&
    params.current.checkoutAttemptCreatedAt !== null;
  const hasCurrentEvent =
    hasAttempt &&
    params.current.stripeCustomerId !== null &&
    params.current.stripeSubscriptionId !== null &&
    params.current.lastStripeEventCreated !== null &&
    params.current.lastStripeEventId !== null &&
    params.current.lastStripeEventPayloadFingerprint !== null;
  const canRecordIncomingIdentity =
    hasAttempt &&
    params.decision.conflictKind === "identity" &&
    params.current.checkoutAttemptId === params.incoming.checkoutAttemptId &&
    params.current.stripeCustomerId === null &&
    params.current.stripeSubscriptionId === null;
  const useIncoming = !hasCurrentEvent && canRecordIncomingIdentity;
  const rawStripeStatus = useIncoming && "rawStripeStatus" in params.incoming
    ? params.incoming.rawStripeStatus
    : params.current.rawStripeStatus;
  const stripeCustomerId = useIncoming
    ? params.incoming.stripeCustomerId
    : params.current.stripeCustomerId;
  const stripeSubscriptionId = useIncoming
    ? params.incoming.stripeSubscriptionId
    : params.current.stripeSubscriptionId;
  const lastStripeEventCreated = useIncoming
    ? params.incoming.eventCreated
    : params.current.lastStripeEventCreated;
  const lastStripeEventId = useIncoming
    ? params.incoming.eventId
    : params.current.lastStripeEventId;
  const lastStripeEventPayloadFingerprint = useIncoming
    ? params.incoming.payloadFingerprint
    : params.current.lastStripeEventPayloadFingerprint;
  const canPersistConflict =
    hasAttempt &&
    stripeCustomerId !== null &&
    stripeSubscriptionId !== null &&
    lastStripeEventCreated !== null &&
    lastStripeEventId !== null &&
    lastStripeEventPayloadFingerprint !== null;
  const conflictKind = canPersistConflict
    ? params.decision.conflictKind ??
      params.current.stripeEventConflictKind
    : null;

  return buildOwnerBillingStateDocument({
    ownerUid: params.current.ownerUid,
    lifecycleState: "unknown",
    rawStripeStatus,
    billingPosture: "unknown",
    stripeCustomerId,
    stripeSubscriptionId,
    checkoutAttemptId: params.current.checkoutAttemptId,
    checkoutRequestFingerprint:
      params.current.checkoutRequestFingerprint,
    checkoutAttemptCreatedAt: params.current.checkoutAttemptCreatedAt,
    checkoutSessionId: params.current.checkoutSessionId,
    lastStripeEventCreated,
    lastStripeEventId,
    lastStripeEventPayloadFingerprint,
    stripeEventConflictKind: conflictKind,
    createdAt: params.current.createdAt,
    updatedAt: params.now,
  });
}

function buildUnknownStatusBillingState(params: {
  current: OwnerBillingStateDocument;
  incoming: OwnerBillingWebhookUnknownStatusEvent;
  now: Date;
}): OwnerBillingStateDocument {
  if (
    params.current.checkoutAttemptId === null ||
    params.current.checkoutRequestFingerprint === null ||
    params.current.checkoutAttemptCreatedAt === null
  ) {
    invalidEvent();
  }
  return buildOwnerBillingStateDocument({
    ownerUid: params.current.ownerUid,
    lifecycleState: "unknown",
    rawStripeStatus: null,
    billingPosture: "unknown",
    stripeCustomerId: params.incoming.stripeCustomerId,
    stripeSubscriptionId: params.incoming.stripeSubscriptionId,
    checkoutAttemptId: params.current.checkoutAttemptId,
    checkoutRequestFingerprint:
      params.current.checkoutRequestFingerprint,
    checkoutAttemptCreatedAt: params.current.checkoutAttemptCreatedAt,
    checkoutSessionId: params.current.checkoutSessionId,
    lastStripeEventCreated: params.incoming.eventCreated,
    lastStripeEventId: params.incoming.eventId,
    lastStripeEventPayloadFingerprint:
      params.incoming.payloadFingerprint,
    stripeEventConflictKind: "unsupported_status",
    createdAt: params.current.createdAt,
    updatedAt: params.now,
  });
}

/**
 * Applies one already signature-verified Subscription event to strict private
 * state. It is pure: callers own the Firestore transaction and root update.
 */
export function applyOwnerBillingWebhookEvent(params: {
  current: OwnerBillingStateDocument;
  incoming: OwnerBillingWebhookEvent;
  now: Date;
}): OwnerBillingWebhookApplyResult {
  const current = requireCurrentBillingState(params.current);
  const incoming = requireCanonicalIncoming(params.incoming);
  const now = requireTransitionTime(params.now, current);
  const hasPersistedIdentityConflict =
    (current.lastStripeEventCreated === null ||
      incoming.eventCreated >= current.lastStripeEventCreated) &&
    ((current.stripeCustomerId !== null &&
      current.stripeCustomerId !== incoming.stripeCustomerId) ||
      (current.stripeSubscriptionId !== null &&
        current.stripeSubscriptionId !== incoming.stripeSubscriptionId));
  const eventDecision: OwnerBillingWebhookDecision = hasPersistedIdentityConflict
    ? decision("mark_unknown_conflict", "set_unknown", {
      conflictKind: "identity",
    })
    : decideOwnerBillingWebhookEvent({
      ownerUid: current.ownerUid,
      expectedCheckoutAttemptId: current.checkoutAttemptId,
      current: currentEventFromBillingState(current),
      incoming,
    });
  if (eventDecision.billingEffect === "retain_current") {
    return Object.freeze({
      state: current,
      decision: eventDecision,
      changed: false,
    });
  }
  const state = eventDecision.billingEffect === "apply_incoming"
    ? buildAppliedBillingState({current, incoming, now})
    : buildUnknownBillingState({
      current,
      incoming,
      decision: eventDecision,
      now,
    });
  return Object.freeze({
    state,
    decision: eventDecision,
    changed: state.fingerprint !== current.fingerprint,
  });
}

/**
 * Persists an attributable unsupported runtime status as an ordered unknown
 * high-water mark. No unsupported raw value can enter the strict state.
 */
export function applyOwnerBillingUnknownStatusWebhookEvent(params: {
  current: OwnerBillingStateDocument;
  incoming: OwnerBillingWebhookUnknownStatusEvent;
  now: Date;
}): OwnerBillingWebhookApplyResult {
  const current = requireCurrentBillingState(params.current);
  const incoming = requireCanonicalUnknownStatusIncoming(params.incoming);
  const now = requireTransitionTime(params.now, current);
  const hasPersistedIdentityConflict =
    (current.lastStripeEventCreated === null ||
      incoming.eventCreated >= current.lastStripeEventCreated) &&
    ((current.stripeCustomerId !== null &&
      current.stripeCustomerId !== incoming.stripeCustomerId) ||
      (current.stripeSubscriptionId !== null &&
        current.stripeSubscriptionId !== incoming.stripeSubscriptionId));
  const eventDecision = hasPersistedIdentityConflict
    ? decision("mark_unknown_conflict", "set_unknown", {
      conflictKind: "identity",
    })
    : decideOwnerBillingWebhookEvent({
      ownerUid: current.ownerUid,
      expectedCheckoutAttemptId: current.checkoutAttemptId,
      current: currentEventFromBillingState(current),
      incoming,
    });
  if (eventDecision.billingEffect === "retain_current") {
    return Object.freeze({
      state: current,
      decision: eventDecision,
      changed: false,
    });
  }
  const state = eventDecision.action === "apply"
    ? buildUnknownStatusBillingState({current, incoming, now})
    : buildUnknownBillingState({
      current,
      incoming,
      decision: eventDecision,
      now,
    });
  return Object.freeze({
    state,
    decision: Object.freeze({
      ...eventDecision,
      allowAccountRootUpdate: false,
    }),
    changed: state.fingerprint !== current.fingerprint,
  });
}
