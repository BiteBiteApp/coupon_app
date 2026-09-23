import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { CursorSortValue } from "./opaque_cursor.js";

function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 256 && !value.includes("/") &&
    value !== "." && value !== "..";
}

// Keep timestamp components as separate safe integers in the existing signed
// scalar tuple. Milliseconds (including Timestamp.toMillis()) lose query order.
export function adminTimestampCursorValues(
  value: unknown,
  documentId: string,
): readonly [number, number, string] {
  try {
    const timestamp = value instanceof Timestamp
      ? value
      : value instanceof Date ? Timestamp.fromDate(value) : null;
    if (timestamp === null || !validDocumentId(documentId)) {
      throw new Error("Invalid timestamp boundary");
    }
    return [timestamp.seconds, timestamp.nanoseconds, documentId];
  } catch {
    throw new HttpsError("failed-precondition", "The page timestamp is invalid.");
  }
}

export function adminTimestampQueryValues(
  tuple: readonly CursorSortValue[],
): readonly [Timestamp, string] {
  try {
    const [seconds, nanoseconds, documentId, pageNumber] = tuple;
    if (
      tuple.length !== 4 ||
      typeof seconds !== "number" || !Number.isSafeInteger(seconds) ||
      typeof nanoseconds !== "number" || !Number.isSafeInteger(nanoseconds) ||
      !validDocumentId(documentId) ||
      typeof pageNumber !== "number" ||
      !Number.isSafeInteger(pageNumber) || pageNumber < 1
    ) {
      throw new Error("Invalid timestamp cursor");
    }
    // The SDK validates the full Firestore seconds/nanoseconds domain.
    return [new Timestamp(seconds, nanoseconds), documentId];
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "The page cursor is invalid or expired.",
    );
  }
}
