import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type Query,
  type Transaction,
  type WhereFilterOp,
} from "firebase-admin/firestore";

export type DishProposalStoredDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>>;
  createTime: Date | null;
}>;

export type DishProposalPrivateQuery = Readonly<{
  collectionPath: string;
  where?: readonly Readonly<{
    field: string;
    operator: Extract<WhereFilterOp, "==" | "<=" | ">=" | "<" | ">">;
    value: unknown;
  }>[];
  orderBy?: readonly Readonly<{
    field: string;
    direction: "asc" | "desc";
  }>[];
  startAfter?: readonly unknown[] | null;
  limit: number;
}>;

export interface DishProposalPrivateTransaction {
  getDocument(path: string): Promise<DishProposalStoredDocument | null>;
  queryDocuments(
    query: DishProposalPrivateQuery,
  ): Promise<readonly DishProposalStoredDocument[]>;
  setDocument(
    path: string,
    data: Readonly<Record<string, unknown>>,
    options?: Readonly<{ merge: boolean }>,
  ): void;
  deleteDocument(path: string): void;
}

export interface DishProposalPrivateDatabase {
  runTransaction<T>(
    operation: (transaction: DishProposalPrivateTransaction) => Promise<T>,
  ): Promise<T>;
}

function snapshotDocument(
  id: string,
  data: DocumentData | undefined,
  createTime: { toDate(): Date } | undefined,
): DishProposalStoredDocument | null {
  if (data === undefined) {
    return null;
  }
  return {
    id,
    data: data as Readonly<Record<string, unknown>>,
    createTime: createTime?.toDate() ?? null,
  };
}

function firestoreTransactionBoundary(
  database: Firestore,
  transaction: Transaction,
): DishProposalPrivateTransaction {
  return {
    async getDocument(path) {
      const snapshot = await transaction.get(database.doc(path));
      if (!snapshot.exists) {
        return null;
      }
      return snapshotDocument(
        snapshot.id,
        snapshot.data(),
        snapshot.createTime,
      );
    },
    async queryDocuments(options) {
      if (!Number.isInteger(options.limit) || options.limit < 1) {
        throw new Error("Private dish-proposal query limit must be positive.");
      }
      let query: Query<DocumentData, DocumentData> = database.collection(
        options.collectionPath,
      );
      for (const condition of options.where ?? []) {
        query = query.where(
          condition.field === "__name__"
            ? FieldPath.documentId()
            : condition.field,
          condition.operator,
          condition.value,
        );
      }
      for (const order of options.orderBy ?? []) {
        query = query.orderBy(
          order.field === "__name__" ? FieldPath.documentId() : order.field,
          order.direction,
        );
      }
      if (options.startAfter !== undefined && options.startAfter !== null) {
        query = query.startAfter(...options.startAfter);
      }
      const snapshot = await transaction.get(query.limit(options.limit));
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data() as Readonly<Record<string, unknown>>,
        createTime: document.createTime.toDate(),
      }));
    },
    setDocument(path, data, options) {
      if (options === undefined) {
        transaction.set(database.doc(path), data);
      } else {
        transaction.set(database.doc(path), data, options);
      }
    },
    deleteDocument(path) {
      transaction.delete(database.doc(path));
    },
  };
}

export function createFirestoreDishProposalPrivateDatabase(
  database: Firestore,
): DishProposalPrivateDatabase {
  return {
    runTransaction(operation) {
      return database.runTransaction((transaction) =>
        operation(firestoreTransactionBoundary(database, transaction))
      );
    },
  };
}
