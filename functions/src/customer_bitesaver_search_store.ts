import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type Query,
  type Transaction,
} from "firebase-admin/firestore";
import {
  customerBiteSaverMaximumWritesPerCommit,
  CustomerBiteSaverContractError,
} from "./customer_bitesaver_search_contract.js";

export type CustomerBiteSaverStoredDocument = Readonly<{
  id: string;
  path: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type CustomerBiteSaverQueryFilter = Readonly<{
  field: string;
  operation: "==" | ">=" | "<=" | ">" | "<";
  value: unknown;
}>;

export type CustomerBiteSaverQueryOrder = Readonly<{
  field: string;
  direction: "asc" | "desc";
}>;

export type CustomerBiteSaverQuery = Readonly<{
  collectionPath: string;
  filters: readonly CustomerBiteSaverQueryFilter[];
  orders: readonly CustomerBiteSaverQueryOrder[];
  startAfter?: readonly unknown[];
  limit: number;
}>;

export type CustomerBiteSaverWrite =
  | Readonly<{
      type: "create" | "set";
      path: string;
      data: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{
      type: "delete";
      path: string;
    }>;

export interface CustomerBiteSaverTransaction {
  getDocument(path: string): Promise<CustomerBiteSaverStoredDocument | null>;
  getDocuments(
    paths: readonly string[],
  ): Promise<readonly (CustomerBiteSaverStoredDocument | null)[]>;
  createDocument(path: string, data: Readonly<Record<string, unknown>>): void;
  setDocument(path: string, data: Readonly<Record<string, unknown>>): void;
  deleteDocument(path: string): void;
}

export interface CustomerBiteSaverSearchDatabase {
  getDocument(path: string): Promise<CustomerBiteSaverStoredDocument | null>;
  getDocuments(
    paths: readonly string[],
  ): Promise<readonly (CustomerBiteSaverStoredDocument | null)[]>;
  queryDocuments(
    query: CustomerBiteSaverQuery,
  ): Promise<readonly CustomerBiteSaverStoredDocument[]>;
  runTransaction<T>(
    operation: (transaction: CustomerBiteSaverTransaction) => Promise<T>,
  ): Promise<T>;
  commitWrites(writes: readonly CustomerBiteSaverWrite[]): Promise<void>;
}

function documentFromSnapshot(
  snapshot: {
    exists: boolean;
    id: string;
    ref: {path: string};
    data(): DocumentData | undefined;
  },
): CustomerBiteSaverStoredDocument | null {
  const data = snapshot.data();
  return !snapshot.exists || data === undefined
    ? null
    : Object.freeze({
        id: snapshot.id,
        path: snapshot.ref.path,
        data: data as Readonly<Record<string, unknown>>,
      });
}

function queryField(field: string): string | FieldPath {
  return field === "__name__" ? FieldPath.documentId() : field;
}

function buildQuery(
  database: Firestore,
  options: CustomerBiteSaverQuery,
): Query<DocumentData, DocumentData> {
  if (
    !Number.isInteger(options.limit) ||
    options.limit <= 0 ||
    options.limit > 101
  ) {
    throw new CustomerBiteSaverContractError("failed-precondition");
  }
  let query: Query<DocumentData, DocumentData> = database.collection(
    options.collectionPath,
  );
  for (const filter of options.filters) {
    query = query.where(
      queryField(filter.field),
      filter.operation,
      filter.value,
    );
  }
  for (const order of options.orders) {
    query = query.orderBy(queryField(order.field), order.direction);
  }
  if (options.startAfter !== undefined) {
    query = query.startAfter(...options.startAfter);
  }
  return query.limit(options.limit);
}

function transactionFacade(
  database: Firestore,
  transaction: Transaction,
): CustomerBiteSaverTransaction {
  return {
    async getDocument(path) {
      const snapshot = await transaction.get(database.doc(path));
      return documentFromSnapshot(snapshot);
    },
    async getDocuments(paths) {
      if (paths.length === 0) {
        return [];
      }
      if (paths.length > 100) {
        throw new CustomerBiteSaverContractError("failed-precondition");
      }
      const snapshots = await transaction.getAll(
        ...paths.map((path) => database.doc(path)),
      );
      return snapshots.map(documentFromSnapshot);
    },
    createDocument(path, data) {
      transaction.create(database.doc(path), data);
    },
    setDocument(path, data) {
      transaction.set(database.doc(path), data);
    },
    deleteDocument(path) {
      transaction.delete(database.doc(path));
    },
  };
}

export function createFirestoreCustomerBiteSaverSearchDatabase(
  database: Firestore,
): CustomerBiteSaverSearchDatabase {
  return {
    async getDocument(path) {
      const snapshot = await database.doc(path).get();
      return documentFromSnapshot(snapshot);
    },
    async getDocuments(paths) {
      if (paths.length === 0) {
        return [];
      }
      if (paths.length > 100) {
        throw new CustomerBiteSaverContractError("failed-precondition");
      }
      const snapshots = await database.getAll(
        ...paths.map((path) => database.doc(path)),
      );
      return snapshots.map(documentFromSnapshot);
    },
    async queryDocuments(options) {
      const snapshot = await buildQuery(database, options).get();
      return snapshot.docs.map((document) =>
        documentFromSnapshot(document) as CustomerBiteSaverStoredDocument);
    },
    async runTransaction(operation) {
      return database.runTransaction((transaction) =>
        operation(transactionFacade(database, transaction)));
    },
    async commitWrites(writes) {
      if (writes.length === 0) {
        return;
      }
      if (writes.length > customerBiteSaverMaximumWritesPerCommit) {
        throw new CustomerBiteSaverContractError("failed-precondition");
      }
      const batch = database.batch();
      for (const write of writes) {
        const reference = database.doc(write.path);
        if (write.type === "create") {
          batch.create(reference, write.data);
        } else if (write.type === "set") {
          batch.set(reference, write.data);
        } else {
          batch.delete(reference);
        }
      }
      await batch.commit();
    },
  };
}
