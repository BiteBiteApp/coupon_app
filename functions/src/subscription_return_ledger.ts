import {createHash} from "node:crypto";

import {
  requireSubscriptionReturnToken,
  subscriptionReturnProtocolVersion,
} from "./subscription_return_token.js";

export const subscriptionReturnLedgerCollection =
  "private_subscription_return_state";
export const subscriptionReturnLedgerSchemaVersion = 1 as const;
export const subscriptionReturnLedgerMaximumContexts = 32;
export const subscriptionReturnLedgerMaximumEvents = 32;
export const subscriptionReturnLedgerLifetimeMilliseconds =
  24 * 60 * 60 * 1000;
export const subscriptionReturnLedgerClockSkewMilliseconds =
  5 * 60 * 1000;
export const subscriptionReturnLedgerMaximumDocumentIdLength = 128;
export const subscriptionReturnLedgerMaximumEventId =
  Number.MAX_SAFE_INTEGER - 1;

const tokenHashPattern = /^[a-f0-9]{64}$/;
const eventIdPattern = /^[1-9][0-9]{0,15}$/;
const unsafeDocumentIdPattern = /[\/\u0000-\u001f\u007f]/;

export type SubscriptionReturnFamily = "checkout" | "customerPortal";
export type SubscriptionReturnKind =
  | "checkoutSuccess"
  | "checkoutCancel"
  | "customerPortal";
export type SubscriptionReturnClaimType = "navigation" | "refresh";

export type SubscriptionReturnSessionRequest = Readonly<{
  returnProtocolVersion: typeof subscriptionReturnProtocolVersion;
  restaurantAccountDocumentId: string;
}>;

export type SubscriptionReturnRedeemRequest = Readonly<{
  returnProtocolVersion: typeof subscriptionReturnProtocolVersion;
  restaurantAccountDocumentId: string;
  returnToken: string;
  returnKind: SubscriptionReturnKind;
}>;

export type SubscriptionReturnClaimRequest = Readonly<{
  returnProtocolVersion: typeof subscriptionReturnProtocolVersion;
  restaurantAccountDocumentId: string;
  eventId: string;
  claimType: SubscriptionReturnClaimType;
}>;

export type SubscriptionReturnListRequest = Readonly<{
  returnProtocolVersion: typeof subscriptionReturnProtocolVersion;
  restaurantAccountDocumentId: string;
}>;

export type SubscriptionReturnLedgerContext = Readonly<{
  schemaVersion: typeof subscriptionReturnLedgerSchemaVersion;
  family: SubscriptionReturnFamily;
  createdAtEpochMs: number;
  expiresAtEpochMs: number;
  ready: boolean;
  consumedEventId: string | null;
}>;

export type SubscriptionReturnLedgerEvent = Readonly<{
  schemaVersion: typeof subscriptionReturnLedgerSchemaVersion;
  eventId: string;
  returnKind: SubscriptionReturnKind;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  createdAtEpochMs: number;
  expiresAtEpochMs: number;
  navigationClaimed: boolean;
  refreshClaimed: boolean;
}>;

export type SubscriptionReturnLedgerState = Readonly<{
  schemaVersion: typeof subscriptionReturnLedgerSchemaVersion;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  nextEventId: number;
  contexts: Readonly<Record<string, SubscriptionReturnLedgerContext>>;
  events: Readonly<Record<string, SubscriptionReturnLedgerEvent>>;
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
}>;

export type SubscriptionReturnSafeEvent = Readonly<{
  eventId: string;
  returnKind: SubscriptionReturnKind;
  navigationClaimed: boolean;
  refreshClaimed: boolean;
  expiresAtEpochMs: number;
}>;

export type SubscriptionReturnLedgerErrorCode =
  | "invalid_request"
  | "invalid_owner"
  | "invalid_state"
  | "capacity_exhausted"
  | "token_hash_collision"
  | "context_unavailable"
  | "event_unavailable"
  | "event_id_exhausted";

export class SubscriptionReturnLedgerError extends Error {
  readonly code: SubscriptionReturnLedgerErrorCode;

  constructor(code: SubscriptionReturnLedgerErrorCode) {
    super("Subscription return state is unavailable.");
    this.name = "SubscriptionReturnLedgerError";
    this.code = code;
  }
}

type MutableContext = {
  schemaVersion: typeof subscriptionReturnLedgerSchemaVersion;
  family: SubscriptionReturnFamily;
  createdAtEpochMs: number;
  expiresAtEpochMs: number;
  ready: boolean;
  consumedEventId: string | null;
};

type MutableEvent = {
  schemaVersion: typeof subscriptionReturnLedgerSchemaVersion;
  eventId: string;
  returnKind: SubscriptionReturnKind;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  createdAtEpochMs: number;
  expiresAtEpochMs: number;
  navigationClaimed: boolean;
  refreshClaimed: boolean;
};

type MutableState = {
  schemaVersion: typeof subscriptionReturnLedgerSchemaVersion;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  nextEventId: number;
  contexts: Record<string, MutableContext>;
  events: Record<string, MutableEvent>;
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
};

function invalidRequest(): never {
  throw new SubscriptionReturnLedgerError("invalid_request");
}

function invalidState(): never {
  throw new SubscriptionReturnLedgerError("invalid_state");
}

function requireTokenHash(value: unknown): string {
  if (typeof value !== "string" || !tokenHashPattern.test(value)) {
    invalidState();
  }
  return value;
}

function isPlainRecord(
  value: unknown,
): value is Record<PropertyKey, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<PropertyKey, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key))
  );
}

function requireExactRequest(
  value: unknown,
  expectedKeys: readonly string[],
): Record<PropertyKey, unknown> {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, expectedKeys)) {
      invalidRequest();
    }
    return value;
  } catch (error) {
    if (error instanceof SubscriptionReturnLedgerError) {
      throw error;
    }
    return invalidRequest();
  }
}

function requireProtocolVersion(
  value: Record<PropertyKey, unknown>,
): void {
  let version: unknown;
  try {
    version = value.returnProtocolVersion;
  } catch {
    invalidRequest();
  }
  if (
    !Number.isInteger(version) ||
    version !== subscriptionReturnProtocolVersion
  ) {
    invalidRequest();
  }
}

export function isValidRestaurantAccountDocumentId(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= subscriptionReturnLedgerMaximumDocumentIdLength &&
    value === value.trim() &&
    value !== "." &&
    value !== ".." &&
    !unsafeDocumentIdPattern.test(value)
  );
}

function requireRestaurantAccountDocumentId(value: unknown): string {
  if (!isValidRestaurantAccountDocumentId(value)) {
    invalidRequest();
  }
  return value;
}

export function isValidSubscriptionReturnEventId(
  value: unknown,
): value is string {
  if (typeof value !== "string" || !eventIdPattern.test(value)) {
    return false;
  }
  const parsed = Number(value);
  return (
    Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= subscriptionReturnLedgerMaximumEventId &&
    String(parsed) === value
  );
}

function requireEventId(value: unknown): string {
  if (!isValidSubscriptionReturnEventId(value)) {
    invalidRequest();
  }
  return value;
}

export function isSubscriptionReturnKind(
  value: unknown,
): value is SubscriptionReturnKind {
  return (
    value === "checkoutSuccess" ||
    value === "checkoutCancel" ||
    value === "customerPortal"
  );
}

export function subscriptionReturnFamilyForKind(
  kind: SubscriptionReturnKind,
): SubscriptionReturnFamily {
  return kind === "customerPortal" ? "customerPortal" : "checkout";
}

function isSubscriptionReturnClaimType(
  value: unknown,
): value is SubscriptionReturnClaimType {
  return value === "navigation" || value === "refresh";
}

export function parseSubscriptionReturnSessionRequest(
  data: unknown,
): SubscriptionReturnSessionRequest {
  const value = requireExactRequest(data, [
    "returnProtocolVersion",
    "restaurantAccountDocumentId",
  ]);
  requireProtocolVersion(value);
  return Object.freeze({
    returnProtocolVersion: subscriptionReturnProtocolVersion,
    restaurantAccountDocumentId: requireRestaurantAccountDocumentId(
      value.restaurantAccountDocumentId,
    ),
  });
}

export function parseSubscriptionReturnRedeemRequest(
  data: unknown,
): SubscriptionReturnRedeemRequest {
  const value = requireExactRequest(data, [
    "returnProtocolVersion",
    "restaurantAccountDocumentId",
    "returnToken",
    "returnKind",
  ]);
  requireProtocolVersion(value);
  let returnToken: string;
  try {
    returnToken = requireSubscriptionReturnToken(value.returnToken);
  } catch {
    return invalidRequest();
  }
  let returnKind: unknown;
  try {
    returnKind = value.returnKind;
  } catch {
    return invalidRequest();
  }
  if (!isSubscriptionReturnKind(returnKind)) {
    invalidRequest();
  }
  return Object.freeze({
    returnProtocolVersion: subscriptionReturnProtocolVersion,
    restaurantAccountDocumentId: requireRestaurantAccountDocumentId(
      value.restaurantAccountDocumentId,
    ),
    returnToken,
    returnKind,
  });
}

export function parseSubscriptionReturnClaimRequest(
  data: unknown,
): SubscriptionReturnClaimRequest {
  const value = requireExactRequest(data, [
    "returnProtocolVersion",
    "restaurantAccountDocumentId",
    "eventId",
    "claimType",
  ]);
  requireProtocolVersion(value);
  let claimType: unknown;
  try {
    claimType = value.claimType;
  } catch {
    return invalidRequest();
  }
  if (!isSubscriptionReturnClaimType(claimType)) {
    invalidRequest();
  }
  return Object.freeze({
    returnProtocolVersion: subscriptionReturnProtocolVersion,
    restaurantAccountDocumentId: requireRestaurantAccountDocumentId(
      value.restaurantAccountDocumentId,
    ),
    eventId: requireEventId(value.eventId),
    claimType,
  });
}

export function parseSubscriptionReturnListRequest(
  data: unknown,
): SubscriptionReturnListRequest {
  const value = requireExactRequest(data, [
    "returnProtocolVersion",
    "restaurantAccountDocumentId",
  ]);
  requireProtocolVersion(value);
  return Object.freeze({
    returnProtocolVersion: subscriptionReturnProtocolVersion,
    restaurantAccountDocumentId: requireRestaurantAccountDocumentId(
      value.restaurantAccountDocumentId,
    ),
  });
}

export function hashSubscriptionReturnToken(tokenValue: unknown): string {
  let token: string;
  try {
    token = requireSubscriptionReturnToken(tokenValue);
  } catch {
    return invalidRequest();
  }
  return createHash("sha256").update(token, "ascii").digest("hex");
}

function requireOwnerUid(value: unknown): string {
  if (!isValidRestaurantAccountDocumentId(value)) {
    invalidState();
  }
  return value;
}

export function requireRestaurantAccountOwnership(params: {
  ownerUid: string;
  restaurantAccountDocumentId: string;
  accountExists: boolean;
  accountData: unknown;
}): void {
  if (
    !isValidRestaurantAccountDocumentId(params.ownerUid) ||
    !isValidRestaurantAccountDocumentId(
      params.restaurantAccountDocumentId,
    ) ||
    params.restaurantAccountDocumentId !== params.ownerUid ||
    !params.accountExists ||
    !isPlainRecord(params.accountData)
  ) {
    throw new SubscriptionReturnLedgerError("invalid_owner");
  }
  let storedUid: unknown;
  try {
    storedUid = params.accountData.uid;
  } catch {
    throw new SubscriptionReturnLedgerError("invalid_owner");
  }
  if (storedUid !== undefined && storedUid !== null) {
    if (
      typeof storedUid !== "string" ||
      storedUid.trim().length === 0 ||
      storedUid.trim() !== params.ownerUid
    ) {
      throw new SubscriptionReturnLedgerError("invalid_owner");
    }
  }
}

function requireSafeEpochMilliseconds(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== "number" ||
    value <= 0
  ) {
    invalidState();
  }
  return value;
}

function requireTimestampWindow(params: {
  createdAtEpochMs: unknown;
  expiresAtEpochMs: unknown;
  nowEpochMs: number;
}): Readonly<{createdAtEpochMs: number; expiresAtEpochMs: number}> {
  const createdAtEpochMs = requireSafeEpochMilliseconds(
    params.createdAtEpochMs,
  );
  const expiresAtEpochMs = requireSafeEpochMilliseconds(
    params.expiresAtEpochMs,
  );
  if (
    createdAtEpochMs >
      params.nowEpochMs + subscriptionReturnLedgerClockSkewMilliseconds ||
    expiresAtEpochMs <= createdAtEpochMs ||
    expiresAtEpochMs - createdAtEpochMs >
      subscriptionReturnLedgerLifetimeMilliseconds ||
    expiresAtEpochMs >
      params.nowEpochMs +
        subscriptionReturnLedgerLifetimeMilliseconds +
        subscriptionReturnLedgerClockSkewMilliseconds
  ) {
    invalidState();
  }
  return {createdAtEpochMs, expiresAtEpochMs};
}

function requireNow(nowEpochMs: number): number {
  if (
    !Number.isSafeInteger(nowEpochMs) ||
    nowEpochMs <= 0 ||
    nowEpochMs >
      Number.MAX_SAFE_INTEGER -
        subscriptionReturnLedgerLifetimeMilliseconds -
        subscriptionReturnLedgerClockSkewMilliseconds
  ) {
    invalidState();
  }
  return nowEpochMs;
}

function requireContext(
  value: unknown,
  nowEpochMs: number,
): MutableContext {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "family",
      "createdAtEpochMs",
      "expiresAtEpochMs",
      "ready",
      "consumedEventId",
    ]) ||
    value.schemaVersion !== subscriptionReturnLedgerSchemaVersion ||
    (value.family !== "checkout" && value.family !== "customerPortal") ||
    typeof value.ready !== "boolean" ||
    (value.consumedEventId !== null &&
      !isValidSubscriptionReturnEventId(value.consumedEventId)) ||
    (value.consumedEventId !== null && value.ready !== true)
  ) {
    invalidState();
  }
  const timestamps = requireTimestampWindow({
    createdAtEpochMs: value.createdAtEpochMs,
    expiresAtEpochMs: value.expiresAtEpochMs,
    nowEpochMs,
  });
  return {
    schemaVersion: subscriptionReturnLedgerSchemaVersion,
    family: value.family,
    createdAtEpochMs: timestamps.createdAtEpochMs,
    expiresAtEpochMs: timestamps.expiresAtEpochMs,
    ready: value.ready,
    consumedEventId: value.consumedEventId,
  };
}

function requireEvent(
  value: unknown,
  ownerUid: string,
  restaurantAccountDocumentId: string,
  nowEpochMs: number,
): MutableEvent {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "eventId",
      "returnKind",
      "ownerUid",
      "restaurantAccountDocumentId",
      "createdAtEpochMs",
      "expiresAtEpochMs",
      "navigationClaimed",
      "refreshClaimed",
    ]) ||
    value.schemaVersion !== subscriptionReturnLedgerSchemaVersion ||
    !isValidSubscriptionReturnEventId(value.eventId) ||
    !isSubscriptionReturnKind(value.returnKind) ||
    value.ownerUid !== ownerUid ||
    value.restaurantAccountDocumentId !== restaurantAccountDocumentId ||
    typeof value.navigationClaimed !== "boolean" ||
    typeof value.refreshClaimed !== "boolean"
  ) {
    invalidState();
  }
  const timestamps = requireTimestampWindow({
    createdAtEpochMs: value.createdAtEpochMs,
    expiresAtEpochMs: value.expiresAtEpochMs,
    nowEpochMs,
  });
  return {
    schemaVersion: subscriptionReturnLedgerSchemaVersion,
    eventId: value.eventId,
    returnKind: value.returnKind,
    ownerUid,
    restaurantAccountDocumentId,
    createdAtEpochMs: timestamps.createdAtEpochMs,
    expiresAtEpochMs: timestamps.expiresAtEpochMs,
    navigationClaimed: value.navigationClaimed,
    refreshClaimed: value.refreshClaimed,
  };
}

function requireMap(value: unknown): Record<PropertyKey, unknown> {
  if (!isPlainRecord(value)) {
    invalidState();
  }
  return value;
}

function cloneAndValidateState(
  value: unknown,
  nowEpochMs: number,
): MutableState {
  requireNow(nowEpochMs);
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "ownerUid",
      "restaurantAccountDocumentId",
      "nextEventId",
      "contexts",
      "events",
      "createdAtEpochMs",
      "updatedAtEpochMs",
    ]) ||
    value.schemaVersion !== subscriptionReturnLedgerSchemaVersion
  ) {
    invalidState();
  }
  const ownerUid = requireOwnerUid(value.ownerUid);
  const restaurantAccountDocumentId = requireOwnerUid(
    value.restaurantAccountDocumentId,
  );
  if (ownerUid !== restaurantAccountDocumentId) {
    invalidState();
  }
  const createdAtEpochMs = requireSafeEpochMilliseconds(
    value.createdAtEpochMs,
  );
  const updatedAtEpochMs = requireSafeEpochMilliseconds(
    value.updatedAtEpochMs,
  );
  if (
    createdAtEpochMs >
      nowEpochMs + subscriptionReturnLedgerClockSkewMilliseconds ||
    updatedAtEpochMs >
      nowEpochMs + subscriptionReturnLedgerClockSkewMilliseconds ||
    updatedAtEpochMs < createdAtEpochMs ||
    !Number.isSafeInteger(value.nextEventId) ||
    typeof value.nextEventId !== "number" ||
    value.nextEventId < 1 ||
    value.nextEventId > Number.MAX_SAFE_INTEGER
  ) {
    invalidState();
  }

  const rawContexts = requireMap(value.contexts);
  const rawEvents = requireMap(value.events);
  const contextKeys = Reflect.ownKeys(rawContexts);
  const eventKeys = Reflect.ownKeys(rawEvents);
  if (
    contextKeys.length > subscriptionReturnLedgerMaximumContexts ||
    eventKeys.length > subscriptionReturnLedgerMaximumEvents ||
    contextKeys.some(
      (key) => typeof key !== "string" || !tokenHashPattern.test(key),
    ) ||
    eventKeys.some(
      (key) => typeof key !== "string" || !isValidSubscriptionReturnEventId(key),
    )
  ) {
    invalidState();
  }

  const contexts: Record<string, MutableContext> = {};
  for (const key of contextKeys as string[]) {
    contexts[key] = requireContext(rawContexts[key], nowEpochMs);
  }
  const events: Record<string, MutableEvent> = {};
  for (const key of eventKeys as string[]) {
    const event = requireEvent(
      rawEvents[key],
      ownerUid,
      restaurantAccountDocumentId,
      nowEpochMs,
    );
    if (
      event.eventId !== key ||
      Number(event.eventId) >= value.nextEventId
    ) {
      invalidState();
    }
    events[key] = event;
  }
  for (const child of [
    ...Object.values(contexts),
    ...Object.values(events),
  ]) {
    if (
      child.createdAtEpochMs < createdAtEpochMs ||
      child.createdAtEpochMs > updatedAtEpochMs
    ) {
      invalidState();
    }
  }
  const consumedEventIds = new Set<string>();
  for (const context of Object.values(contexts)) {
    const consumedEventId = context.consumedEventId;
    if (consumedEventId === null) {
      continue;
    }
    if (
      Number(consumedEventId) >= value.nextEventId ||
      consumedEventIds.has(consumedEventId)
    ) {
      invalidState();
    }
    consumedEventIds.add(consumedEventId);
    const event = events[consumedEventId];
    if (
      event !== undefined &&
      subscriptionReturnFamilyForKind(event.returnKind) !== context.family
    ) {
      invalidState();
    }
  }

  return {
    schemaVersion: subscriptionReturnLedgerSchemaVersion,
    ownerUid,
    restaurantAccountDocumentId,
    nextEventId: value.nextEventId,
    contexts,
    events,
    createdAtEpochMs,
    updatedAtEpochMs,
  };
}

function createEmptyState(params: {
  ownerUid: string;
  restaurantAccountDocumentId: string;
  nowEpochMs: number;
}): MutableState {
  const nowEpochMs = requireNow(params.nowEpochMs);
  if (
    !isValidRestaurantAccountDocumentId(params.ownerUid) ||
    params.restaurantAccountDocumentId !== params.ownerUid
  ) {
    throw new SubscriptionReturnLedgerError("invalid_owner");
  }
  return {
    schemaVersion: subscriptionReturnLedgerSchemaVersion,
    ownerUid: params.ownerUid,
    restaurantAccountDocumentId: params.restaurantAccountDocumentId,
    nextEventId: 1,
    contexts: {},
    events: {},
    createdAtEpochMs: nowEpochMs,
    updatedAtEpochMs: nowEpochMs,
  };
}

function stateForOwner(params: {
  rawState: unknown;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  nowEpochMs: number;
}): MutableState {
  const state = cloneAndValidateState(params.rawState, params.nowEpochMs);
  if (
    state.ownerUid !== params.ownerUid ||
    state.restaurantAccountDocumentId !==
      params.restaurantAccountDocumentId
  ) {
    throw new SubscriptionReturnLedgerError("invalid_owner");
  }
  return state;
}

function cleanState(
  state: MutableState,
  nowEpochMs: number,
  preserveCompletedEventId?: string,
): boolean {
  let changed = false;
  for (const [eventId, event] of Object.entries(state.events)) {
    if (
      event.expiresAtEpochMs <= nowEpochMs ||
      (event.navigationClaimed &&
        event.refreshClaimed &&
        eventId !== preserveCompletedEventId)
    ) {
      delete state.events[eventId];
      changed = true;
    }
  }
  for (const [hash, context] of Object.entries(state.contexts)) {
    if (context.expiresAtEpochMs <= nowEpochMs) {
      delete state.contexts[hash];
      changed = true;
    }
  }
  return changed;
}

function touchState(state: MutableState, nowEpochMs: number): void {
  state.updatedAtEpochMs = Math.max(
    state.updatedAtEpochMs,
    nowEpochMs,
    state.createdAtEpochMs,
  );
}

function freezeState(state: MutableState): SubscriptionReturnLedgerState {
  return state;
}

export function reserveSubscriptionReturnContext(params: {
  rawState: unknown | undefined;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  tokenHash: string;
  family: SubscriptionReturnFamily;
  nowEpochMs: number;
}): SubscriptionReturnLedgerState {
  const tokenHash = requireTokenHash(params.tokenHash);
  const state = params.rawState === undefined
    ? createEmptyState(params)
    : stateForOwner(params);
  cleanState(state, params.nowEpochMs);
  if (state.contexts[tokenHash] !== undefined) {
    throw new SubscriptionReturnLedgerError("token_hash_collision");
  }
  if (
    Object.keys(state.contexts).length >=
      subscriptionReturnLedgerMaximumContexts
  ) {
    throw new SubscriptionReturnLedgerError("capacity_exhausted");
  }
  if (
    params.family !== "checkout" &&
    params.family !== "customerPortal"
  ) {
    invalidState();
  }
  const contextCreatedAtEpochMs = Math.max(
    params.nowEpochMs,
    state.createdAtEpochMs,
    state.updatedAtEpochMs,
  );
  state.contexts[tokenHash] = {
    schemaVersion: subscriptionReturnLedgerSchemaVersion,
    family: params.family,
    createdAtEpochMs: contextCreatedAtEpochMs,
    expiresAtEpochMs:
      contextCreatedAtEpochMs +
      subscriptionReturnLedgerLifetimeMilliseconds,
    ready: false,
    consumedEventId: null,
  };
  touchState(state, params.nowEpochMs);
  return freezeState(state);
}

export function markSubscriptionReturnContextReady(params: {
  rawState: unknown;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  tokenHash: string;
  nowEpochMs: number;
}): SubscriptionReturnLedgerState {
  const tokenHash = requireTokenHash(params.tokenHash);
  const state = stateForOwner(params);
  cleanState(state, params.nowEpochMs);
  const context = state.contexts[tokenHash];
  if (context === undefined || context.consumedEventId !== null) {
    throw new SubscriptionReturnLedgerError("context_unavailable");
  }
  context.ready = true;
  touchState(state, params.nowEpochMs);
  return freezeState(state);
}

export function removeUnreadySubscriptionReturnContext(params: {
  rawState: unknown;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  tokenHash: string;
  nowEpochMs: number;
}): SubscriptionReturnLedgerState {
  const tokenHash = requireTokenHash(params.tokenHash);
  const state = stateForOwner(params);
  cleanState(state, params.nowEpochMs);
  const context = state.contexts[tokenHash];
  if (
    context !== undefined &&
    context.ready === false &&
    context.consumedEventId === null
  ) {
    delete state.contexts[tokenHash];
  }
  touchState(state, params.nowEpochMs);
  return freezeState(state);
}

export function redeemSubscriptionReturnContext(params: {
  rawState: unknown;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  tokenHash: string;
  returnKind: SubscriptionReturnKind;
  nowEpochMs: number;
}): Readonly<{
  state: SubscriptionReturnLedgerState;
  created: boolean;
  eventId: string;
  returnKind: SubscriptionReturnKind;
}> {
  const tokenHash = requireTokenHash(params.tokenHash);
  if (!isSubscriptionReturnKind(params.returnKind)) {
    invalidState();
  }
  const state = stateForOwner(params);
  cleanState(state, params.nowEpochMs);
  const context = state.contexts[tokenHash];
  if (
    context === undefined ||
    context.ready !== true ||
    context.expiresAtEpochMs <= params.nowEpochMs ||
    context.family !== subscriptionReturnFamilyForKind(params.returnKind)
  ) {
    throw new SubscriptionReturnLedgerError("context_unavailable");
  }
  if (context.consumedEventId !== null) {
    const existingEvent = state.events[context.consumedEventId];
    if (
      existingEvent !== undefined &&
      existingEvent.returnKind !== params.returnKind
    ) {
      throw new SubscriptionReturnLedgerError("context_unavailable");
    }
    return Object.freeze({
      state: freezeState(state),
      created: false,
      eventId: context.consumedEventId,
      returnKind: existingEvent?.returnKind ?? params.returnKind,
    });
  }
  if (
    Object.keys(state.events).length >=
    subscriptionReturnLedgerMaximumEvents
  ) {
    throw new SubscriptionReturnLedgerError("capacity_exhausted");
  }
  if (state.nextEventId > subscriptionReturnLedgerMaximumEventId) {
    throw new SubscriptionReturnLedgerError("event_id_exhausted");
  }
  const eventId = String(state.nextEventId);
  state.nextEventId += 1;
  const eventCreatedAtEpochMs = Math.max(
    params.nowEpochMs,
    state.createdAtEpochMs,
    state.updatedAtEpochMs,
  );
  const event: MutableEvent = {
    schemaVersion: subscriptionReturnLedgerSchemaVersion,
    eventId,
    returnKind: params.returnKind,
    ownerUid: params.ownerUid,
    restaurantAccountDocumentId: params.restaurantAccountDocumentId,
    createdAtEpochMs: eventCreatedAtEpochMs,
    expiresAtEpochMs:
      eventCreatedAtEpochMs +
      subscriptionReturnLedgerLifetimeMilliseconds,
    navigationClaimed: false,
    refreshClaimed: false,
  };
  state.events[eventId] = event;
  context.consumedEventId = eventId;
  touchState(state, params.nowEpochMs);
  return Object.freeze({
    state: freezeState(state),
    created: true,
    eventId,
    returnKind: event.returnKind,
  });
}

export function claimSubscriptionReturnEvent(params: {
  rawState: unknown;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  eventId: string;
  claimType: SubscriptionReturnClaimType;
  nowEpochMs: number;
}): Readonly<{
  state: SubscriptionReturnLedgerState;
  claimed: boolean;
  eventId: string;
  returnKind: SubscriptionReturnKind;
}> {
  if (!isValidSubscriptionReturnEventId(params.eventId)) {
    invalidState();
  }
  if (!isSubscriptionReturnClaimType(params.claimType)) {
    invalidState();
  }
  const state = stateForOwner(params);
  cleanState(state, params.nowEpochMs, params.eventId);
  const event = state.events[params.eventId];
  if (
    event === undefined ||
    event.expiresAtEpochMs <= params.nowEpochMs
  ) {
    throw new SubscriptionReturnLedgerError("event_unavailable");
  }
  const alreadyClaimed = params.claimType === "navigation"
    ? event.navigationClaimed
    : event.refreshClaimed;
  if (!alreadyClaimed) {
    if (params.claimType === "navigation") {
      event.navigationClaimed = true;
    } else {
      event.refreshClaimed = true;
    }
  }
  touchState(state, params.nowEpochMs);
  return Object.freeze({
    state: freezeState(state),
    claimed: !alreadyClaimed,
    eventId: event.eventId,
    returnKind: event.returnKind,
  });
}

export function listSubscriptionReturnEvents(params: {
  rawState: unknown | undefined;
  ownerUid: string;
  restaurantAccountDocumentId: string;
  nowEpochMs: number;
}): Readonly<{
  state: SubscriptionReturnLedgerState | null;
  changed: boolean;
  events: readonly SubscriptionReturnSafeEvent[];
}> {
  if (params.rawState === undefined) {
    return Object.freeze({state: null, changed: false, events: []});
  }
  const state = stateForOwner(params);
  const changed = cleanState(state, params.nowEpochMs);
  if (changed) {
    touchState(state, params.nowEpochMs);
  }
  const events = Object.values(state.events)
    .sort((left, right) => Number(left.eventId) - Number(right.eventId))
    .slice(0, subscriptionReturnLedgerMaximumEvents)
    .map((event) => Object.freeze({
      eventId: event.eventId,
      returnKind: event.returnKind,
      navigationClaimed: event.navigationClaimed,
      refreshClaimed: event.refreshClaimed,
      expiresAtEpochMs: event.expiresAtEpochMs,
    }));
  return Object.freeze({
    state: freezeState(state),
    changed,
    events: Object.freeze(events),
  });
}
