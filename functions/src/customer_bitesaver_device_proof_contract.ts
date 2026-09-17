import { createHash, timingSafeEqual } from "node:crypto";
import {
  customerBiteSaverCombinedUseRequestFingerprint,
  customerBiteSaverDeviceUsePurpose,
  type CustomerBiteSaverCombinedUseRequest,
  type CustomerBiteSaverDeviceUseOrigin,
} from "./customer_bitesaver_device_usage_core.js";
import {
  CustomerBiteSaverContractError,
} from "./customer_bitesaver_search_contract.js";

export const customerBiteSaverDeviceProofSchemaVersion = 1 as const;
export const customerBiteSaverDeviceProofProtocolVersion =
  "bitestar.bitesaver-device-proof.v1" as const;
export const customerBiteSaverDeviceChallengeLifetimeMilliseconds =
  120_000 as const;
export const customerBiteSaverDeviceChallengeCleanupDelayMilliseconds =
  24 * 60 * 60_000;
export const customerBiteSaverDeviceTranscriptDomain =
  "BiteStar/BiteSaver/DeviceProofTranscript/v1\0" as const;
export const customerBiteSaverDeviceAssertionDomain =
  "BiteStar/BiteSaver/DeviceProofAssertion/v1\0" as const;
export const customerBiteSaverCredentialIdDomain =
  "BiteStar/BiteSaver/CredentialId/v1\0" as const;

export type CustomerBiteSaverDevicePlatform = "android" | "ios";
export type CustomerBiteSaverDeviceProofKind =
  | "androidEnrollment"
  | "androidUse"
  | "iosEnrollment"
  | "iosUse";

export type CustomerBiteSaverDeviceUseChallenge = Readonly<{
  schemaVersion: typeof customerBiteSaverDeviceProofSchemaVersion;
  protocolVersion: typeof customerBiteSaverDeviceProofProtocolVersion;
  challengeId: string;
  platform: CustomerBiteSaverDevicePlatform;
  purpose: typeof customerBiteSaverDeviceUsePurpose;
  requestFingerprint: string;
  authenticatedUserId: string | null;
  origin: CustomerBiteSaverDeviceUseOrigin;
  logicalRequestId: string;
  issuedAtMillis: number;
  validFromMillis: number;
  expiresAtMillis: number;
  challengeBytes: string;
}>;

export type CustomerBiteSaverAndroidEnrollmentProof = Readonly<{
  schemaVersion: typeof customerBiteSaverDeviceProofSchemaVersion;
  kind: "androidEnrollment";
  credentialId: string;
  installationPublicKeySpki: string;
  androidSsaid: string;
  possessionSignature: string;
  integrityToken: string;
}>;

export type CustomerBiteSaverAndroidUseProof = Readonly<{
  schemaVersion: typeof customerBiteSaverDeviceProofSchemaVersion;
  kind: "androidUse";
  credentialId: string;
  possessionSignature: string;
}>;

export type CustomerBiteSaverIosEnrollmentProof = Readonly<{
  schemaVersion: typeof customerBiteSaverDeviceProofSchemaVersion;
  kind: "iosEnrollment";
  credentialId: string;
  recoveryPublicKeyX963: string;
  appAttestKeyId: string;
  possessionSignature: string;
  attestationObject: string;
}>;

export type CustomerBiteSaverIosUseProof = Readonly<{
  schemaVersion: typeof customerBiteSaverDeviceProofSchemaVersion;
  kind: "iosUse";
  credentialId: string;
  appAttestKeyId: string;
  possessionSignature: string;
  assertionObject: string;
}>;

export type CustomerBiteSaverDeviceProof =
  | CustomerBiteSaverAndroidEnrollmentProof
  | CustomerBiteSaverAndroidUseProof
  | CustomerBiteSaverIosEnrollmentProof
  | CustomerBiteSaverIosUseProof;

export type CustomerBiteSaverIssueDeviceChallengeRequest = Readonly<{
  schemaVersion: typeof customerBiteSaverDeviceProofSchemaVersion;
  platform: CustomerBiteSaverDevicePlatform;
  request: CustomerBiteSaverCombinedUseRequest;
}>;

export type CustomerBiteSaverUseCouponWithDeviceProofRequest = Readonly<{
  schemaVersion: typeof customerBiteSaverDeviceProofSchemaVersion;
  challengeId: string;
  request: CustomerBiteSaverCombinedUseRequest;
  proof: CustomerBiteSaverDeviceProof;
}>;

export type CustomerBiteSaverDeviceProofTranscript = Readonly<{
  schemaVersion: typeof customerBiteSaverDeviceProofSchemaVersion;
  protocolVersion: typeof customerBiteSaverDeviceProofProtocolVersion;
  proofKind: CustomerBiteSaverDeviceProofKind;
  platform: CustomerBiteSaverDevicePlatform;
  purpose: typeof customerBiteSaverDeviceUsePurpose;
  challengeId: string;
  challengeBytes: Uint8Array;
  requestFingerprint: Uint8Array;
  authenticatedUserId: string | null;
  origin: CustomerBiteSaverDeviceUseOrigin;
  logicalRequestId: string;
  issuedAtMillis: number;
  validFromMillis: number;
  expiresAtMillis: number;
  credentialId: string;
  androidInstallationPublicKeySha256: Uint8Array | null;
  androidSsaidUtf8: Uint8Array | null;
  iosRecoveryPublicKeyX963: Uint8Array | null;
  iosAppAttestKeyId: string | null;
}>;

const challengeIdPattern = /^bsdc_[A-Za-z0-9_-]{43}$/u;
const credentialIdPattern = /^bsic_[A-Za-z0-9_-]{43}$/u;
const requestFingerprintPattern = /^[0-9a-f]{64}$/u;
const logicalRequestIdPattern = /^[A-Za-z0-9_-]{16,128}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const androidSsaidPattern = /^[0-9a-f]{16}$/u;
const appAttestKeyIdPattern = /^[A-Za-z0-9_-]{43}$/u;
const challengeKeys = Object.freeze([
  "authenticatedUserId",
  "challengeBytes",
  "challengeId",
  "expiresAtMillis",
  "issuedAtMillis",
  "logicalRequestId",
  "origin",
  "platform",
  "protocolVersion",
  "purpose",
  "requestFingerprint",
  "schemaVersion",
  "validFromMillis",
].sort());
const issueKeys = Object.freeze(["platform", "request", "schemaVersion"].sort());
const useKeys = Object.freeze([
  "challengeId",
  "proof",
  "request",
  "schemaVersion",
].sort());
const androidEnrollmentKeys = Object.freeze([
  "androidSsaid",
  "credentialId",
  "installationPublicKeySpki",
  "integrityToken",
  "kind",
  "possessionSignature",
  "schemaVersion",
].sort());
const androidUseKeys = Object.freeze([
  "credentialId",
  "kind",
  "possessionSignature",
  "schemaVersion",
].sort());
const iosEnrollmentKeys = Object.freeze([
  "appAttestKeyId",
  "attestationObject",
  "credentialId",
  "kind",
  "possessionSignature",
  "recoveryPublicKeyX963",
  "schemaVersion",
].sort());
const iosUseKeys = Object.freeze([
  "appAttestKeyId",
  "assertionObject",
  "credentialId",
  "kind",
  "possessionSignature",
  "schemaVersion",
].sort());

function invalidRequest(): never {
  throw new CustomerBiteSaverContractError(
    "invalid-argument",
    "The BiteSaver device proof request is invalid.",
  );
}

function invalidState(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition",
    "The BiteSaver device proof state is invalid.",
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function validUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validUserId(value: unknown): value is string | null {
  return value === null || (
    typeof value === "string" && value.length > 0 &&
    value !== "." && value !== ".." && !/^__.*__$/u.test(value) &&
    !value.includes("/") && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value) && validUtf16(value) &&
    Buffer.byteLength(value, "utf8") <= 128
  );
}

function safeTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function decodeCustomerBiteSaverBase64Url(
  value: unknown,
  minimumBytes: number,
  maximumBytes: number,
): Buffer {
  if (typeof value !== "string" || !base64UrlPattern.test(value) ||
    value.includes("=") || value.length > Math.ceil(maximumBytes * 4 / 3)
  ) {
    return invalidRequest();
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    return invalidRequest();
  }
  if (decoded.length < minimumBytes || decoded.length > maximumBytes ||
    decoded.toString("base64url") !== value
  ) {
    return invalidRequest();
  }
  return decoded;
}

function boundedString(
  value: unknown,
  minimumBytes: number,
  maximumBytes: number,
): string {
  if (typeof value !== "string" || !validUtf16(value)) return invalidRequest();
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < minimumBytes || bytes > maximumBytes) return invalidRequest();
  return value;
}

export function parseCustomerBiteSaverDeviceUseChallenge(
  value: unknown,
): CustomerBiteSaverDeviceUseChallenge {
  if (!isPlainRecord(value) || !exactKeys(value, challengeKeys) ||
    value.schemaVersion !== customerBiteSaverDeviceProofSchemaVersion ||
    value.protocolVersion !== customerBiteSaverDeviceProofProtocolVersion ||
    typeof value.challengeId !== "string" ||
    !challengeIdPattern.test(value.challengeId) ||
    (value.platform !== "android" && value.platform !== "ios") ||
    value.purpose !== customerBiteSaverDeviceUsePurpose ||
    typeof value.requestFingerprint !== "string" ||
    !requestFingerprintPattern.test(value.requestFingerprint) ||
    !validUserId(value.authenticatedUserId) ||
    (value.origin !== "discovery" && value.origin !== "saved") ||
    typeof value.logicalRequestId !== "string" ||
    !logicalRequestIdPattern.test(value.logicalRequestId) ||
    !safeTime(value.issuedAtMillis) || !safeTime(value.validFromMillis) ||
    !safeTime(value.expiresAtMillis) ||
    value.validFromMillis < value.issuedAtMillis ||
    value.expiresAtMillis <= value.validFromMillis ||
    value.expiresAtMillis - value.issuedAtMillis >
      customerBiteSaverDeviceChallengeLifetimeMilliseconds
  ) {
    return invalidRequest();
  }
  const challengeBytes = decodeCustomerBiteSaverBase64Url(
    value.challengeBytes,
    32,
    32,
  );
  if (`bsdc_${challengeBytes.toString("base64url")}` !== value.challengeId) {
    return invalidRequest();
  }
  return Object.freeze({
    schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
    protocolVersion: customerBiteSaverDeviceProofProtocolVersion,
    challengeId: value.challengeId,
    platform: value.platform,
    purpose: customerBiteSaverDeviceUsePurpose,
    requestFingerprint: value.requestFingerprint,
    authenticatedUserId: value.authenticatedUserId,
    origin: value.origin,
    logicalRequestId: value.logicalRequestId,
    issuedAtMillis: value.issuedAtMillis,
    validFromMillis: value.validFromMillis,
    expiresAtMillis: value.expiresAtMillis,
    challengeBytes: value.challengeBytes as string,
  });
}

export function parseCustomerBiteSaverDeviceProof(
  value: unknown,
): CustomerBiteSaverDeviceProof {
  if (!isPlainRecord(value) ||
    value.schemaVersion !== customerBiteSaverDeviceProofSchemaVersion ||
    typeof value.credentialId !== "string" ||
    !credentialIdPattern.test(value.credentialId)
  ) {
    return invalidRequest();
  }
  if (value.kind === "androidEnrollment") {
    if (!exactKeys(value, androidEnrollmentKeys) ||
      typeof value.androidSsaid !== "string" ||
      !androidSsaidPattern.test(value.androidSsaid)
    ) {
      return invalidRequest();
    }
    decodeCustomerBiteSaverBase64Url(value.installationPublicKeySpki, 80, 160);
    decodeCustomerBiteSaverBase64Url(value.possessionSignature, 64, 80);
    const integrityToken = boundedString(value.integrityToken, 1, 32_768);
    return Object.freeze({
      schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
      kind: "androidEnrollment",
      credentialId: value.credentialId,
      installationPublicKeySpki: value.installationPublicKeySpki as string,
      androidSsaid: value.androidSsaid,
      possessionSignature: value.possessionSignature as string,
      integrityToken,
    });
  }
  if (value.kind === "androidUse") {
    if (!exactKeys(value, androidUseKeys)) return invalidRequest();
    decodeCustomerBiteSaverBase64Url(value.possessionSignature, 64, 80);
    return Object.freeze({
      schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
      kind: "androidUse",
      credentialId: value.credentialId,
      possessionSignature: value.possessionSignature as string,
    });
  }
  if (value.kind === "iosEnrollment") {
    if (!exactKeys(value, iosEnrollmentKeys) ||
      typeof value.appAttestKeyId !== "string" ||
      !appAttestKeyIdPattern.test(value.appAttestKeyId)
    ) {
      return invalidRequest();
    }
    const recoveryKey = decodeCustomerBiteSaverBase64Url(
      value.recoveryPublicKeyX963,
      65,
      65,
    );
    if (recoveryKey[0] !== 0x04) return invalidRequest();
    decodeCustomerBiteSaverBase64Url(value.possessionSignature, 64, 80);
    decodeCustomerBiteSaverBase64Url(value.attestationObject, 1, 65_536);
    return Object.freeze({
      schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
      kind: "iosEnrollment",
      credentialId: value.credentialId,
      recoveryPublicKeyX963: value.recoveryPublicKeyX963 as string,
      appAttestKeyId: value.appAttestKeyId,
      possessionSignature: value.possessionSignature as string,
      attestationObject: value.attestationObject as string,
    });
  }
  if (value.kind === "iosUse") {
    if (!exactKeys(value, iosUseKeys) ||
      typeof value.appAttestKeyId !== "string" ||
      !appAttestKeyIdPattern.test(value.appAttestKeyId)
    ) {
      return invalidRequest();
    }
    decodeCustomerBiteSaverBase64Url(value.possessionSignature, 64, 80);
    decodeCustomerBiteSaverBase64Url(value.assertionObject, 1, 16_384);
    return Object.freeze({
      schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
      kind: "iosUse",
      credentialId: value.credentialId,
      appAttestKeyId: value.appAttestKeyId,
      possessionSignature: value.possessionSignature as string,
      assertionObject: value.assertionObject as string,
    });
  }
  return invalidRequest();
}

export function parseCustomerBiteSaverIssueDeviceChallengeRequest(
  value: unknown,
  parseCombinedUseRequest: (raw: unknown) => CustomerBiteSaverCombinedUseRequest,
): CustomerBiteSaverIssueDeviceChallengeRequest {
  if (!isPlainRecord(value) || !exactKeys(value, issueKeys) ||
    value.schemaVersion !== customerBiteSaverDeviceProofSchemaVersion ||
    (value.platform !== "android" && value.platform !== "ios")
  ) {
    return invalidRequest();
  }
  return Object.freeze({
    schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
    platform: value.platform,
    request: parseCombinedUseRequest(value.request),
  });
}

export function parseCustomerBiteSaverUseCouponWithDeviceProofRequest(
  value: unknown,
  parseCombinedUseRequest: (raw: unknown) => CustomerBiteSaverCombinedUseRequest,
): CustomerBiteSaverUseCouponWithDeviceProofRequest {
  if (!isPlainRecord(value) || !exactKeys(value, useKeys) ||
    value.schemaVersion !== customerBiteSaverDeviceProofSchemaVersion ||
    typeof value.challengeId !== "string" ||
    !challengeIdPattern.test(value.challengeId)
  ) {
    return invalidRequest();
  }
  return Object.freeze({
    schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
    challengeId: value.challengeId,
    request: parseCombinedUseRequest(value.request),
    proof: parseCustomerBiteSaverDeviceProof(value.proof),
  });
}

function uint32(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    return invalidState();
  }
  const result = Buffer.allocUnsafe(4);
  result.writeUInt32BE(value);
  return result;
}

function uint64(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) return invalidState();
  const result = Buffer.allocUnsafe(8);
  result.writeBigUInt64BE(BigInt(value));
  return result;
}

function canonicalBytes(value: Uint8Array): Buffer {
  if (!(value instanceof Uint8Array) || value.length > 0xffffffff) {
    return invalidState();
  }
  const bytes = Buffer.from(value);
  return Buffer.concat([uint32(bytes.length), bytes]);
}

function canonicalText(value: string): Buffer {
  if (typeof value !== "string" || !validUtf16(value)) return invalidState();
  return canonicalBytes(Buffer.from(value, "utf8"));
}

function nullableBytes(value: Uint8Array | null): Buffer {
  return value === null
    ? Buffer.from([0])
    : Buffer.concat([Buffer.from([1]), canonicalBytes(value)]);
}

function nullableText(value: string | null): Buffer {
  return value === null
    ? Buffer.from([0])
    : Buffer.concat([Buffer.from([1]), canonicalText(value)]);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function validateTranscript(value: CustomerBiteSaverDeviceProofTranscript): void {
  if (value.schemaVersion !== customerBiteSaverDeviceProofSchemaVersion ||
    value.protocolVersion !== customerBiteSaverDeviceProofProtocolVersion ||
    !challengeIdPattern.test(value.challengeId) ||
    value.purpose !== customerBiteSaverDeviceUsePurpose ||
    !(value.challengeBytes instanceof Uint8Array) ||
    value.challengeBytes.length !== 32 ||
    !(value.requestFingerprint instanceof Uint8Array) ||
    value.requestFingerprint.length !== 32 ||
    !validUserId(value.authenticatedUserId) ||
    (value.origin !== "discovery" && value.origin !== "saved") ||
    !logicalRequestIdPattern.test(value.logicalRequestId) ||
    !safeTime(value.issuedAtMillis) || !safeTime(value.validFromMillis) ||
    !safeTime(value.expiresAtMillis) ||
    value.validFromMillis < value.issuedAtMillis ||
    value.expiresAtMillis <= value.validFromMillis ||
    value.expiresAtMillis - value.issuedAtMillis >
      customerBiteSaverDeviceChallengeLifetimeMilliseconds ||
    !credentialIdPattern.test(value.credentialId)
  ) {
    return invalidState();
  }
  const challengeId = `bsdc_${Buffer.from(value.challengeBytes).toString("base64url")}`;
  if (challengeId !== value.challengeId) return invalidState();
  const android = value.platform === "android" &&
    (value.proofKind === "androidEnrollment" || value.proofKind === "androidUse");
  const ios = value.platform === "ios" &&
    (value.proofKind === "iosEnrollment" || value.proofKind === "iosUse");
  if (!android && !ios) return invalidState();
  if (android) {
    if (!(value.androidInstallationPublicKeySha256 instanceof Uint8Array) ||
      value.androidInstallationPublicKeySha256.length !== 32 ||
      value.iosRecoveryPublicKeyX963 !== null ||
      value.iosAppAttestKeyId !== null ||
      (value.proofKind === "androidEnrollment"
        ? !(value.androidSsaidUtf8 instanceof Uint8Array) ||
          !androidSsaidPattern.test(Buffer.from(value.androidSsaidUtf8).toString("utf8"))
        : value.androidSsaidUtf8 !== null)
    ) {
      return invalidState();
    }
  } else if (value.androidInstallationPublicKeySha256 !== null ||
    value.androidSsaidUtf8 !== null ||
    !(value.iosRecoveryPublicKeyX963 instanceof Uint8Array) ||
    value.iosRecoveryPublicKeyX963.length !== 65 ||
    value.iosRecoveryPublicKeyX963[0] !== 0x04 ||
    value.iosAppAttestKeyId === null ||
    !appAttestKeyIdPattern.test(value.iosAppAttestKeyId)
  ) {
    return invalidState();
  }
  const publicKeyHash = android
    ? value.androidInstallationPublicKeySha256 as Uint8Array
    : createHash("sha256").update(
        value.iosRecoveryPublicKeyX963 as Uint8Array,
      ).digest();
  if (customerBiteSaverCredentialId(value.platform, publicKeyHash) !==
    value.credentialId
  ) {
    return invalidState();
  }
}

export function encodeCustomerBiteSaverDeviceProofTranscript(
  value: CustomerBiteSaverDeviceProofTranscript,
): Buffer {
  validateTranscript(value);
  return Buffer.concat([
    Buffer.from(customerBiteSaverDeviceTranscriptDomain, "ascii"),
    uint32(value.schemaVersion),
    canonicalText(value.protocolVersion),
    canonicalText(value.proofKind),
    canonicalText(value.platform),
    canonicalText(value.purpose),
    canonicalText(value.challengeId),
    canonicalBytes(value.challengeBytes),
    canonicalBytes(value.requestFingerprint),
    nullableText(value.authenticatedUserId),
    canonicalText(value.origin),
    canonicalText(value.logicalRequestId),
    uint64(value.issuedAtMillis),
    uint64(value.validFromMillis),
    uint64(value.expiresAtMillis),
    nullableText(value.credentialId),
    nullableBytes(value.androidInstallationPublicKeySha256),
    nullableBytes(value.androidSsaidUtf8),
    nullableBytes(value.iosRecoveryPublicKeyX963),
    nullableText(value.iosAppAttestKeyId),
  ]);
}

export function customerBiteSaverDeviceProofTranscriptSha256(
  value: CustomerBiteSaverDeviceProofTranscript,
): Buffer {
  return createHash("sha256").update(
    encodeCustomerBiteSaverDeviceProofTranscript(value),
  ).digest();
}

export function encodeCustomerBiteSaverIosAssertionClientData(
  transcriptSha256: Uint8Array,
  possessionSignature: Uint8Array,
): Buffer {
  if (!(transcriptSha256 instanceof Uint8Array) ||
    transcriptSha256.length !== 32 ||
    !(possessionSignature instanceof Uint8Array) ||
    possessionSignature.length < 64 || possessionSignature.length > 80
  ) {
    return invalidState();
  }
  return Buffer.concat([
    Buffer.from(customerBiteSaverDeviceAssertionDomain, "ascii"),
    canonicalBytes(transcriptSha256),
    canonicalBytes(possessionSignature),
  ]);
}

export function customerBiteSaverIosAssertionClientDataHash(
  transcriptSha256: Uint8Array,
  possessionSignature: Uint8Array,
): Buffer {
  return createHash("sha256").update(
    encodeCustomerBiteSaverIosAssertionClientData(
      transcriptSha256,
      possessionSignature,
    ),
  ).digest();
}

export function customerBiteSaverCredentialId(
  platform: CustomerBiteSaverDevicePlatform,
  publicKeySha256: Uint8Array,
): string {
  if ((platform !== "android" && platform !== "ios") ||
    !(publicKeySha256 instanceof Uint8Array) || publicKeySha256.length !== 32
  ) {
    return invalidState();
  }
  const digest = createHash("sha256").update(Buffer.concat([
    Buffer.from(customerBiteSaverCredentialIdDomain, "ascii"),
    canonicalText(platform),
    canonicalBytes(publicKeySha256),
  ])).digest("base64url");
  return `bsic_${digest}`;
}

export function buildCustomerBiteSaverDeviceProofTranscript(value: {
  challenge: CustomerBiteSaverDeviceUseChallenge;
  proofKind: CustomerBiteSaverDeviceProofKind;
  credentialId: string;
  androidInstallationPublicKeySha256?: Uint8Array | null;
  androidSsaid?: string | null;
  iosRecoveryPublicKeyX963?: Uint8Array | null;
  iosAppAttestKeyId?: string | null;
}): CustomerBiteSaverDeviceProofTranscript {
  const challenge = parseCustomerBiteSaverDeviceUseChallenge(value.challenge);
  const transcript = Object.freeze({
    schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
    protocolVersion: customerBiteSaverDeviceProofProtocolVersion,
    proofKind: value.proofKind,
    platform: challenge.platform,
    purpose: customerBiteSaverDeviceUsePurpose,
    challengeId: challenge.challengeId,
    challengeBytes: decodeCustomerBiteSaverBase64Url(
      challenge.challengeBytes,
      32,
      32,
    ),
    requestFingerprint: Buffer.from(challenge.requestFingerprint, "hex"),
    authenticatedUserId: challenge.authenticatedUserId,
    origin: challenge.origin,
    logicalRequestId: challenge.logicalRequestId,
    issuedAtMillis: challenge.issuedAtMillis,
    validFromMillis: challenge.validFromMillis,
    expiresAtMillis: challenge.expiresAtMillis,
    credentialId: value.credentialId,
    androidInstallationPublicKeySha256:
      value.androidInstallationPublicKeySha256 ?? null,
    androidSsaidUtf8: value.androidSsaid === undefined || value.androidSsaid === null
      ? null
      : Buffer.from(value.androidSsaid, "utf8"),
    iosRecoveryPublicKeyX963: value.iosRecoveryPublicKeyX963 ?? null,
    iosAppAttestKeyId: value.iosAppAttestKeyId ?? null,
  });
  validateTranscript(transcript);
  return transcript;
}

export function customerBiteSaverDeviceProofDigest(
  proof: CustomerBiteSaverDeviceProof,
): string {
  const parsed = parseCustomerBiteSaverDeviceProof(proof);
  const fields: readonly string[] = parsed.kind === "androidEnrollment"
    ? [parsed.kind, parsed.credentialId, parsed.installationPublicKeySpki,
      parsed.androidSsaid, parsed.possessionSignature, parsed.integrityToken]
    : parsed.kind === "androidUse"
      ? [parsed.kind, parsed.credentialId, parsed.possessionSignature]
      : parsed.kind === "iosEnrollment"
        ? [parsed.kind, parsed.credentialId, parsed.recoveryPublicKeyX963,
          parsed.appAttestKeyId, parsed.possessionSignature,
          parsed.attestationObject]
        : [parsed.kind, parsed.credentialId, parsed.appAttestKeyId,
          parsed.possessionSignature, parsed.assertionObject];
  const chunks: Uint8Array[] = [
    Buffer.from("BiteStar/BiteSaver/DeviceProofDigest/v1\0", "ascii"),
  ];
  for (const field of fields) chunks.push(canonicalText(field));
  return createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
}

export function customerBiteSaverChallengeMatchesRequest(value: {
  challenge: CustomerBiteSaverDeviceUseChallenge;
  request: CustomerBiteSaverCombinedUseRequest;
  authenticatedUserId: string | null;
  nowMillis: number;
}): boolean {
  const challenge = parseCustomerBiteSaverDeviceUseChallenge(value.challenge);
  return Number.isSafeInteger(value.nowMillis) &&
    value.nowMillis >= challenge.validFromMillis &&
    value.nowMillis < challenge.expiresAtMillis &&
    challenge.requestFingerprint ===
      customerBiteSaverCombinedUseRequestFingerprint(value.request) &&
    challenge.authenticatedUserId === value.authenticatedUserId &&
    challenge.origin === value.request.origin.kind &&
    challenge.logicalRequestId === value.request.logicalRequestId;
}

export const customerBiteSaverDeviceTranscriptGoldenVector = Object.freeze({
  credentialId: "bsic_YcxipHbd8t0dF7rGAx_n9Q_XEbD0WVoVDuhK_wudtPI",
  encodedLength: 441,
  sha256: "958ae8084cbc061695525386fbbcd3eabbdfd566ab11fc422e72381992cb5b17",
  requestHash: "lYroCEy8BhaVUlOG-7zT6rvf1WarEfxCLnI4GZLLWxc",
});

export const customerBiteSaverDeviceProofContractInternals = Object.freeze({
  challengeIdPattern,
  credentialIdPattern,
  equalBytes,
  exactKeys,
  validUtf16,
});
