import {type Firestore, type Transaction} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

/** A minimal, trusted fence survives profile/Auth removal and delayed events. */
export const accountDeletionCollection = "private_account_deletions";

export function accountDeletionPath(uid: string): string {
  if (typeof uid !== "string" || uid.length < 1 || uid.length > 128 ||
      uid === "." || uid === ".." || /[\/\u0000-\u001f\u007f]/u.test(uid)) {
    throw new HttpsError("invalid-argument", "Invalid account identity.");
  }
  return `${accountDeletionCollection}/${uid}`;
}

export async function accountDeletionRequested(
  db: Firestore, transaction: Transaction, uid: string,
): Promise<boolean> {
  // Existence is deliberately fail-closed, including malformed/recovery state.
  return (await transaction.get(db.doc(accountDeletionPath(uid)))).exists;
}

export async function requireAccountWritable(
  db: Firestore, transaction: Transaction, uid: string,
): Promise<void> {
  if (await accountDeletionRequested(db, transaction, uid)) {
    throw new HttpsError("failed-precondition", "Account deletion is in progress.");
  }
}

/** Same fence for the existing testable transaction adapters. */
export async function requireAccountWritableInStore(
  transaction: {getDocument(path: string): Promise<unknown>}, uid: string,
): Promise<void> {
  if (await transaction.getDocument(accountDeletionPath(uid))) {
    throw new HttpsError("failed-precondition", "Account deletion is in progress.");
  }
}
