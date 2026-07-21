import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";

const adminInviteEmails = new Set(["schuyler.cole@gmail.com"]);

type AdminInviteContext = {
  uid: string;
  email: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireAdminInviteAccess(
  request: CallableRequest<unknown>,
): AdminInviteContext {
  const auth: unknown = request?.auth;
  const authRecord = isRecord(auth) ? auth : null;
  const uidValue = authRecord?.uid;
  const tokenValue = authRecord?.token;
  const token = isRecord(tokenValue) ? tokenValue : null;
  const emailValue = token?.email;
  const uid = typeof uidValue === "string" ? uidValue.trim() : "";
  const email =
    typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "";

  const firebaseMetadata = token?.firebase;
  let malformedProviderMetadata = false;
  let isAnonymous = false;
  if (firebaseMetadata !== undefined) {
    if (!isRecord(firebaseMetadata)) {
      malformedProviderMetadata = true;
    } else {
      const provider = firebaseMetadata.sign_in_provider;
      if (provider !== undefined) {
        if (typeof provider !== "string" || !provider.trim()) {
          malformedProviderMetadata = true;
        } else {
          isAnonymous = provider === "anonymous";
        }
      }
    }
  }

  if (
    !uid ||
    !email ||
    malformedProviderMetadata ||
    isAnonymous ||
    !adminInviteEmails.has(email)
  ) {
    throw new HttpsError(
      "permission-denied",
      "Admin access is required to create restaurant invites.",
    );
  }

  return { uid, email };
}
