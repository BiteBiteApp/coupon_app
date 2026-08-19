import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";

const adminInviteEmails = new Set(["schuyler.cole@gmail.com"]);
const maximumFirebaseUidLength = 128;
const unsupportedAdminUidCharacterPattern = /[\p{Cc}\p{Cf}]/u;

type AdminInviteContext = {
  uid: string;
  email: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readExactAdminUid(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumFirebaseUidLength ||
    value.trim() !== value ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    unsupportedAdminUidCharacterPattern.test(value)
  ) {
    return null;
  }
  return value;
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
  const uid = readExactAdminUid(uidValue);
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
    uid === null ||
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

export type RestaurantAccountActorContext = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
};

type RestaurantAccountCallableRequest = {
  auth?: unknown;
};

type ParsedRestaurantAccountActor = {
  actor: RestaurantAccountActorContext;
  token: Record<string, unknown>;
};

function restaurantAccountActorError(): never {
  throw new HttpsError(
    "unauthenticated",
    "A valid nonanonymous signed-in restaurant account is required.",
  );
}

function parseRestaurantAccountActor(
  request: RestaurantAccountCallableRequest,
): ParsedRestaurantAccountActor {
  const auth = isRecord(request?.auth) ? request.auth : null;
  const uidValue = auth?.uid;
  const tokenValue = auth?.token;
  const uid = typeof uidValue === "string" ? uidValue.trim() : "";
  const token = isRecord(tokenValue) ? tokenValue : null;
  if (!uid || token === null) {
    restaurantAccountActorError();
  }

  const emailValue = token.email;
  if (
    emailValue !== undefined &&
    emailValue !== null &&
    typeof emailValue !== "string"
  ) {
    restaurantAccountActorError();
  }
  const normalizedEmail =
    typeof emailValue === "string" ? emailValue.trim() : "";
  const email = normalizedEmail || null;

  const emailVerifiedValue = token.email_verified;
  if (
    emailVerifiedValue !== undefined &&
    typeof emailVerifiedValue !== "boolean"
  ) {
    restaurantAccountActorError();
  }

  const firebaseMetadata = token.firebase;
  if (firebaseMetadata !== undefined) {
    if (!isRecord(firebaseMetadata)) {
      restaurantAccountActorError();
    }
    const provider = firebaseMetadata.sign_in_provider;
    if (
      provider !== undefined &&
      (typeof provider !== "string" || !provider.trim())
    ) {
      restaurantAccountActorError();
    }
    if (
      typeof provider === "string" &&
      provider.trim().toLowerCase() === "anonymous"
    ) {
      restaurantAccountActorError();
    }
  }

  return {
    actor: {
      uid,
      email,
      emailVerified: emailVerifiedValue === true,
    },
    token,
  };
}

export function requireAuthenticatedRestaurantAccountActor(
  request: RestaurantAccountCallableRequest,
): RestaurantAccountActorContext {
  return parseRestaurantAccountActor(request).actor;
}

export function requireRestaurantAccountAdminAccess(
  request: RestaurantAccountCallableRequest,
): RestaurantAccountActorContext {
  const { actor, token } = parseRestaurantAccountActor(request);
  const tokenEmail = token.email;
  if (
    token.admin !== true &&
    (typeof tokenEmail !== "string" || !adminInviteEmails.has(tokenEmail))
  ) {
    throw new HttpsError(
      "permission-denied",
      "Restaurant account administrator access is required.",
    );
  }
  return actor;
}
