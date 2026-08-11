import {
  buildDishProposalMemberDocument,
  buildDishProposalMembership,
  buildDishProposalResolutionIdentity,
  buildDishProposalSupporterDocument,
  createDishProposalGroupId,
  createDishProposalMemberId,
  createDishProposalSupporterId,
  dishProposalAutomaticDelayMilliseconds,
  dishProposalDocumentFingerprint,
  dishProposalGroupPath,
  dishProposalGroupVersion,
  dishProposalMemberCollection,
  dishProposalMemberPath,
  dishProposalMemberVersion,
  dishProposalSupporterCollection,
  dishProposalSupporterPath,
  dishProposalSupporterVersion,
  type DishProposalGroupDocument,
  type DishProposalMemberDocument,
  type DishProposalMembership,
  type DishProposalSupporterDocument,
} from "./dish_proposal_private_contract.js";
import type {
  DishProposalPrivateDatabase,
  DishProposalPrivateTransaction,
  DishProposalStoredDocument,
} from "./dish_proposal_private_store.js";

const groupMemberQueryLimit = 2;
const supporterMemberQueryLimit = 2;
const groupSupporterQueryLimit = 4;

const memberDocumentKeys = Object.freeze([
  "version",
  "proposalDocumentId",
  "groupId",
  "proposalType",
  "restaurantId",
  "sourceDishId",
  "mergeTargetDishId",
  "normalizedProposedName",
  "supporterUid",
  "trustedServerCreateTime",
  "membershipEnteredAt",
  "membershipGeneration",
  "currentPending",
  "fingerprint",
  "indexedAt",
] as const);

const supporterDocumentKeys = Object.freeze([
  "version",
  "groupId",
  "supporterUid",
  "present",
  "fingerprint",
  "indexedAt",
] as const);

const groupDocumentKeys = Object.freeze([
  "version",
  "groupId",
  "proposalType",
  "restaurantId",
  "sourceDishId",
  "mergeTargetDishId",
  "normalizedProposedName",
  "resolutionIdentitiesValid",
  "hasPendingMembers",
  "oldestTrustedServerCreateTime",
  "dueAt",
  "enoughSupporters",
  "autoEligible",
  "lastMembershipGeneration",
  "resolutionSequence",
  "activeJobId",
  "activeResolutionType",
  "cycleCutoffGeneration",
  "cycleCutoffAt",
  "fingerprint",
  "indexedAt",
] as const);

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

type MemberChange = Readonly<{
  memberDocumentId: string;
  existingMember: DishProposalMemberDocument | null;
  nextMembership: DishProposalMembership | null;
}>;

type SupporterDecision = Readonly<{
  documentId: string;
  groupId: string;
  supporterUid: string;
  present: boolean;
}>;

function readCanonicalString(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    return null;
  }
  return value;
}

function readExactDocumentSegment(value: unknown): string | null {
  return typeof value === "string" &&
      value.length > 0 &&
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      Buffer.byteLength(value, "utf8") <= 1_500
    ? value
    : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : null;
}

function readPrivateDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  const timestamp = value as { toDate?: () => unknown };
  if (typeof timestamp.toDate !== "function") {
    return null;
  }
  try {
    const date = timestamp.toDate();
    return date instanceof Date && Number.isFinite(date.getTime())
      ? date
      : null;
  } catch {
    return null;
  }
}

function invalidPrivateDocument(kind: "member" | "supporter" | "group"): never {
  throw new Error(
    `Stored private dish-proposal ${kind} has an invalid schema.`,
  );
}

function groupFingerprint(
  group: Omit<
    DishProposalGroupDocument,
    "version" | "fingerprint" | "indexedAt"
  >,
): string {
  return dishProposalDocumentFingerprint(
    dishProposalGroupVersion,
    [
      group.groupId,
      group.proposalType,
      group.restaurantId,
      group.sourceDishId,
      group.mergeTargetDishId,
      group.normalizedProposedName,
      group.resolutionIdentitiesValid,
      group.hasPendingMembers,
      group.oldestTrustedServerCreateTime?.toISOString() ?? null,
      group.dueAt?.toISOString() ?? null,
      group.enoughSupporters,
      group.autoEligible,
      group.lastMembershipGeneration,
      group.resolutionSequence,
      group.activeJobId,
      group.activeResolutionType,
      group.cycleCutoffGeneration,
      group.cycleCutoffAt?.toISOString() ?? null,
    ],
  );
}

export function parseDishProposalMemberDocument(
  document: DishProposalStoredDocument | null,
): DishProposalMemberDocument | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  if (!hasExactKeys(data, memberDocumentKeys)) {
    return invalidPrivateDocument("member");
  }
  const proposalType = data.proposalType === "rename" ||
      data.proposalType === "merge"
    ? data.proposalType
    : null;
  const proposalDocumentId = readExactDocumentSegment(data.proposalDocumentId);
  const groupId = readCanonicalString(data.groupId);
  const restaurantId = readCanonicalString(data.restaurantId);
  const sourceDishId = readCanonicalString(data.sourceDishId);
  const supporterUid = readCanonicalString(data.supporterUid);
  const trustedServerCreateTime = readPrivateDate(
    data.trustedServerCreateTime,
  );
  const membershipEnteredAt = readPrivateDate(data.membershipEnteredAt);
  const membershipGeneration = readInteger(data.membershipGeneration);
  const fingerprint = readCanonicalString(data.fingerprint);
  const indexedAt = readPrivateDate(data.indexedAt);
  const mergeTargetDishId = data.mergeTargetDishId === null
    ? null
    : readCanonicalString(data.mergeTargetDishId);
  const normalizedProposedName = data.normalizedProposedName === null
    ? null
    : typeof data.normalizedProposedName === "string"
    ? data.normalizedProposedName
    : null;
  if (
    data.version !== dishProposalMemberVersion ||
    proposalType === null ||
    proposalDocumentId === null ||
    groupId === null ||
    restaurantId === null ||
    sourceDishId === null ||
    supporterUid === null ||
    trustedServerCreateTime === null ||
    membershipEnteredAt === null ||
    membershipGeneration === null ||
    fingerprint === null ||
    indexedAt === null ||
    (data.mergeTargetDishId !== null && mergeTargetDishId === null) ||
    (data.normalizedProposedName !== null &&
      typeof data.normalizedProposedName !== "string") ||
    data.currentPending !== true
  ) {
    return invalidPrivateDocument("member");
  }
  const parsed: DishProposalMemberDocument = {
    version: dishProposalMemberVersion,
    proposalDocumentId,
    groupId,
    proposalType,
    restaurantId,
    sourceDishId,
    mergeTargetDishId,
    normalizedProposedName,
    supporterUid,
    trustedServerCreateTime,
    membershipEnteredAt,
    membershipGeneration,
    currentPending: true,
    fingerprint,
    indexedAt,
  };
  const expectedGroupId = createDishProposalGroupId(parsed);
  const rebuilt = buildDishProposalMemberDocument({
    membership: parsed,
    membershipEnteredAt: parsed.membershipEnteredAt,
    membershipGeneration: parsed.membershipGeneration,
    indexedAt: parsed.indexedAt,
  });
  const resolutionIdentity = buildDishProposalResolutionIdentity({
    type: parsed.proposalType,
    restaurantId: parsed.restaurantId,
    sourceDishId: parsed.sourceDishId,
    mergeTargetDishId: parsed.mergeTargetDishId,
    proposedName: parsed.normalizedProposedName,
  });
  if (
    document.id !== createDishProposalMemberId(parsed.proposalDocumentId) ||
    parsed.groupId !== expectedGroupId ||
    rebuilt.fingerprint !== parsed.fingerprint ||
    resolutionIdentity === null ||
    resolutionIdentity.proposalType !== parsed.proposalType ||
    resolutionIdentity.restaurantId !== parsed.restaurantId ||
    resolutionIdentity.sourceDishId !== parsed.sourceDishId ||
    resolutionIdentity.mergeTargetDishId !== parsed.mergeTargetDishId ||
    resolutionIdentity.normalizedProposedName !==
      parsed.normalizedProposedName ||
    (parsed.proposalType === "rename" &&
      (parsed.mergeTargetDishId !== null ||
        parsed.normalizedProposedName === null ||
        parsed.normalizedProposedName !==
          parsed.normalizedProposedName.trim().toLowerCase())) ||
    (parsed.proposalType === "merge" &&
      parsed.normalizedProposedName !== null)
  ) {
    return invalidPrivateDocument("member");
  }
  return parsed;
}

export function parseDishProposalGroupDocument(
  document: DishProposalStoredDocument | null,
): DishProposalGroupDocument | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  if (!hasExactKeys(data, groupDocumentKeys)) {
    return invalidPrivateDocument("group");
  }
  const proposalType = data.proposalType === "rename" ||
      data.proposalType === "merge"
    ? data.proposalType
    : null;
  const activeResolutionType = data.activeResolutionType === "apply" ||
      data.activeResolutionType === "reject"
    ? data.activeResolutionType
    : null;
  const groupId = readCanonicalString(data.groupId);
  const restaurantId = readCanonicalString(data.restaurantId);
  const sourceDishId = readCanonicalString(data.sourceDishId);
  const lastMembershipGeneration = readInteger(data.lastMembershipGeneration);
  const resolutionSequence = readInteger(data.resolutionSequence);
  const fingerprint = readCanonicalString(data.fingerprint);
  const indexedAt = readPrivateDate(data.indexedAt);
  const mergeTargetDishId = data.mergeTargetDishId === null
    ? null
    : readCanonicalString(data.mergeTargetDishId);
  const normalizedProposedName = data.normalizedProposedName === null
    ? null
    : typeof data.normalizedProposedName === "string"
    ? data.normalizedProposedName
    : null;
  const oldestTrustedServerCreateTime = readPrivateDate(
    data.oldestTrustedServerCreateTime,
  );
  const dueAt = readPrivateDate(data.dueAt);
  const activeJobId = data.activeJobId === null
    ? null
    : readCanonicalString(data.activeJobId);
  const cycleCutoffGeneration = data.cycleCutoffGeneration === null
    ? null
    : readInteger(data.cycleCutoffGeneration);
  const cycleCutoffAt = readPrivateDate(data.cycleCutoffAt);
  if (
    data.version !== dishProposalGroupVersion ||
    proposalType === null ||
    groupId === null ||
    restaurantId === null ||
    sourceDishId === null ||
    lastMembershipGeneration === null ||
    resolutionSequence === null ||
    fingerprint === null ||
    indexedAt === null ||
    typeof data.hasPendingMembers !== "boolean" ||
    data.resolutionIdentitiesValid !== true ||
    typeof data.enoughSupporters !== "boolean" ||
    typeof data.autoEligible !== "boolean" ||
    (data.mergeTargetDishId !== null && mergeTargetDishId === null) ||
    (data.normalizedProposedName !== null &&
      typeof data.normalizedProposedName !== "string") ||
    (data.oldestTrustedServerCreateTime !== null &&
      oldestTrustedServerCreateTime === null) ||
    (data.dueAt !== null && dueAt === null) ||
    (data.activeJobId !== null && activeJobId === null) ||
    (data.activeResolutionType !== null && activeResolutionType === null) ||
    (data.cycleCutoffGeneration !== null &&
      cycleCutoffGeneration === null) ||
    (data.cycleCutoffAt !== null && cycleCutoffAt === null)
  ) {
    return invalidPrivateDocument("group");
  }
  const parsed: DishProposalGroupDocument = {
    version: dishProposalGroupVersion,
    groupId,
    proposalType,
    restaurantId,
    sourceDishId,
    mergeTargetDishId,
    normalizedProposedName,
    resolutionIdentitiesValid: true,
    hasPendingMembers: data.hasPendingMembers,
    oldestTrustedServerCreateTime,
    dueAt,
    enoughSupporters: data.enoughSupporters,
    autoEligible: data.autoEligible,
    lastMembershipGeneration,
    resolutionSequence,
    activeJobId,
    activeResolutionType,
    cycleCutoffGeneration,
    cycleCutoffAt,
    fingerprint,
    indexedAt,
  };
  const {version: _version, fingerprint: _fingerprint, indexedAt: _indexedAt,
    ...fingerprintFields} = parsed;
  const expectedGroupId = createDishProposalGroupId(parsed);
  const resolutionIdentity = buildDishProposalResolutionIdentity({
    type: parsed.proposalType,
    restaurantId: parsed.restaurantId,
    sourceDishId: parsed.sourceDishId,
    mergeTargetDishId: parsed.mergeTargetDishId,
    proposedName: parsed.normalizedProposedName,
  });
  const activeFieldsAreComplete = parsed.activeJobId === null
    ? parsed.activeResolutionType === null &&
      parsed.cycleCutoffGeneration === null &&
      parsed.cycleCutoffAt === null
    : parsed.activeResolutionType !== null &&
      parsed.cycleCutoffGeneration !== null &&
      parsed.cycleCutoffAt !== null;
  if (
    document.id !== parsed.groupId ||
    parsed.groupId !== expectedGroupId ||
    groupFingerprint(fingerprintFields) !== parsed.fingerprint ||
    resolutionIdentity === null ||
    resolutionIdentity.proposalType !== parsed.proposalType ||
    resolutionIdentity.restaurantId !== parsed.restaurantId ||
    resolutionIdentity.sourceDishId !== parsed.sourceDishId ||
    resolutionIdentity.mergeTargetDishId !== parsed.mergeTargetDishId ||
    resolutionIdentity.normalizedProposedName !==
      parsed.normalizedProposedName ||
    !activeFieldsAreComplete ||
    (parsed.enoughSupporters && !parsed.hasPendingMembers) ||
    parsed.autoEligible !==
      (parsed.enoughSupporters && parsed.activeJobId === null) ||
    (parsed.hasPendingMembers !==
      (parsed.oldestTrustedServerCreateTime !== null && parsed.dueAt !== null)) ||
    (parsed.oldestTrustedServerCreateTime !== null &&
      parsed.dueAt !== null &&
      parsed.dueAt.getTime() !==
        parsed.oldestTrustedServerCreateTime.getTime() +
          dishProposalAutomaticDelayMilliseconds) ||
    (parsed.proposalType === "rename" &&
      (parsed.mergeTargetDishId !== null ||
        parsed.normalizedProposedName === null ||
        parsed.normalizedProposedName !==
          parsed.normalizedProposedName.trim().toLowerCase())) ||
    (parsed.proposalType === "merge" &&
      parsed.normalizedProposedName !== null)
  ) {
    return invalidPrivateDocument("group");
  }
  return parsed;
}

export function parseDishProposalSupporterDocument(
  document: DishProposalStoredDocument,
): DishProposalSupporterDocument | null {
  if (!hasExactKeys(document.data, supporterDocumentKeys)) {
    return invalidPrivateDocument("supporter");
  }
  const groupId = readCanonicalString(document.data.groupId);
  const supporterUid = readCanonicalString(document.data.supporterUid);
  const fingerprint = readCanonicalString(document.data.fingerprint);
  const indexedAt = readPrivateDate(document.data.indexedAt);
  if (
    document.data.version !== dishProposalSupporterVersion ||
    document.data.present !== true ||
    groupId === null ||
    supporterUid === null ||
    fingerprint === null ||
    indexedAt === null
  ) {
    return invalidPrivateDocument("supporter");
  }
  const parsed: DishProposalSupporterDocument = {
    version: dishProposalSupporterVersion,
    groupId,
    supporterUid,
    present: true,
    fingerprint,
    indexedAt,
  };
  const rebuilt = buildDishProposalSupporterDocument({
    groupId: parsed.groupId,
    supporterUid: parsed.supporterUid,
    indexedAt: parsed.indexedAt,
  });
  if (
    document.id !== createDishProposalSupporterId(
      parsed.groupId,
      parsed.supporterUid,
    ) ||
    rebuilt.fingerprint !== parsed.fingerprint
  ) {
    return invalidPrivateDocument("supporter");
  }
  return parsed;
}

function compareMembers(
  left: DishProposalMemberDocument,
  right: DishProposalMemberDocument,
): number {
  const byCreatedAt = left.trustedServerCreateTime.getTime() -
    right.trustedServerCreateTime.getTime();
  return byCreatedAt !== 0
    ? byCreatedAt
    : left.proposalDocumentId.localeCompare(right.proposalDocumentId);
}

function supporterDecisionKey(groupId: string, supporterUid: string): string {
  return createDishProposalSupporterId(groupId, supporterUid);
}

async function loadAffectedState(
  transaction: DishProposalPrivateTransaction,
  change: MemberChange,
): Promise<{
  groups: ReadonlyMap<string, DishProposalGroupDocument | null>;
  groupMembers: ReadonlyMap<string, readonly DishProposalStoredDocument[]>;
  groupSupporters: ReadonlyMap<string, readonly DishProposalStoredDocument[]>;
  supporterMembers: ReadonlyMap<string, readonly DishProposalStoredDocument[]>;
}> {
  const groupIds = new Set<string>();
  const supporterPairs = new Map<string, { groupId: string; supporterUid: string }>();
  if (change.existingMember !== null) {
    groupIds.add(change.existingMember.groupId);
    supporterPairs.set(
      supporterDecisionKey(
        change.existingMember.groupId,
        change.existingMember.supporterUid,
      ),
      {
        groupId: change.existingMember.groupId,
        supporterUid: change.existingMember.supporterUid,
      },
    );
  }
  if (change.nextMembership !== null) {
    groupIds.add(change.nextMembership.groupId);
    supporterPairs.set(
      supporterDecisionKey(
        change.nextMembership.groupId,
        change.nextMembership.supporterUid,
      ),
      {
        groupId: change.nextMembership.groupId,
        supporterUid: change.nextMembership.supporterUid,
      },
    );
  }

  const groups = new Map<string, DishProposalGroupDocument | null>();
  const groupMembers = new Map<string, readonly DishProposalStoredDocument[]>();
  const groupSupporters = new Map<string, readonly DishProposalStoredDocument[]>();
  for (const groupId of groupIds) {
    groups.set(
      groupId,
      parseDishProposalGroupDocument(
        await transaction.getDocument(dishProposalGroupPath(groupId)),
      ),
    );
    groupMembers.set(
      groupId,
      await transaction.queryDocuments({
        collectionPath: dishProposalMemberCollection,
        where: Object.freeze([
          { field: "groupId", operator: "==", value: groupId },
          { field: "currentPending", operator: "==", value: true },
        ]),
        orderBy: Object.freeze([
          { field: "trustedServerCreateTime", direction: "asc" },
          { field: "__name__", direction: "asc" },
        ]),
        limit: groupMemberQueryLimit,
      }),
    );
    groupSupporters.set(
      groupId,
      await transaction.queryDocuments({
        collectionPath: dishProposalSupporterCollection,
        where: Object.freeze([
          { field: "groupId", operator: "==", value: groupId },
        ]),
        orderBy: Object.freeze([{ field: "__name__", direction: "asc" }]),
        limit: groupSupporterQueryLimit,
      }),
    );
  }

  const supporterMembers = new Map<
    string,
    readonly DishProposalStoredDocument[]
  >();
  for (const [key, pair] of supporterPairs) {
    supporterMembers.set(
      key,
      await transaction.queryDocuments({
        collectionPath: dishProposalMemberCollection,
        where: Object.freeze([
          { field: "groupId", operator: "==", value: pair.groupId },
          { field: "supporterUid", operator: "==", value: pair.supporterUid },
          { field: "currentPending", operator: "==", value: true },
        ]),
        orderBy: Object.freeze([{ field: "__name__", direction: "asc" }]),
        limit: supporterMemberQueryLimit,
      }),
    );
  }
  return { groups, groupMembers, groupSupporters, supporterMembers };
}

function supporterDecisions(
  change: MemberChange,
  nextMember: DishProposalMemberDocument | null,
  supporterMembers: ReadonlyMap<string, readonly DishProposalStoredDocument[]>,
): ReadonlyMap<string, SupporterDecision> {
  const pairs = new Map<string, { groupId: string; supporterUid: string }>();
  if (change.existingMember !== null) {
    pairs.set(
      supporterDecisionKey(
        change.existingMember.groupId,
        change.existingMember.supporterUid,
      ),
      {
        groupId: change.existingMember.groupId,
        supporterUid: change.existingMember.supporterUid,
      },
    );
  }
  if (nextMember !== null) {
    pairs.set(
      supporterDecisionKey(nextMember.groupId, nextMember.supporterUid),
      { groupId: nextMember.groupId, supporterUid: nextMember.supporterUid },
    );
  }

  const decisions = new Map<string, SupporterDecision>();
  for (const [documentId, pair] of pairs) {
    const existingOthers = (supporterMembers.get(documentId) ?? [])
      .filter((document) => document.id !== change.memberDocumentId)
      .map(parseDishProposalMemberDocument)
      .some((member) =>
        member !== null &&
        member.groupId === pair.groupId &&
        member.supporterUid === pair.supporterUid
      );
    const nextMatches = nextMember !== null &&
      nextMember.groupId === pair.groupId &&
      nextMember.supporterUid === pair.supporterUid;
    decisions.set(documentId, {
      documentId,
      ...pair,
      present: existingOthers || nextMatches,
    });
  }
  return decisions;
}

function nextGroupDocument(value: {
  groupId: string;
  existingGroup: DishProposalGroupDocument | null;
  currentMemberDocuments: readonly DishProposalStoredDocument[];
  currentSupporterDocuments: readonly DishProposalStoredDocument[];
  change: MemberChange;
  nextMember: DishProposalMemberDocument | null;
  decisions: ReadonlyMap<string, SupporterDecision>;
  now: Date;
}): DishProposalGroupDocument | null {
  const members = value.currentMemberDocuments
    .filter((document) => document.id !== value.change.memberDocumentId)
    .map(parseDishProposalMemberDocument)
    .filter((member): member is DishProposalMemberDocument => member !== null);
  if (value.nextMember?.groupId === value.groupId) {
    members.push(value.nextMember);
  }
  members.sort(compareMembers);
  const representative = members[0] ?? null;
  const activeJobId = value.existingGroup?.activeJobId ?? null;
  if (representative === null && activeJobId === null) {
    return null;
  }

  const supporterIds = new Set(
    value.currentSupporterDocuments
      .filter((document) =>
        parseDishProposalSupporterDocument(document) !== null
      )
      .map((document) => document.id),
  );
  for (const decision of value.decisions.values()) {
    if (decision.groupId !== value.groupId) {
      continue;
    }
    if (decision.present) {
      supporterIds.add(decision.documentId);
    } else {
      supporterIds.delete(decision.documentId);
    }
  }

  const identity = representative ?? value.existingGroup;
  if (identity === null) {
    throw new Error("Active dish-proposal group lost its canonical identity.");
  }
  const oldestTrustedServerCreateTime = representative
    ?.trustedServerCreateTime ?? null;
  const dueAt = oldestTrustedServerCreateTime === null
    ? null
    : new Date(
        oldestTrustedServerCreateTime.getTime() +
        dishProposalAutomaticDelayMilliseconds,
      );
  const enoughSupporters = representative !== null &&
    supporterIds.size >= (identity.proposalType === "merge" ? 2 : 1);
  const lastMembershipGeneration = Math.max(
    value.existingGroup?.lastMembershipGeneration ?? 0,
    value.nextMember?.groupId === value.groupId
      ? value.nextMember.membershipGeneration
      : 0,
  );
  const core = {
    groupId: value.groupId,
    proposalType: identity.proposalType,
    restaurantId: identity.restaurantId,
    sourceDishId: identity.sourceDishId,
    mergeTargetDishId: identity.mergeTargetDishId,
    normalizedProposedName: identity.normalizedProposedName,
    resolutionIdentitiesValid: true as const,
    hasPendingMembers: representative !== null,
    oldestTrustedServerCreateTime,
    dueAt,
    enoughSupporters,
    autoEligible: enoughSupporters && activeJobId === null,
    lastMembershipGeneration,
    resolutionSequence: value.existingGroup?.resolutionSequence ?? 0,
    activeJobId,
    activeResolutionType: value.existingGroup?.activeResolutionType ?? null,
    cycleCutoffGeneration:
      value.existingGroup?.cycleCutoffGeneration ?? null,
    cycleCutoffAt: value.existingGroup?.cycleCutoffAt ?? null,
  };
  return {
    version: dishProposalGroupVersion,
    ...core,
    fingerprint: groupFingerprint(core),
    indexedAt: value.now,
  };
}

export async function applyDishProposalMemberChange(
  transaction: DishProposalPrivateTransaction,
  change: MemberChange,
  now: Date,
): Promise<DishProposalMemberDocument | null> {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Dish-proposal reconciliation time is invalid.");
  }
  const state = await loadAffectedState(transaction, change);
  const sameMembership = change.existingMember !== null &&
    change.nextMembership !== null &&
    change.existingMember.proposalDocumentId ===
      change.nextMembership.proposalDocumentId &&
    change.existingMember.groupId === change.nextMembership.groupId &&
    change.existingMember.supporterUid ===
      change.nextMembership.supporterUid &&
    change.existingMember.trustedServerCreateTime.getTime() ===
      change.nextMembership.trustedServerCreateTime.getTime();
  const nextGeneration = change.nextMembership === null
    ? null
    : sameMembership
    ? change.existingMember!.membershipGeneration
    : (state.groups.get(change.nextMembership.groupId)
        ?.lastMembershipGeneration ?? 0) + 1;
  const nextMember = change.nextMembership === null || nextGeneration === null
    ? null
    : buildDishProposalMemberDocument({
        membership: change.nextMembership,
        membershipEnteredAt: sameMembership
          ? change.existingMember!.membershipEnteredAt
          : now,
        membershipGeneration: nextGeneration,
        indexedAt: now,
      });
  const decisions = supporterDecisions(
    change,
    nextMember,
    state.supporterMembers,
  );
  const groupDocuments = new Map<string, DishProposalGroupDocument | null>();
  for (const [groupId, existingGroup] of state.groups) {
    groupDocuments.set(
      groupId,
      nextGroupDocument({
        groupId,
        existingGroup,
        currentMemberDocuments: state.groupMembers.get(groupId) ?? [],
        currentSupporterDocuments: state.groupSupporters.get(groupId) ?? [],
        change,
        nextMember,
        decisions,
        now,
      }),
    );
  }

  if (nextMember === null) {
    transaction.deleteDocument(
      `${dishProposalMemberCollection}/${change.memberDocumentId}`,
    );
  } else {
    transaction.setDocument(
      `${dishProposalMemberCollection}/${change.memberDocumentId}`,
      nextMember,
    );
  }
  for (const decision of decisions.values()) {
    const path = dishProposalSupporterPath(
      decision.groupId,
      decision.supporterUid,
    );
    if (decision.present) {
      transaction.setDocument(
        path,
        buildDishProposalSupporterDocument({
          groupId: decision.groupId,
          supporterUid: decision.supporterUid,
          indexedAt: now,
        }),
      );
    } else {
      transaction.deleteDocument(path);
    }
  }
  for (const [groupId, document] of groupDocuments) {
    if (document === null) {
      transaction.deleteDocument(dishProposalGroupPath(groupId));
    } else {
      transaction.setDocument(dishProposalGroupPath(groupId), document);
    }
  }
  return nextMember;
}

export type DishProposalMaintenanceResult = Readonly<{
  proposalDocumentId: string;
  previousGroupId: string | null;
  currentGroupId: string | null;
  memberWritten: boolean;
  memberDeleted: boolean;
}>;

export async function maintainDishEditProposalPrivateState(
  database: DishProposalPrivateDatabase,
  proposalDocumentId: string,
  now: Date,
): Promise<DishProposalMaintenanceResult> {
  const memberPath = dishProposalMemberPath(proposalDocumentId);
  return database.runTransaction(async (transaction) => {
    const [sourceDocument, storedMemberDocument] = await Promise.all([
      transaction.getDocument(`dish_edit_proposals/${proposalDocumentId}`),
      transaction.getDocument(memberPath),
    ]);
    const existingMember = parseDishProposalMemberDocument(storedMemberDocument);
    if (storedMemberDocument !== null && existingMember === null) {
      throw new Error("Stored private dish-proposal member has an invalid schema.");
    }
    const nextMembership = buildDishProposalMembership({
      proposalDocumentId,
      source: sourceDocument?.data ?? null,
      trustedServerCreateTime: sourceDocument?.createTime ?? null,
    });
    await applyDishProposalMemberChange(
      transaction,
      {
        memberDocumentId: memberPath.slice(memberPath.lastIndexOf("/") + 1),
        existingMember,
        nextMembership,
      },
      now,
    );
    return {
      proposalDocumentId,
      previousGroupId: existingMember?.groupId ?? null,
      currentGroupId: nextMembership?.groupId ?? null,
      memberWritten: nextMembership !== null,
      memberDeleted: existingMember !== null && nextMembership === null,
    };
  });
}
