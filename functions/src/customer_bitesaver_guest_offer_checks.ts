import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  customerBiteSaverGuestCheckLifetimeMilliseconds,
  customerBiteSaverGuestCheckMaximumCandidateIds,
  customerBiteSaverSearchProtocolVersion,
  customerBiteSaverSearchSchemaVersion,
  CustomerBiteSaverContractError,
  requireCustomerBiteSaverCapability,
  requireCustomerBiteSaverSessionId,
} from "./customer_bitesaver_search_contract.js";
import { hasWellFormedCustomerBiteSaverUtf16 } from
  "./customer_bitesaver_search_matcher.js";

export const customerBiteSaverGuestOfferCheckTokenPrefix = "bsgc1." as const;
export const customerBiteSaverGuestOfferCheckOperationRefPrefix =
  "bsgc_" as const;
export const customerBiteSaverGuestOfferCheckTokenMaximumBytes = 32_768;

export type CustomerBiteSaverGuestOfferCheckOperationPurpose =
  | "restaurantPage"
  | "offerPage"
  | "redemptionStart";

export type CustomerBiteSaverGuestOfferCheckContinuationRequest = Readonly<{
  schemaVersion: typeof customerBiteSaverSearchSchemaVersion;
  clientRequestId: string;
  clientInstanceId: string;
  sessionId: string;
  capability: string;
  criteriaFingerprint: string;
  operationRef: string;
  checkToken: string;
  batchSequence: number;
  guestStateRevision: number;
  entireBatchEvaluated: true;
  unavailableOfferIds: readonly string[];
}>;

export type CustomerBiteSaverGuestOfferCheckOperationIdentity = Readonly<{
  operationPurpose: CustomerBiteSaverGuestOfferCheckOperationPurpose;
  sessionId: string;
  attemptGeneration: number;
  criteriaFingerprint: string;
  queryFingerprint: string;
  callerCapabilityBinding: string;
  operationFingerprint: string;
  restaurantPublicId: string | null;
}>;

export type CustomerBiteSaverGuestOfferCheckTokenPayload = Readonly<{
  protocolVersion: typeof customerBiteSaverSearchProtocolVersion;
  purpose: "guestOfferCheck";
  operationPurpose: CustomerBiteSaverGuestOfferCheckOperationPurpose;
  operationRef: string;
  sessionId: string;
  attemptGeneration: number;
  criteriaFingerprint: string;
  queryFingerprint: string;
  callerCapabilityBinding: string;
  operationFingerprint: string;
  restaurantPublicId: string | null;
  consumedBoundaryFingerprint: string;
  batchSequence: number;
  candidateOfferIds: readonly string[];
  candidateDigest: string;
  availabilityGeneration: string;
  timeZone: string;
  utcOffsetMinutes: number;
  guestStateRevision: number;
  evaluationAtMillis: number;
  issuedAtMillis: number;
  expiresAtMillis: number;
}>;

export type CustomerBiteSaverGuestOfferCheckTokenInput = Omit<
  CustomerBiteSaverGuestOfferCheckTokenPayload,
  "protocolVersion" | "purpose" | "candidateDigest" | "issuedAtMillis"
>;

/**
 * Every semantic token value is repeated here intentionally. `open` is for
 * authenticated preflight; `decode` additionally corroborates the token with
 * values independently loaded from the authorized session/check record.
 */
export type CustomerBiteSaverGuestOfferCheckTokenBinding = Omit<
  CustomerBiteSaverGuestOfferCheckTokenPayload,
  "protocolVersion" | "purpose"
>;

export type CustomerBiteSaverGuestOfferCheckCodecOptions = Readonly<{
  key: Uint8Array;
  now?: () => number;
  nonceSource?: (size: number) => Uint8Array;
}>;

export type CustomerBiteSaverGuestOfferCheckTokenOpenOptions = Readonly<{
  allowExpired?: boolean;
}>;

export type CustomerBiteSaverGuestOfferCheckContinuationPreflightBinding =
  Readonly<{
    callerCapabilityBinding: string;
  }>;

const continuationRequestKeys = Object.freeze([
  "schemaVersion",
  "clientRequestId",
  "clientInstanceId",
  "sessionId",
  "capability",
  "criteriaFingerprint",
  "operationRef",
  "checkToken",
  "batchSequence",
  "guestStateRevision",
  "entireBatchEvaluated",
  "unavailableOfferIds",
]);

const tokenPayloadKeys = Object.freeze([
  "protocolVersion",
  "purpose",
  "operationPurpose",
  "operationRef",
  "sessionId",
  "attemptGeneration",
  "criteriaFingerprint",
  "queryFingerprint",
  "callerCapabilityBinding",
  "operationFingerprint",
  "restaurantPublicId",
  "consumedBoundaryFingerprint",
  "batchSequence",
  "candidateOfferIds",
  "candidateDigest",
  "availabilityGeneration",
  "timeZone",
  "utcOffsetMinutes",
  "guestStateRevision",
  "evaluationAtMillis",
  "issuedAtMillis",
  "expiresAtMillis",
]);

const guestOfferIdPattern = /^bso_[A-Za-z0-9_-]{43}$/u;
const guestRestaurantIdPattern = /^bsr_[A-Za-z0-9_-]{43}$/u;
const guestOperationRefPattern = /^bsgc_[A-Za-z0-9_-]{43}$/u;
const fingerprintPattern = /^[0-9a-f]{64}$/u;
const opaqueRequestIdPattern = /^[A-Za-z0-9_-]{16,128}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const guestOfferCheckAad = Buffer.from(
  `${customerBiteSaverSearchProtocolVersion}\0guestOfferCheckToken\0` +
    customerBiteSaverGuestOfferCheckTokenPrefix,
  "utf8",
);

function invalidGuestOfferCheckRequest(): never {
  throw new CustomerBiteSaverContractError(
    "invalid-argument",
    "The BiteSaver guest offer check request is invalid.",
  );
}

function invalidGuestOfferCheckToken(): never {
  throw new CustomerBiteSaverContractError(
    "invalid-argument",
    "The BiteSaver guest offer check token is invalid or expired.",
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function safeInteger(
  value: unknown,
  minimum: number,
  invalid: () => never,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid();
  }
  return value;
}

function timeZone(value: unknown, invalid: () => never): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 100 ||
    !hasWellFormedCustomerBiteSaverUtf16(value)
  ) {
    return invalid();
  }
  return value;
}

function fingerprint(value: unknown, invalid: () => never): string {
  if (typeof value !== "string" || !fingerprintPattern.test(value)) {
    return invalid();
  }
  return value;
}

function operationPurpose(
  value: unknown,
  invalid: () => never,
): CustomerBiteSaverGuestOfferCheckOperationPurpose {
  if (
    value !== "restaurantPage" &&
    value !== "offerPage" &&
    value !== "redemptionStart"
  ) {
    return invalid();
  }
  return value;
}

function operationRef(value: unknown, invalid: () => never): string {
  if (typeof value !== "string" || !guestOperationRefPattern.test(value)) {
    return invalid();
  }
  return value;
}

function publicRestaurantId(
  value: unknown,
  invalid: () => never,
): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !guestRestaurantIdPattern.test(value)) {
    return invalid();
  }
  return value;
}

function parseOfferIds(
  value: unknown,
  minimumLength: number,
  invalid: () => never,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < minimumLength ||
    value.length > customerBiteSaverGuestCheckMaximumCandidateIds
  ) {
    return invalid();
  }
  const result = value.map((entry) => {
    if (typeof entry !== "string" || !guestOfferIdPattern.test(entry)) {
      return invalid();
    }
    return entry;
  });
  if (new Set(result).size !== result.length) {
    return invalid();
  }
  return Object.freeze(result);
}

function requireGuestOfferCheckKey(key: Uint8Array): Buffer {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "BiteSaver discovery is not configured.",
    );
  }
  return Buffer.from(key);
}

function guestOfferCheckHmac(
  key: Uint8Array,
  domain: string,
  values: readonly string[],
): Buffer {
  const hmac = createHmac("sha256", key);
  hmac.update(customerBiteSaverSearchProtocolVersion, "utf8");
  hmac.update("\0guestOfferCheck\0", "utf8");
  hmac.update(domain, "utf8");
  for (const value of values) {
    hmac.update("\0", "utf8");
    hmac.update(String(value.length), "ascii");
    hmac.update(":", "ascii");
    hmac.update(value, "utf16le");
  }
  return hmac.digest();
}

export function parseCustomerBiteSaverGuestOfferCheckContinuationRequest(
  value: unknown,
): CustomerBiteSaverGuestOfferCheckContinuationRequest {
  if (!isPlainRecord(value) || !hasExactKeys(value, continuationRequestKeys)) {
    return invalidGuestOfferCheckRequest();
  }
  if (
    value.schemaVersion !== customerBiteSaverSearchSchemaVersion ||
    typeof value.clientRequestId !== "string" ||
    !opaqueRequestIdPattern.test(value.clientRequestId) ||
    typeof value.clientInstanceId !== "string" ||
    !opaqueRequestIdPattern.test(value.clientInstanceId) ||
    value.entireBatchEvaluated !== true ||
    typeof value.checkToken !== "string" ||
    Buffer.byteLength(value.checkToken, "utf8") >
      customerBiteSaverGuestOfferCheckTokenMaximumBytes ||
    !value.checkToken.startsWith(customerBiteSaverGuestOfferCheckTokenPrefix) ||
    !base64UrlPattern.test(
      value.checkToken.slice(customerBiteSaverGuestOfferCheckTokenPrefix.length),
    )
  ) {
    return invalidGuestOfferCheckRequest();
  }
  return Object.freeze({
    schemaVersion: customerBiteSaverSearchSchemaVersion,
    clientRequestId: value.clientRequestId,
    clientInstanceId: value.clientInstanceId,
    sessionId: requireCustomerBiteSaverSessionId(value.sessionId),
    capability: requireCustomerBiteSaverCapability(value.capability),
    criteriaFingerprint: fingerprint(
      value.criteriaFingerprint,
      invalidGuestOfferCheckRequest,
    ),
    operationRef: operationRef(
      value.operationRef,
      invalidGuestOfferCheckRequest,
    ),
    checkToken: value.checkToken,
    batchSequence: safeInteger(
      value.batchSequence,
      0,
      invalidGuestOfferCheckRequest,
    ),
    guestStateRevision: safeInteger(
      value.guestStateRevision,
      0,
      invalidGuestOfferCheckRequest,
    ),
    entireBatchEvaluated: true,
    unavailableOfferIds: parseOfferIds(
      value.unavailableOfferIds,
      0,
      invalidGuestOfferCheckRequest,
    ),
  });
}

/**
 * The public operation reference is also the deterministic Firestore document
 * ID in `private_bitesaver_guest_offer_checks`.
 */
export function createCustomerBiteSaverGuestOfferCheckOperationRef(
  key: Uint8Array,
  identity: CustomerBiteSaverGuestOfferCheckOperationIdentity,
): string {
  const rootKey = requireGuestOfferCheckKey(key);
  const purpose = operationPurpose(
    identity.operationPurpose,
    invalidGuestOfferCheckRequest,
  );
  const sessionId = (() => {
    try {
      return requireCustomerBiteSaverSessionId(identity.sessionId);
    } catch {
      return invalidGuestOfferCheckRequest();
    }
  })();
  const restaurantId = publicRestaurantId(
    identity.restaurantPublicId,
    invalidGuestOfferCheckRequest,
  );
  if (
    (purpose === "restaurantPage" && restaurantId !== null) ||
    (purpose !== "restaurantPage" && restaurantId === null)
  ) {
    return invalidGuestOfferCheckRequest();
  }
  const values = [
    purpose,
    sessionId,
    String(safeInteger(
      identity.attemptGeneration,
      0,
      invalidGuestOfferCheckRequest,
    )),
    fingerprint(identity.criteriaFingerprint, invalidGuestOfferCheckRequest),
    fingerprint(identity.queryFingerprint, invalidGuestOfferCheckRequest),
    fingerprint(
      identity.callerCapabilityBinding,
      invalidGuestOfferCheckRequest,
    ),
    fingerprint(identity.operationFingerprint, invalidGuestOfferCheckRequest),
    restaurantId ?? "",
  ];
  return customerBiteSaverGuestOfferCheckOperationRefPrefix +
    guestOfferCheckHmac(rootKey, "operationRef", values).toString("base64url");
}

export function customerBiteSaverGuestOfferCheckDocumentId(
  value: unknown,
): string {
  return operationRef(value, invalidGuestOfferCheckRequest);
}

export function createCustomerBiteSaverGuestOfferCheckCandidateDigest(
  candidateOfferIds: unknown,
): string {
  const candidates = parseOfferIds(
    candidateOfferIds,
    1,
    invalidGuestOfferCheckRequest,
  );
  const hash = createHash("sha256");
  hash.update(customerBiteSaverSearchProtocolVersion, "utf8");
  hash.update("\0guestOfferCheckOrderedCandidateDigest", "utf8");
  for (const candidate of candidates) {
    hash.update("\0", "utf8");
    hash.update(String(candidate.length), "ascii");
    hash.update(":", "ascii");
    hash.update(candidate, "ascii");
  }
  return hash.digest("hex");
}

function parseTokenPayload(
  value: unknown,
): CustomerBiteSaverGuestOfferCheckTokenPayload {
  if (!isPlainRecord(value) || !hasExactKeys(value, tokenPayloadKeys)) {
    return invalidGuestOfferCheckToken();
  }
  if (
    value.protocolVersion !== customerBiteSaverSearchProtocolVersion ||
    value.purpose !== "guestOfferCheck"
  ) {
    return invalidGuestOfferCheckToken();
  }
  const candidateOfferIds = parseOfferIds(
    value.candidateOfferIds,
    1,
    invalidGuestOfferCheckToken,
  );
  const candidateDigest = fingerprint(
    value.candidateDigest,
    invalidGuestOfferCheckToken,
  );
  let calculatedDigest: string;
  try {
    calculatedDigest = createCustomerBiteSaverGuestOfferCheckCandidateDigest(
      candidateOfferIds,
    );
  } catch {
    return invalidGuestOfferCheckToken();
  }
  if (!timingSafeEqual(
    Buffer.from(candidateDigest, "hex"),
    Buffer.from(calculatedDigest, "hex"),
  )) {
    return invalidGuestOfferCheckToken();
  }
  const evaluationAtMillis = safeInteger(
    value.evaluationAtMillis,
    0,
    invalidGuestOfferCheckToken,
  );
  const issuedAtMillis = safeInteger(
    value.issuedAtMillis,
    0,
    invalidGuestOfferCheckToken,
  );
  const expiresAtMillis = safeInteger(
    value.expiresAtMillis,
    0,
    invalidGuestOfferCheckToken,
  );
  if (
    evaluationAtMillis > issuedAtMillis ||
    expiresAtMillis <= issuedAtMillis ||
    expiresAtMillis - issuedAtMillis >
      customerBiteSaverGuestCheckLifetimeMilliseconds
  ) {
    return invalidGuestOfferCheckToken();
  }
  const parsedOperationPurpose = operationPurpose(
    value.operationPurpose,
    invalidGuestOfferCheckToken,
  );
  const parsedRestaurantPublicId = publicRestaurantId(
    value.restaurantPublicId,
    invalidGuestOfferCheckToken,
  );
  if (
    (parsedOperationPurpose === "restaurantPage" &&
      parsedRestaurantPublicId !== null) ||
    (parsedOperationPurpose !== "restaurantPage" &&
      parsedRestaurantPublicId === null)
  ) {
    return invalidGuestOfferCheckToken();
  }
  return Object.freeze({
    protocolVersion: customerBiteSaverSearchProtocolVersion,
    purpose: "guestOfferCheck",
    operationPurpose: parsedOperationPurpose,
    operationRef: operationRef(value.operationRef, invalidGuestOfferCheckToken),
    sessionId: (() => {
      if (
        typeof value.sessionId !== "string" ||
        !/^bss_[A-Za-z0-9_-]{43}$/u.test(value.sessionId)
      ) {
        return invalidGuestOfferCheckToken();
      }
      return value.sessionId;
    })(),
    attemptGeneration: safeInteger(
      value.attemptGeneration,
      0,
      invalidGuestOfferCheckToken,
    ),
    criteriaFingerprint: fingerprint(
      value.criteriaFingerprint,
      invalidGuestOfferCheckToken,
    ),
    queryFingerprint: fingerprint(
      value.queryFingerprint,
      invalidGuestOfferCheckToken,
    ),
    callerCapabilityBinding: fingerprint(
      value.callerCapabilityBinding,
      invalidGuestOfferCheckToken,
    ),
    operationFingerprint: fingerprint(
      value.operationFingerprint,
      invalidGuestOfferCheckToken,
    ),
    restaurantPublicId: parsedRestaurantPublicId,
    consumedBoundaryFingerprint: fingerprint(
      value.consumedBoundaryFingerprint,
      invalidGuestOfferCheckToken,
    ),
    batchSequence: safeInteger(
      value.batchSequence,
      0,
      invalidGuestOfferCheckToken,
    ),
    candidateOfferIds,
    candidateDigest,
    availabilityGeneration: fingerprint(
      value.availabilityGeneration,
      invalidGuestOfferCheckToken,
    ),
    timeZone: timeZone(value.timeZone, invalidGuestOfferCheckToken),
    utcOffsetMinutes: safeInteger(
      value.utcOffsetMinutes,
      -840,
      invalidGuestOfferCheckToken,
      840,
    ),
    guestStateRevision: safeInteger(
      value.guestStateRevision,
      0,
      invalidGuestOfferCheckToken,
    ),
    evaluationAtMillis,
    issuedAtMillis,
    expiresAtMillis,
  });
}

function tokenPayloadMatchesBinding(
  payload: CustomerBiteSaverGuestOfferCheckTokenPayload,
  binding: CustomerBiteSaverGuestOfferCheckTokenBinding,
): boolean {
  return payload.operationPurpose === binding.operationPurpose &&
    payload.operationRef === binding.operationRef &&
    payload.sessionId === binding.sessionId &&
    payload.attemptGeneration === binding.attemptGeneration &&
    payload.criteriaFingerprint === binding.criteriaFingerprint &&
    payload.queryFingerprint === binding.queryFingerprint &&
    payload.callerCapabilityBinding === binding.callerCapabilityBinding &&
    payload.operationFingerprint === binding.operationFingerprint &&
    payload.restaurantPublicId === binding.restaurantPublicId &&
    payload.consumedBoundaryFingerprint ===
      binding.consumedBoundaryFingerprint &&
    payload.batchSequence === binding.batchSequence &&
    payload.candidateDigest === binding.candidateDigest &&
    payload.availabilityGeneration === binding.availabilityGeneration &&
    payload.timeZone === binding.timeZone &&
    payload.utcOffsetMinutes === binding.utcOffsetMinutes &&
    payload.guestStateRevision === binding.guestStateRevision &&
    payload.evaluationAtMillis === binding.evaluationAtMillis &&
    payload.issuedAtMillis === binding.issuedAtMillis &&
    payload.expiresAtMillis === binding.expiresAtMillis &&
    payload.candidateOfferIds.length === binding.candidateOfferIds.length &&
    payload.candidateOfferIds.every(
      (candidate, index) => candidate === binding.candidateOfferIds[index],
    );
}

/**
 * Checks all request-visible token bindings and answer membership. Call this
 * immediately after `open`, before reading Firestore.
 */
export function assertCustomerBiteSaverGuestOfferCheckContinuationMatchesToken(
  request: CustomerBiteSaverGuestOfferCheckContinuationRequest,
  payload: CustomerBiteSaverGuestOfferCheckTokenPayload,
  binding: CustomerBiteSaverGuestOfferCheckContinuationPreflightBinding,
): void {
  if (!isPlainRecord(binding) || !hasExactKeys(binding, [
    "callerCapabilityBinding",
  ])) {
    return invalidGuestOfferCheckRequest();
  }
  const expectedCallerCapabilityBinding = fingerprint(
    binding.callerCapabilityBinding,
    invalidGuestOfferCheckRequest,
  );
  if (
    request.operationRef !== payload.operationRef ||
    request.sessionId !== payload.sessionId ||
    request.criteriaFingerprint !== payload.criteriaFingerprint ||
    request.batchSequence !== payload.batchSequence ||
    request.guestStateRevision !== payload.guestStateRevision ||
    !timingSafeEqual(
      Buffer.from(payload.callerCapabilityBinding, "hex"),
      Buffer.from(expectedCallerCapabilityBinding, "hex"),
    )
  ) {
    return invalidGuestOfferCheckRequest();
  }
  const candidates = new Set(payload.candidateOfferIds);
  if (request.unavailableOfferIds.some((candidate) => !candidates.has(candidate))) {
    return invalidGuestOfferCheckRequest();
  }
}

export class CustomerBiteSaverGuestOfferCheckCodec {
  readonly #encryptionKey: Buffer;
  readonly #now: () => number;
  readonly #nonceSource: (size: number) => Uint8Array;

  constructor(options: CustomerBiteSaverGuestOfferCheckCodecOptions) {
    const rootKey = requireGuestOfferCheckKey(options.key);
    this.#encryptionKey = guestOfferCheckHmac(
      rootKey,
      "tokenEncryptionKey",
      [],
    );
    this.#now = options.now ?? Date.now;
    this.#nonceSource = options.nonceSource ?? randomBytes;
  }

  encode(input: CustomerBiteSaverGuestOfferCheckTokenInput): string {
    try {
      const candidateOfferIds = parseOfferIds(
        input.candidateOfferIds,
        1,
        invalidGuestOfferCheckToken,
      );
      const payload = parseTokenPayload({
        protocolVersion: customerBiteSaverSearchProtocolVersion,
        purpose: "guestOfferCheck",
        ...input,
        candidateOfferIds,
        candidateDigest:
          createCustomerBiteSaverGuestOfferCheckCandidateDigest(
            candidateOfferIds,
          ),
        issuedAtMillis: safeInteger(
          this.#now(),
          0,
          invalidGuestOfferCheckToken,
        ),
      });
      const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
      const nonceBytes = this.#nonceSource(12);
      if (!(nonceBytes instanceof Uint8Array) || nonceBytes.length !== 12) {
        return invalidGuestOfferCheckToken();
      }
      const nonce = Buffer.from(nonceBytes);
      const cipher = createCipheriv(
        "aes-256-gcm",
        this.#encryptionKey,
        nonce,
      );
      cipher.setAAD(guestOfferCheckAad);
      const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const token = customerBiteSaverGuestOfferCheckTokenPrefix + Buffer.concat([
        nonce,
        cipher.getAuthTag(),
        encrypted,
      ]).toString("base64url");
      if (
        Buffer.byteLength(token, "utf8") >
          customerBiteSaverGuestOfferCheckTokenMaximumBytes
      ) {
        return invalidGuestOfferCheckToken();
      }
      return token;
    } catch (error) {
      if (error instanceof CustomerBiteSaverContractError) {
        throw error;
      }
      return invalidGuestOfferCheckToken();
    }
  }

  open(
    token: unknown,
    options: CustomerBiteSaverGuestOfferCheckTokenOpenOptions = {},
  ): CustomerBiteSaverGuestOfferCheckTokenPayload {
    try {
      if (
        typeof token !== "string" ||
        Buffer.byteLength(token, "utf8") >
          customerBiteSaverGuestOfferCheckTokenMaximumBytes ||
        !token.startsWith(customerBiteSaverGuestOfferCheckTokenPrefix)
      ) {
        return invalidGuestOfferCheckToken();
      }
      const encoded = token.slice(
        customerBiteSaverGuestOfferCheckTokenPrefix.length,
      );
      if (encoded.length === 0 || !base64UrlPattern.test(encoded)) {
        return invalidGuestOfferCheckToken();
      }
      const packed = Buffer.from(encoded, "base64url");
      if (packed.toString("base64url") !== encoded || packed.length <= 28) {
        return invalidGuestOfferCheckToken();
      }
      const nonce = packed.subarray(0, 12);
      const authenticationTag = packed.subarray(12, 28);
      const encrypted = packed.subarray(28);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#encryptionKey,
        nonce,
      );
      decipher.setAAD(guestOfferCheckAad);
      decipher.setAuthTag(authenticationTag);
      const plaintext = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      const payload = parseTokenPayload(
        JSON.parse(plaintext.toString("utf8")) as unknown,
      );
      if (
        options.allowExpired !== true &&
        safeInteger(this.#now(), 0, invalidGuestOfferCheckToken) >=
          payload.expiresAtMillis
      ) {
        return invalidGuestOfferCheckToken();
      }
      return payload;
    } catch (error) {
      if (error instanceof CustomerBiteSaverContractError) {
        throw error;
      }
      return invalidGuestOfferCheckToken();
    }
  }

  decode(
    token: unknown,
    binding: CustomerBiteSaverGuestOfferCheckTokenBinding,
  ): CustomerBiteSaverGuestOfferCheckTokenPayload {
    try {
      const payload = this.open(token);
      const expected = parseTokenPayload({
        protocolVersion: customerBiteSaverSearchProtocolVersion,
        purpose: "guestOfferCheck",
        ...binding,
      });
      if (!tokenPayloadMatchesBinding(payload, expected)) {
        return invalidGuestOfferCheckToken();
      }
      return payload;
    } catch (error) {
      if (error instanceof CustomerBiteSaverContractError) {
        throw error;
      }
      return invalidGuestOfferCheckToken();
    }
  }
}
