"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDishProposalResolutionIdentity,
  dishProposalAutomaticDelayMilliseconds,
  createDishProposalMemberId,
  dishProposalGroupCollection,
  dishProposalGroupPath,
  dishProposalMemberCollection,
  dishProposalMemberPath,
  dishProposalSupporterCollection,
  dishProposalSupporterPath,
} = require("../lib/dish_proposal_private_contract.js");
const {
  maintainDishEditProposalPrivateState,
  parseDishProposalGroupDocument,
  parseDishProposalMemberDocument,
  parseDishProposalSupporterDocument,
} = require("../lib/dish_proposal_private_maintenance.js");

const sourceCollection = "dish_edit_proposals";
const privateCollections = new Set([
  dishProposalMemberCollection,
  dishProposalSupporterCollection,
  dishProposalGroupCollection,
]);

function cloneValue(value) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)]),
    );
  }
  return value;
}

function valueFor(document, field) {
  return field === "__name__" ? document.id : document.data[field];
}

function comparable(value) {
  return value instanceof Date ? value.getTime() : value;
}

function compareValues(left, right) {
  const comparableLeft = comparable(left);
  const comparableRight = comparable(right);
  if (comparableLeft === comparableRight) {
    return 0;
  }
  if (comparableLeft === undefined || comparableLeft === null) {
    return -1;
  }
  if (comparableRight === undefined || comparableRight === null) {
    return 1;
  }
  return comparableLeft < comparableRight ? -1 : 1;
}

function matchesCondition(document, condition) {
  const comparison = compareValues(
    valueFor(document, condition.field),
    condition.value,
  );
  switch (condition.operator) {
    case "==":
      return comparison === 0;
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    default:
      throw new Error(`Unsupported fake query operator: ${condition.operator}`);
  }
}

function compareDocuments(left, right, orderBy) {
  for (const order of orderBy) {
    const comparison = compareValues(
      valueFor(left, order.field),
      valueFor(right, order.field),
    );
    if (comparison !== 0) {
      return order.direction === "desc" ? -comparison : comparison;
    }
  }
  return left.id.localeCompare(right.id);
}

function compareDocumentToCursor(document, cursor, orderBy) {
  for (let index = 0; index < orderBy.length; index += 1) {
    const order = orderBy[index];
    const comparison = compareValues(
      valueFor(document, order.field),
      cursor[index],
    );
    if (comparison !== 0) {
      return order.direction === "desc" ? -comparison : comparison;
    }
  }
  return 0;
}

class InMemoryDishProposalDatabase {
  constructor() {
    this.records = new Map();
    this.getLog = [];
    this.queryLog = [];
  }

  createSource(proposalDocumentId, data, createTime) {
    const path = `${sourceCollection}/${proposalDocumentId}`;
    assert.equal(this.records.has(path), false, `Source already exists: ${path}`);
    this.records.set(path, {
      data: cloneValue(data),
      createTime: new Date(createTime.getTime()),
    });
  }

  replaceSourceData(proposalDocumentId, data) {
    const path = `${sourceCollection}/${proposalDocumentId}`;
    const existing = this.records.get(path);
    assert.notEqual(existing, undefined, `Missing source: ${path}`);
    this.records.set(path, {
      data: cloneValue(data),
      createTime: new Date(existing.createTime.getTime()),
    });
  }

  replaceDocumentData(path, data) {
    const existing = this.records.get(path);
    assert.notEqual(existing, undefined, `Missing document: ${path}`);
    this.records.set(path, {
      data: cloneValue(data),
      createTime: existing.createTime === null
        ? null
        : new Date(existing.createTime.getTime()),
    });
  }

  deleteSource(proposalDocumentId) {
    this.records.delete(`${sourceCollection}/${proposalDocumentId}`);
  }

  read(path) {
    const record = this.records.get(path);
    return record === undefined ? null : cloneValue(record.data);
  }

  documentsInCollection(collectionPath) {
    const prefix = `${collectionPath}/`;
    return [...this.records.entries()]
      .filter(([path]) => {
        if (!path.startsWith(prefix)) {
          return false;
        }
        return !path.slice(prefix.length).includes("/");
      })
      .map(([path, record]) => ({
        path,
        id: path.slice(prefix.length),
        data: cloneValue(record.data),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  privateDocuments() {
    return [...privateCollections]
      .flatMap((collectionPath) => this.documentsInCollection(collectionPath));
  }

  async runTransaction(operation) {
    const working = new Map(
      [...this.records.entries()].map(([path, record]) => [
        path,
        {
          data: cloneValue(record.data),
          createTime: record.createTime === null
            ? null
            : new Date(record.createTime.getTime()),
        },
      ]),
    );
    const snapshotForPath = (path) => {
      const record = working.get(path);
      if (record === undefined) {
        return null;
      }
      return {
        id: path.slice(path.lastIndexOf("/") + 1),
        data: cloneValue(record.data),
        createTime: record.createTime === null
          ? null
          : new Date(record.createTime.getTime()),
      };
    };
    const transaction = {
      getDocument: async (path) => {
        this.getLog.push(path);
        return snapshotForPath(path);
      },
      queryDocuments: async (query) => {
        assert.equal(
          query.collectionPath === sourceCollection,
          false,
          "Production maintenance must never scan the proposal collection.",
        );
        assert.equal(
          privateCollections.has(query.collectionPath),
          true,
          `Unexpected collection query: ${query.collectionPath}`,
        );
        assert.equal(Number.isInteger(query.limit), true);
        assert.ok(query.limit > 0, "Every private query must have a limit.");

        const prefix = `${query.collectionPath}/`;
        const orderBy = query.orderBy ?? [];
        let documents = [...working.entries()]
          .filter(([path]) =>
            path.startsWith(prefix) &&
            !path.slice(prefix.length).includes("/")
          )
          .map(([path]) => snapshotForPath(path))
          .filter((document) => document !== null)
          .filter((document) =>
            (query.where ?? []).every((condition) =>
              matchesCondition(document, condition)
            )
          )
          .sort((left, right) => compareDocuments(left, right, orderBy));
        if (query.startAfter !== undefined && query.startAfter !== null) {
          documents = documents.filter((document) =>
            compareDocumentToCursor(
              document,
              query.startAfter,
              orderBy,
            ) > 0
          );
        }
        documents = documents.slice(0, query.limit);
        this.queryLog.push({
          collectionPath: query.collectionPath,
          where: cloneValue(query.where ?? []),
          orderBy: cloneValue(orderBy),
          startAfter: cloneValue(query.startAfter ?? null),
          limit: query.limit,
          returned: documents.length,
        });
        return documents;
      },
      setDocument: (path, data, options) => {
        const existing = working.get(path);
        working.set(path, {
          data: options?.merge === true && existing !== undefined
            ? {...cloneValue(existing.data), ...cloneValue(data)}
            : cloneValue(data),
          createTime: existing?.createTime ?? null,
        });
      },
      deleteDocument: (path) => {
        working.delete(path);
      },
    };

    const result = await operation(transaction);
    this.records = working;
    return result;
  }
}

function renameProposal(overrides = {}) {
  return {
    status: "pending",
    type: "rename",
    restaurantId: "restaurant-1",
    sourceDishId: "dish-source",
    proposedName: "Garlic Soup",
    userId: "supporter-1",
    ...overrides,
  };
}

function mergeProposal(overrides = {}) {
  return {
    status: "pending",
    type: "merge",
    restaurantId: "restaurant-1",
    sourceDishId: "dish-source",
    mergeTargetDishId: "dish-target",
    userId: "supporter-1",
    ...overrides,
  };
}

test("resolution identity contract accepts production aliases and rejects ambiguity", () => {
  const maxMultibyteEntityId = "é".repeat(750);
  const accepted = [
    {
      source: {
        type: "rename",
        restaurantId: "restaurant-1",
        targetDishId: "rename-source",
        proposedName: "A".repeat(2_000),
      },
      expected: {
        proposalType: "rename",
        restaurantId: "restaurant-1",
        sourceDishId: "rename-source",
        mergeTargetDishId: null,
        normalizedProposedName: "a".repeat(2_000),
      },
    },
    {
      source: {
        type: "rename",
        restaurantId: "餐厅 一",
        targetDishId: "crème brûlée",
        proposedName: "Crème Brûlée",
      },
      expected: {
        proposalType: "rename",
        restaurantId: "餐厅 一",
        sourceDishId: "crème brûlée",
        mergeTargetDishId: null,
        normalizedProposedName: "crème brûlée",
      },
    },
    {
      source: {
        type: "rename",
        restaurantId: "restaurant-1",
        targetDishId: maxMultibyteEntityId,
        proposedName: "Byte Boundary",
      },
      expected: {
        proposalType: "rename",
        restaurantId: "restaurant-1",
        sourceDishId: maxMultibyteEntityId,
        mergeTargetDishId: null,
        normalizedProposedName: "byte boundary",
      },
    },
    {
      source: {
        type: "merge",
        restaurantId: "restaurant-1",
        targetDishId: "standard-source",
        mergeTargetDishId: "standard-target",
      },
      expected: {
        proposalType: "merge",
        restaurantId: "restaurant-1",
        sourceDishId: "standard-source",
        mergeTargetDishId: "standard-target",
        normalizedProposedName: null,
      },
    },
    {
      source: {
        type: "merge",
        restaurantId: "restaurant-1",
        sourceDishId: "duplicate-source",
        targetDishId: "duplicate-target",
        mergeTargetDishId: "duplicate-target",
      },
      expected: {
        proposalType: "merge",
        restaurantId: "restaurant-1",
        sourceDishId: "duplicate-source",
        mergeTargetDishId: "duplicate-target",
        normalizedProposedName: null,
      },
    },
    {
      source: {
        targetType: "merge",
        restaurantId: "restaurant-1",
        sourceDishId: "legacy-source",
        targetId: "legacy-target",
      },
      expected: {
        proposalType: "merge",
        restaurantId: "restaurant-1",
        sourceDishId: "legacy-source",
        mergeTargetDishId: "legacy-target",
        normalizedProposedName: null,
      },
    },
  ];
  for (const {source, expected} of accepted) {
    assert.deepEqual(buildDishProposalResolutionIdentity(source), expected);
  }

  const invalid = [
    {type: "rename", targetType: "merge", restaurantId: "restaurant-1",
      targetDishId: "dish-source"},
    {type: "rename", restaurantId: " restaurant-1",
      targetDishId: "dish-source"},
    {type: "rename", restaurantId: "restaurant-1",
      targetDishId: "dish/source"},
    {type: "rename", restaurantId: "restaurant-1", targetDishId: ""},
    {type: "rename", restaurantId: "restaurant-1", targetDishId: "."},
    {type: "rename", restaurantId: "restaurant-1", targetDishId: ".."},
    {type: "rename", restaurantId: "restaurant-1",
      targetDishId: "__reserved__"},
    {type: "rename", restaurantId: "restaurant-1",
      targetDishId: "dish-source "},
    {type: "rename", restaurantId: "restaurant-1",
      targetDishId: "dish\u0000source"},
    {type: "rename", restaurantId: "restaurant-1",
      targetDishId: "x".repeat(1_501)},
    {type: "rename", restaurantId: "restaurant-1",
      targetDishId: "é".repeat(751)},
    {type: "rename", restaurantId: "restaurant-1",
      sourceDishId: "source-a", targetDishId: "source-b"},
    {type: "rename", restaurantId: "restaurant-1",
      targetDishId: "source-a", targetId: "source-b"},
    {type: "merge", restaurantId: "restaurant-1",
      targetDishId: "source-a"},
    {type: "merge", restaurantId: "restaurant-1",
      targetDishId: "same", mergeTargetDishId: "same"},
    {type: "merge", restaurantId: "restaurant-1",
      sourceDishId: "source-a", targetDishId: "target-a",
      mergeTargetDishId: "target-b"},
  ];
  for (const source of invalid) {
    assert.equal(buildDishProposalResolutionIdentity(source), null);
  }
});

function expectDate(actual, expected, label) {
  assert.equal(actual instanceof Date, true, `${label} must be a Date`);
  assert.equal(actual.toISOString(), expected.toISOString(), label);
}

function addMilliseconds(date, milliseconds) {
  return new Date(date.getTime() + milliseconds);
}

function storedDocument(database, path, data = database.read(path)) {
  assert.notEqual(data, null, `Missing stored document: ${path}`);
  return {
    id: path.slice(path.lastIndexOf("/") + 1),
    data: cloneValue(data),
    createTime: null,
  };
}

function withData(document, patch) {
  return {
    ...document,
    data: {...cloneValue(document.data), ...cloneValue(patch)},
  };
}

function assertInvalidPrivateDocument(parse, document, patch, label) {
  assert.throws(
    () => parse(withData(document, patch)),
    /Stored private dish-proposal .* has an invalid schema\./,
    label,
  );
}

function assertBoundedPrivateQueries(database) {
  assert.ok(database.queryLog.length > 0);
  for (const query of database.queryLog) {
    assert.equal(privateCollections.has(query.collectionPath), true);
    assert.ok(query.limit >= 1 && query.limit <= 4);
    assert.ok(query.returned <= query.limit);
  }
  assert.equal(
    database.queryLog.some((query) =>
      query.collectionPath === sourceCollection
    ),
    false,
  );
  assert.equal(
    database.getLog.some((path) => path === sourceCollection),
    false,
  );
  assert.equal(
    database.getLog
      .filter((path) => path.startsWith(`${sourceCollection}/`))
      .every((path) => path.split("/").length === 2),
    true,
  );
}

test("create, duplicate, and same-group update preserve trusted membership and privacy", async () => {
  const database = new InMemoryDishProposalDatabase();
  const sourceCreateTime = new Date("2026-08-01T10:15:00.000Z");
  const firstMaintenanceAt = new Date("2026-08-10T10:00:00.000Z");
  const proposalDocumentId = "rename-proposal";
  database.createSource(
    proposalDocumentId,
    renameProposal({
      createdAt: new Date("2099-12-31T23:59:59.000Z"),
      reason: "private-reason-canary",
      email: "private-email-canary@example.invalid",
      phone: "private-phone-canary",
      arbitraryProposalMap: {token: "private-token-canary"},
      paymentReference: "private-payment-canary",
    }),
    sourceCreateTime,
  );

  const created = await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    firstMaintenanceAt,
  );
  const memberPath = dishProposalMemberPath(proposalDocumentId);
  const firstMember = database.read(memberPath);
  assert.deepEqual(created, {
    proposalDocumentId,
    previousGroupId: null,
    currentGroupId: firstMember.groupId,
    memberWritten: true,
    memberDeleted: false,
  });
  expectDate(
    firstMember.trustedServerCreateTime,
    sourceCreateTime,
    "member uses Firestore createTime",
  );
  expectDate(
    firstMember.membershipEnteredAt,
    firstMaintenanceAt,
    "initial membership boundary",
  );
  assert.equal(firstMember.membershipGeneration, 1);

  const firstGroup = database.read(dishProposalGroupPath(firstMember.groupId));
  expectDate(
    firstGroup.oldestTrustedServerCreateTime,
    sourceCreateTime,
    "group uses trusted server creation time",
  );
  expectDate(
    firstGroup.dueAt,
    addMilliseconds(sourceCreateTime, dishProposalAutomaticDelayMilliseconds),
    "dueAt is trusted createTime plus exactly three days",
  );
  assert.equal(firstGroup.enoughSupporters, true);
  assert.equal(firstGroup.autoEligible, true);
  assert.equal(firstGroup.resolutionIdentitiesValid, true);

  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T11:00:00.000Z"),
  );
  const duplicateMember = database.read(memberPath);
  expectDate(
    duplicateMember.membershipEnteredAt,
    firstMaintenanceAt,
    "duplicate trigger preserves membership boundary",
  );
  assert.equal(duplicateMember.membershipGeneration, 1);

  database.replaceSourceData(
    proposalDocumentId,
    renameProposal({
      proposedName: "  GARLIC SOUP  ",
      createdAt: new Date("1900-01-01T00:00:00.000Z"),
      reason: "updated-private-reason-canary",
      reviewText: "private-review-text-canary",
      profile: {displayName: "private-profile-canary"},
    }),
  );
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T12:00:00.000Z"),
  );
  const updatedMember = database.read(memberPath);
  assert.equal(updatedMember.groupId, firstMember.groupId);
  assert.equal(updatedMember.normalizedProposedName, "garlic soup");
  expectDate(
    updatedMember.membershipEnteredAt,
    firstMaintenanceAt,
    "same logical group preserves membership boundary",
  );
  assert.equal(updatedMember.membershipGeneration, 1);
  expectDate(
    database.read(dishProposalGroupPath(firstMember.groupId)).dueAt,
    addMilliseconds(sourceCreateTime, dishProposalAutomaticDelayMilliseconds),
    "client-created createdAt never controls dueAt",
  );

  const serializedPrivateState = JSON.stringify(database.privateDocuments());
  for (const canary of [
    "private-reason-canary",
    "private-email-canary@example.invalid",
    "private-phone-canary",
    "private-token-canary",
    "private-payment-canary",
    "updated-private-reason-canary",
    "private-review-text-canary",
    "private-profile-canary",
  ]) {
    assert.equal(serializedPrivateState.includes(canary), false, canary);
  }
  assertBoundedPrivateQueries(database);
});

test("invalid resolution identities clean and later rematerialize safely", async () => {
  const database = new InMemoryDishProposalDatabase();
  const proposalDocumentId = "resolution-identity-cleanup";
  database.createSource(
    proposalDocumentId,
    mergeProposal(),
    new Date("2026-08-02T03:04:05.000Z"),
  );
  const initial = await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T12:30:00.000Z"),
  );
  assert.notEqual(initial.currentGroupId, null);
  assert.equal(database.privateDocuments().length, 3);

  database.replaceSourceData(proposalDocumentId, mergeProposal({
    sourceDishId: "unsafe/source",
  }));
  const cleaned = await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T12:31:00.000Z"),
  );
  assert.deepEqual(cleaned, {
    proposalDocumentId,
    previousGroupId: initial.currentGroupId,
    currentGroupId: null,
    memberWritten: false,
    memberDeleted: true,
  });
  assert.equal(database.privateDocuments().length, 0);

  database.replaceSourceData(proposalDocumentId, mergeProposal());
  const rematerialized = await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T12:31:30.000Z"),
  );
  assert.equal(rematerialized.currentGroupId, initial.currentGroupId);
  assert.equal(rematerialized.memberWritten, true);
  assert.equal(rematerialized.memberDeleted, false);
  assert.equal(database.privateDocuments().length, 3);
  const restoredGroup = database.read(
    dishProposalGroupPath(rematerialized.currentGroupId),
  );
  assert.notEqual(restoredGroup, null);
  assert.equal(restoredGroup.resolutionIdentitiesValid, true);
  expectDate(
    restoredGroup.dueAt,
    addMilliseconds(
      new Date("2026-08-02T03:04:05.000Z"),
      dishProposalAutomaticDelayMilliseconds,
    ),
    "rematerialized dueAt",
  );

  const invalidDatabase = new InMemoryDishProposalDatabase();
  invalidDatabase.createSource(
    "never-materialized",
    mergeProposal({mergeTargetDishId: null}),
    new Date("2026-08-02T03:04:06.000Z"),
  );
  const rejected = await maintainDishEditProposalPrivateState(
    invalidDatabase,
    "never-materialized",
    new Date("2026-08-10T12:32:00.000Z"),
  );
  assert.equal(rejected.currentGroupId, null);
  assert.equal(rejected.memberWritten, false);
  assert.equal(rejected.memberDeleted, false);
  assert.equal(invalidDatabase.privateDocuments().length, 0);
  assertBoundedPrivateQueries(database);
});

test("a proposal without client createdAt still gets trusted automatic due behavior", async () => {
  const database = new InMemoryDishProposalDatabase();
  const sourceCreateTime = new Date("2026-08-02T03:04:05.000Z");
  database.createSource(
    "missing-client-created-at",
    renameProposal({proposedName: "Tomato Bisque"}),
    sourceCreateTime,
  );

  await maintainDishEditProposalPrivateState(
    database,
    "missing-client-created-at",
    new Date("2026-08-10T13:00:00.000Z"),
  );
  const member = database.read(
    dishProposalMemberPath("missing-client-created-at"),
  );
  const group = database.read(dishProposalGroupPath(member.groupId));
  expectDate(member.trustedServerCreateTime, sourceCreateTime, "trusted time");
  expectDate(
    group.dueAt,
    addMilliseconds(sourceCreateTime, dishProposalAutomaticDelayMilliseconds),
    "missing client createdAt does not prevent dueAt",
  );
  assertBoundedPrivateQueries(database);
});

test("group key, merge target, and supporter changes reconcile both sides", async () => {
  const database = new InMemoryDishProposalDatabase();
  const proposalDocumentId = "changing-proposal";
  database.createSource(
    proposalDocumentId,
    renameProposal(),
    new Date("2026-08-01T00:00:00.000Z"),
  );
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T01:00:00.000Z"),
  );
  const memberPath = dishProposalMemberPath(proposalDocumentId);
  const renameMember = database.read(memberPath);

  const renamedAt = new Date("2026-08-10T02:00:00.000Z");
  database.replaceSourceData(
    proposalDocumentId,
    renameProposal({proposedName: "Onion Soup"}),
  );
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    renamedAt,
  );
  const newRenameMember = database.read(memberPath);
  assert.notEqual(newRenameMember.groupId, renameMember.groupId);
  assert.equal(database.read(dishProposalGroupPath(renameMember.groupId)), null);
  expectDate(
    newRenameMember.membershipEnteredAt,
    renamedAt,
    "changed group receives a new membership boundary",
  );

  const changedToMergeAt = new Date("2026-08-10T03:00:00.000Z");
  database.replaceSourceData(
    proposalDocumentId,
    mergeProposal({mergeTargetDishId: "dish-target-a"}),
  );
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    changedToMergeAt,
  );
  const firstMergeMember = database.read(memberPath);
  assert.notEqual(firstMergeMember.groupId, newRenameMember.groupId);
  assert.equal(
    database.read(dishProposalGroupPath(newRenameMember.groupId)),
    null,
  );
  expectDate(
    firstMergeMember.membershipEnteredAt,
    changedToMergeAt,
    "type/group transition resets the boundary",
  );

  const changedMergeTargetAt = new Date("2026-08-10T04:00:00.000Z");
  database.replaceSourceData(
    proposalDocumentId,
    mergeProposal({mergeTargetDishId: "dish-target-b"}),
  );
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    changedMergeTargetAt,
  );
  const secondMergeMember = database.read(memberPath);
  assert.notEqual(secondMergeMember.groupId, firstMergeMember.groupId);
  assert.equal(secondMergeMember.mergeTargetDishId, "dish-target-b");
  assert.equal(
    database.read(dishProposalGroupPath(firstMergeMember.groupId)),
    null,
  );
  expectDate(
    secondMergeMember.membershipEnteredAt,
    changedMergeTargetAt,
    "merge-target change resets the boundary",
  );

  const oldSupporterPath = dishProposalSupporterPath(
    secondMergeMember.groupId,
    "supporter-1",
  );
  assert.notEqual(database.read(oldSupporterPath), null);
  database.replaceSourceData(
    proposalDocumentId,
    mergeProposal({
      mergeTargetDishId: "dish-target-b",
      userId: "supporter-2",
    }),
  );
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T05:00:00.000Z"),
  );
  const changedSupporterMember = database.read(memberPath);
  assert.equal(changedSupporterMember.groupId, secondMergeMember.groupId);
  assert.equal(changedSupporterMember.supporterUid, "supporter-2");
  expectDate(
    changedSupporterMember.membershipEnteredAt,
    new Date("2026-08-10T05:00:00.000Z"),
    "supporter correction starts a later membership boundary",
  );
  assert.equal(
    changedSupporterMember.membershipGeneration,
    secondMergeMember.membershipGeneration + 1,
  );
  assert.equal(database.read(oldSupporterPath), null);
  assert.notEqual(
    database.read(dishProposalSupporterPath(
      changedSupporterMember.groupId,
      "supporter-2",
    )),
    null,
  );
  assertBoundedPrivateQueries(database);
});

test("terminal transitions, re-entry, and delete remove or rebuild private state", async () => {
  const database = new InMemoryDishProposalDatabase();
  const proposalDocumentId = "lifecycle-proposal";
  const source = mergeProposal();
  database.createSource(
    proposalDocumentId,
    source,
    new Date("2026-08-03T00:00:00.000Z"),
  );
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T06:00:00.000Z"),
  );
  const originalMember = database.read(dishProposalMemberPath(proposalDocumentId));

  database.replaceSourceData(proposalDocumentId, {
    ...source,
    status: "approved",
  });
  const terminal = await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T07:00:00.000Z"),
  );
  assert.equal(terminal.currentGroupId, null);
  assert.equal(terminal.memberDeleted, true);
  assert.equal(database.read(dishProposalMemberPath(proposalDocumentId)), null);
  assert.equal(database.read(dishProposalGroupPath(originalMember.groupId)), null);
  assert.equal(
    database.read(dishProposalSupporterPath(
      originalMember.groupId,
      originalMember.supporterUid,
    )),
    null,
  );

  const reenteredAt = new Date("2026-08-10T08:00:00.000Z");
  database.replaceSourceData(proposalDocumentId, source);
  const reentered = await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    reenteredAt,
  );
  const reenteredMember = database.read(dishProposalMemberPath(proposalDocumentId));
  assert.equal(reentered.currentGroupId, originalMember.groupId);
  assert.equal(reentered.memberWritten, true);
  expectDate(
    reenteredMember.membershipEnteredAt,
    reenteredAt,
    "terminal-to-pending re-entry gets a new boundary",
  );

  database.deleteSource(proposalDocumentId);
  const deleted = await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T09:00:00.000Z"),
  );
  assert.equal(deleted.currentGroupId, null);
  assert.equal(deleted.memberDeleted, true);
  assert.equal(database.privateDocuments().length, 0);
  assertBoundedPrivateQueries(database);
});

test("out-of-order callbacks converge and delete/recreate resets trusted membership", async () => {
  const database = new InMemoryDishProposalDatabase();
  const proposalDocumentId = "recreated-proposal";
  const source = renameProposal({proposedName: "Mushroom Soup"});
  database.createSource(
    proposalDocumentId,
    source,
    new Date("2026-08-01T00:00:00.000Z"),
  );
  const originalEnteredAt = new Date("2026-08-10T10:00:00.000Z");
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    originalEnteredAt,
  );
  const memberPath = dishProposalMemberPath(proposalDocumentId);
  const originalMember = database.read(memberPath);

  database.replaceSourceData(proposalDocumentId, {...source, status: "rejected"});
  database.replaceSourceData(proposalDocumentId, source);
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T11:00:00.000Z"),
  );
  const afterStaleTerminalCallback = database.read(memberPath);
  expectDate(
    afterStaleTerminalCallback.membershipEnteredAt,
    originalEnteredAt,
    "stale terminal callback re-reads current pending source",
  );

  database.deleteSource(proposalDocumentId);
  const recreatedCreateTime = new Date("2026-08-10T11:30:00.000Z");
  database.createSource(proposalDocumentId, source, recreatedCreateTime);
  const recreatedEnteredAt = new Date("2026-08-10T12:00:00.000Z");
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    recreatedEnteredAt,
  );
  const recreatedMember = database.read(memberPath);
  assert.equal(recreatedMember.groupId, originalMember.groupId);
  assert.equal(
    recreatedMember.membershipGeneration,
    originalMember.membershipGeneration + 1,
  );
  expectDate(
    recreatedMember.membershipEnteredAt,
    recreatedEnteredAt,
    "same ID recreation receives a new membership boundary",
  );
  expectDate(
    recreatedMember.trustedServerCreateTime,
    recreatedCreateTime,
    "same ID recreation adopts its new Firestore createTime",
  );
  expectDate(
    database.read(dishProposalGroupPath(recreatedMember.groupId)).dueAt,
    addMilliseconds(
      recreatedCreateTime,
      dishProposalAutomaticDelayMilliseconds,
    ),
    "recreated document gets a new trusted due clock",
  );

  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T13:00:00.000Z"),
  );
  expectDate(
    database.read(memberPath).membershipEnteredAt,
    recreatedEnteredAt,
    "late duplicate callback cannot reset recreated membership",
  );

  database.deleteSource(proposalDocumentId);
  await maintainDishEditProposalPrivateState(
    database,
    proposalDocumentId,
    new Date("2026-08-10T14:00:00.000Z"),
  );
  assert.equal(database.privateDocuments().length, 0);
  assertBoundedPrivateQueries(database);
});

test("proposal document identity is exact, coexistable, and segment-safe", async () => {
  const database = new InMemoryDishProposalDatabase();
  const exactId = "x";
  const paddedId = " x ";
  assert.notEqual(
    createDishProposalMemberId(exactId),
    createDishProposalMemberId(paddedId),
  );
  assert.notEqual(
    dishProposalMemberPath(exactId),
    dishProposalMemberPath(paddedId),
  );
  assert.doesNotThrow(() => createDishProposalMemberId(" "));

  database.createSource(
    exactId,
    renameProposal({userId: "exact-supporter"}),
    new Date("2026-08-04T00:00:00.000Z"),
  );
  database.createSource(
    paddedId,
    renameProposal({userId: "padded-supporter"}),
    new Date("2026-08-04T00:00:01.000Z"),
  );
  const exact = await maintainDishEditProposalPrivateState(
    database,
    exactId,
    new Date("2026-08-10T15:00:00.000Z"),
  );
  const padded = await maintainDishEditProposalPrivateState(
    database,
    paddedId,
    new Date("2026-08-10T15:00:01.000Z"),
  );
  assert.equal(exact.proposalDocumentId, exactId);
  assert.equal(padded.proposalDocumentId, paddedId);
  assert.equal(
    database.read(dishProposalMemberPath(exactId)).proposalDocumentId,
    exactId,
  );
  assert.equal(
    database.read(dishProposalMemberPath(paddedId)).proposalDocumentId,
    paddedId,
  );
  assert.equal(
    database.documentsInCollection(dishProposalMemberCollection).length,
    2,
  );

  for (const invalidId of ["", "nested/proposal"]) {
    assert.throws(
      () => createDishProposalMemberId(invalidId),
      /must be one Firestore document-ID segment/,
    );
    await assert.rejects(
      maintainDishEditProposalPrivateState(
        database,
        invalidId,
        new Date("2026-08-10T15:00:02.000Z"),
      ),
      /must be one Firestore document-ID segment/,
    );
  }
  assertBoundedPrivateQueries(database);
});

test("strict private parsers throw for every present malformed schema", async () => {
  const database = new InMemoryDishProposalDatabase();
  database.createSource(
    "strict-rename",
    renameProposal(),
    new Date("2026-08-05T00:00:00.000Z"),
  );
  await maintainDishEditProposalPrivateState(
    database,
    "strict-rename",
    new Date("2026-08-10T16:00:00.000Z"),
  );
  database.createSource(
    "strict-merge",
    mergeProposal({userId: "supporter-2"}),
    new Date("2026-08-05T00:00:01.000Z"),
  );
  await maintainDishEditProposalPrivateState(
    database,
    "strict-merge",
    new Date("2026-08-10T16:00:01.000Z"),
  );

  const renameMemberPath = dishProposalMemberPath("strict-rename");
  const mergeMemberPath = dishProposalMemberPath("strict-merge");
  const renameMember = storedDocument(database, renameMemberPath);
  const mergeMember = storedDocument(database, mergeMemberPath);
  const renameGroupPath = dishProposalGroupPath(renameMember.data.groupId);
  const mergeGroupPath = dishProposalGroupPath(mergeMember.data.groupId);
  const renameGroup = storedDocument(database, renameGroupPath);
  const mergeGroup = storedDocument(database, mergeGroupPath);
  const supporterPath = dishProposalSupporterPath(
    renameMember.data.groupId,
    renameMember.data.supporterUid,
  );
  const supporter = storedDocument(database, supporterPath);

  assert.notEqual(parseDishProposalMemberDocument(renameMember), null);
  assert.notEqual(parseDishProposalGroupDocument(renameGroup), null);
  assert.notEqual(parseDishProposalSupporterDocument(supporter), null);
  assert.equal(parseDishProposalMemberDocument(null), null);
  assert.equal(parseDishProposalGroupDocument(null), null);

  for (const [label, document, patch] of [
    ["rename member object merge target", renameMember, {
      mergeTargetDishId: {wrong: "type"},
    }],
    ["merge member object normalized name", mergeMember, {
      normalizedProposedName: {wrong: "type"},
    }],
    ["rename member null normalized name", renameMember, {
      normalizedProposedName: null,
    }],
    ["member numeric trusted time", renameMember, {
      trustedServerCreateTime: 1_000,
    }],
    ["member numeric indexed time", renameMember, {indexedAt: 1_000}],
    ["member fractional generation", renameMember, {
      membershipGeneration: 1.5,
    }],
    ["member padded canonical source", renameMember, {
      sourceDishId: " dish-source",
    }],
    ["member slash resolution source", renameMember, {
      sourceDishId: "dish/source",
    }],
    ["member slash proposal identity", renameMember, {
      proposalDocumentId: "strict/rename",
    }],
    ["member wrong version", renameMember, {version: "member.v2"}],
  ]) {
    assertInvalidPrivateDocument(
      parseDishProposalMemberDocument,
      document,
      patch,
      label,
    );
  }

  for (const [label, document, patch] of [
    ["rename group object merge target", renameGroup, {
      mergeTargetDishId: {wrong: "type"},
    }],
    ["merge group object normalized name", mergeGroup, {
      normalizedProposedName: {wrong: "type"},
    }],
    ["group malformed active job", renameGroup, {
      activeJobId: {wrong: "type"},
    }],
    ["group incomplete active job", renameGroup, {activeJobId: "job-1"}],
    ["group malformed active resolution", renameGroup, {
      activeResolutionType: {wrong: "type"},
    }],
    ["group orphaned active resolution", renameGroup, {
      activeResolutionType: "apply",
    }],
    ["group malformed cutoff generation", renameGroup, {
      cycleCutoffGeneration: {wrong: "type"},
    }],
    ["group orphaned cutoff generation", renameGroup, {
      cycleCutoffGeneration: 0,
    }],
    ["group malformed cutoff time", renameGroup, {
      cycleCutoffAt: {wrong: "type"},
    }],
    ["group orphaned cutoff time", renameGroup, {
      cycleCutoffAt: new Date("2026-08-10T16:01:00.000Z"),
    }],
    ["group numeric cutoff time", renameGroup, {cycleCutoffAt: 1_000}],
    ["group wrong version", renameGroup, {version: "group.v2"}],
    ["group fractional membership generation", renameGroup, {
      lastMembershipGeneration: 1.5,
    }],
    ["group negative resolution sequence", renameGroup, {
      resolutionSequence: -1,
    }],
    ["group numeric due time", renameGroup, {dueAt: 1_000}],
    ["group false resolution identity marker", renameGroup, {
      resolutionIdentitiesValid: false,
    }],
    ["group slash resolution restaurant", renameGroup, {
      restaurantId: "restaurant/unsafe",
    }],
  ]) {
    assertInvalidPrivateDocument(
      parseDishProposalGroupDocument,
      document,
      patch,
      label,
    );
  }

  const missingMarker = cloneValue(renameGroup);
  delete missingMarker.data.resolutionIdentitiesValid;
  assert.throws(
    () => parseDishProposalGroupDocument(missingMarker),
    /Stored private dish-proposal group has an invalid schema\./,
  );

  for (const [label, patch] of [
    ["supporter wrong version", {version: "supporter.v2"}],
    ["supporter false presence", {present: false}],
    ["supporter numeric indexed time", {indexedAt: 1_000}],
    ["supporter padded uid", {supporterUid: " supporter-1"}],
    ["supporter extra field", {unexpected: true}],
  ]) {
    assertInvalidPrivateDocument(
      parseDishProposalSupporterDocument,
      supporter,
      patch,
      label,
    );
  }
  assertBoundedPrivateQueries(database);
});

test("queried malformed private state aborts reconciliation without repair", async () => {
  const database = new InMemoryDishProposalDatabase();
  for (const [proposalDocumentId, supporterUid, milliseconds] of [
    ["abort-a", "supporter-a", 0],
    ["abort-b", "supporter-b", 1],
  ]) {
    database.createSource(
      proposalDocumentId,
      mergeProposal({userId: supporterUid}),
      new Date(1_754_352_000_000 + milliseconds),
    );
    await maintainDishEditProposalPrivateState(
      database,
      proposalDocumentId,
      new Date(1_754_784_000_000 + milliseconds),
    );
  }
  const firstMemberPath = dishProposalMemberPath("abort-a");
  const secondMemberPath = dishProposalMemberPath("abort-b");
  const firstMember = database.read(firstMemberPath);
  const secondMember = database.read(secondMemberPath);
  const groupPath = dishProposalGroupPath(firstMember.groupId);
  const secondSupporterPath = dishProposalSupporterPath(
    secondMember.groupId,
    secondMember.supporterUid,
  );

  const scenarios = [
    {
      label: "present current member",
      path: firstMemberPath,
      patch: {mergeTargetDishId: {wrong: "type"}},
    },
    {
      label: "queried other member",
      path: secondMemberPath,
      patch: {normalizedProposedName: {wrong: "type"}},
    },
    {
      label: "queried supporter",
      path: secondSupporterPath,
      patch: {version: "supporter.v2"},
    },
    {
      label: "present group active-job gate",
      path: groupPath,
      patch: {activeJobId: {wrong: "type"}},
    },
  ];
  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    const original = database.read(scenario.path);
    database.replaceDocumentData(scenario.path, {
      ...original,
      ...scenario.patch,
    });
    const malformedSnapshot = database.privateDocuments();
    await assert.rejects(
      maintainDishEditProposalPrivateState(
        database,
        "abort-a",
        new Date(1_754_784_100_000 + index),
      ),
      /Stored private dish-proposal .* has an invalid schema\./,
      scenario.label,
    );
    assert.deepEqual(
      database.privateDocuments(),
      malformedSnapshot,
      `${scenario.label} must not be silently repaired or discarded`,
    );
    database.replaceDocumentData(scenario.path, original);
  }
  assertBoundedPrivateQueries(database);
});

test("1,000 same-user proposals deduplicate support and bounded removals update group", async () => {
  const database = new InMemoryDishProposalDatabase();
  const firstCreateTime = new Date("2026-01-01T00:00:00.000Z");
  const maintenanceBase = new Date("2026-08-01T00:00:00.000Z");
  let groupId = null;

  for (let index = 0; index < 1_000; index += 1) {
    const proposalDocumentId = `bulk-${String(index).padStart(4, "0")}`;
    database.createSource(
      proposalDocumentId,
      mergeProposal({userId: "one-supporter"}),
      addMilliseconds(firstCreateTime, index * 60_000),
    );
    await maintainDishEditProposalPrivateState(
      database,
      proposalDocumentId,
      addMilliseconds(maintenanceBase, index),
    );
    groupId = database.read(dishProposalMemberPath(proposalDocumentId)).groupId;
  }

  assert.equal(
    database.documentsInCollection(dishProposalMemberCollection).length,
    1_000,
  );
  assert.equal(
    database.documentsInCollection(dishProposalSupporterCollection).length,
    1,
  );
  assert.equal(
    database.documentsInCollection(dishProposalGroupCollection).length,
    1,
  );
  const initialGroup = database.read(dishProposalGroupPath(groupId));
  assert.equal(initialGroup.enoughSupporters, false);
  assert.equal(initialGroup.autoEligible, false);
  expectDate(
    initialGroup.dueAt,
    addMilliseconds(firstCreateTime, dishProposalAutomaticDelayMilliseconds),
    "oldest of 1,000 members controls dueAt",
  );

  const secondSupporterProposalId = "second-supporter-proposal";
  database.createSource(
    secondSupporterProposalId,
    mergeProposal({userId: "second-supporter"}),
    new Date("2026-02-01T00:00:00.000Z"),
  );
  await maintainDishEditProposalPrivateState(
    database,
    secondSupporterProposalId,
    new Date("2026-08-02T00:00:00.000Z"),
  );
  assert.equal(
    database.documentsInCollection(dishProposalSupporterCollection).length,
    2,
  );
  assert.equal(database.read(dishProposalGroupPath(groupId)).enoughSupporters, true);
  assert.equal(database.read(dishProposalGroupPath(groupId)).autoEligible, true);

  database.deleteSource(secondSupporterProposalId);
  await maintainDishEditProposalPrivateState(
    database,
    secondSupporterProposalId,
    new Date("2026-08-02T01:00:00.000Z"),
  );
  assert.equal(
    database.read(dishProposalSupporterPath(groupId, "second-supporter")),
    null,
  );
  assert.equal(
    database.documentsInCollection(dishProposalSupporterCollection).length,
    1,
  );
  assert.equal(database.read(dishProposalGroupPath(groupId)).enoughSupporters, false);

  database.deleteSource("bulk-0000");
  await maintainDishEditProposalPrivateState(
    database,
    "bulk-0000",
    new Date("2026-08-02T02:00:00.000Z"),
  );
  expectDate(
    database.read(dishProposalGroupPath(groupId)).dueAt,
    addMilliseconds(
      addMilliseconds(firstCreateTime, 60_000),
      dishProposalAutomaticDelayMilliseconds,
    ),
    "removing the oldest trusted member advances dueAt",
  );
  assert.notEqual(
    database.read(dishProposalSupporterPath(groupId, "one-supporter")),
    null,
  );

  assert.equal(database.queryLog.length, 3_009);
  assertBoundedPrivateQueries(database);
});
