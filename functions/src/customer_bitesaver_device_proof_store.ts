import { randomBytes } from "node:crypto";
import {
  customerBiteSaverDeviceChallengeCleanupDelayMilliseconds,
  customerBiteSaverDeviceChallengeLifetimeMilliseconds,
  customerBiteSaverDeviceProofProtocolVersion,
  customerBiteSaverDeviceProofSchemaVersion,
  parseCustomerBiteSaverDeviceUseChallenge,
  type CustomerBiteSaverDevicePlatform,
  type CustomerBiteSaverDeviceUseChallenge,
} from "./customer_bitesaver_device_proof_contract.js";
import {
  customerBiteSaverInstallationRecordId,
  type CustomerBiteSaverDeviceRootKeyV1,
} from "./customer_bitesaver_device_identity.js";
import type {
  CustomerBiteSaverCombinedUseRequest,
} from "./customer_bitesaver_device_usage_core.js";
import {
  customerBiteSaverCombinedUseRequestFingerprint,
  customerBiteSaverDeviceUsePurpose,
} from
  "./customer_bitesaver_device_usage_core.js";
import { CustomerBiteSaverContractError } from
  "./customer_bitesaver_search_contract.js";
import type {
  CustomerBiteSaverSearchDatabase,
  CustomerBiteSaverStoredDocument,
  CustomerBiteSaverTransaction,
} from "./customer_bitesaver_search_store.js";

export const privateCustomerBiteSaverDeviceChallengeCollection =
  "private_bitesaver_device_challenges" as const;
export const privateCustomerBiteSaverDeviceInstallationCollection =
  "private_bitesaver_device_installations" as const;

type CustomerBiteSaverIssuedChallengeDocument = Readonly<{
  protocolVersion: typeof customerBiteSaverDeviceProofProtocolVersion;
  schemaVersion: typeof customerBiteSaverDeviceProofSchemaVersion;
  role: "deviceUseChallenge";
  state: "issued";
  challengeId: string;
  platform: CustomerBiteSaverDevicePlatform;
  purpose: typeof customerBiteSaverDeviceUsePurpose;
  requestFingerprint: string;
  authenticatedUserId: string | null;
  origin: "discovery" | "saved";
  logicalRequestId: string;
  challengeBytes: string;
  issuedAt: Date;
  validFrom: Date;
  expiresAt: Date;
  deleteAfter: Date;
}>;

type CustomerBiteSaverVerifiedChallengeDocument = Omit<
  CustomerBiteSaverIssuedChallengeDocument,
  "state"
> & Readonly<{
  state: "verified";
  proofDigest: string;
  credentialId: string;
  deviceRef: string;
  verifiedAt: Date;
}>;

export type CustomerBiteSaverStoredChallenge = Readonly<{
  challenge: CustomerBiteSaverDeviceUseChallenge;
  state: "issued" | "verified";
  proofDigest: string | null;
  credentialId: string | null;
  deviceRef: string | null;
  verifiedAtMillis: number | null;
}>;

export type CustomerBiteSaverAndroidQualification = Readonly<{
  packageName: string;
  versionCode: string;
  certificateSha256Digests: readonly string[];
  appRecognitionVerdict: "PLAY_RECOGNIZED";
  deviceRecognitionVerdicts: readonly string[];
  licensingVerdict: string | null;
}>;

export type CustomerBiteSaverAndroidInstallationEnrollment = Readonly<{
  platform: "android";
  credentialId: string;
  deviceRef: string;
  credentialPublicKey: string;
  credentialPublicKeySha256: string;
  qualification: CustomerBiteSaverAndroidQualification;
}>;

export type CustomerBiteSaverIosInstallationEnrollment = Readonly<{
  platform: "ios";
  credentialId: string;
  deviceRef: string;
  credentialPublicKey: string;
  credentialPublicKeySha256: string;
  appAttestKeyId: string;
  appAttestPublicKeySpki: string;
  appId: string;
  environment: "development" | "production";
  initialAssertionCounter: number;
}>;

export type CustomerBiteSaverInstallationEnrollment =
  | CustomerBiteSaverAndroidInstallationEnrollment
  | CustomerBiteSaverIosInstallationEnrollment;

export type CustomerBiteSaverStoredInstallation = Readonly<{
  protocolVersion: typeof customerBiteSaverDeviceProofProtocolVersion;
  schemaVersion: typeof customerBiteSaverDeviceProofSchemaVersion;
  role: "deviceInstallation";
  platform: CustomerBiteSaverDevicePlatform;
  credentialId: string;
  deviceRef: string;
  credentialPublicKey: string;
  credentialPublicKeySha256: string;
  createdAtMillis: number;
  updatedAtMillis: number;
  lastQualifiedAtMillis: number;
  qualification: CustomerBiteSaverAndroidQualification | null;
  appAttestKeyId: string | null;
  appAttestPublicKeySpki: string | null;
  appId: string | null;
  environment: "development" | "production" | null;
  assertionCounter: number | null;
  enrollmentIssuedAtMillis: number | null;
  enrollmentChallengeId: string | null;
}>;

export type CustomerBiteSaverVerifiedProofCommit = Readonly<{
  replayed: boolean;
  deviceRef: string;
  validFromMillis: number;
  validUntilMillis: number;
}>;

const issuedChallengeKeys = Object.freeze([
  "authenticatedUserId",
  "challengeBytes",
  "challengeId",
  "deleteAfter",
  "expiresAt",
  "issuedAt",
  "logicalRequestId",
  "origin",
  "platform",
  "protocolVersion",
  "purpose",
  "requestFingerprint",
  "role",
  "schemaVersion",
  "state",
  "validFrom",
].sort());
const verifiedChallengeKeys = Object.freeze([
  ...issuedChallengeKeys,
  "credentialId",
  "deviceRef",
  "proofDigest",
  "verifiedAt",
].sort());
const androidInstallationKeys = Object.freeze([
  "createdAt",
  "credentialId",
  "credentialPublicKey",
  "credentialPublicKeySha256",
  "deviceRef",
  "lastQualifiedAt",
  "platform",
  "protocolVersion",
  "qualification",
  "role",
  "schemaVersion",
  "updatedAt",
].sort());
const iosInstallationKeys = Object.freeze([
  "appAttestKeyId",
  "appAttestPublicKeySpki",
  "appId",
  "assertionCounter",
  "createdAt",
  "credentialId",
  "credentialPublicKey",
  "credentialPublicKeySha256",
  "deviceRef",
  "enrollmentChallengeId",
  "enrollmentIssuedAt",
  "environment",
  "lastQualifiedAt",
  "platform",
  "protocolVersion",
  "role",
  "schemaVersion",
  "updatedAt",
].sort());
const qualificationKeys = Object.freeze([
  "appRecognitionVerdict",
  "certificateSha256Digests",
  "deviceRecognitionVerdicts",
  "licensingVerdict",
  "packageName",
  "versionCode",
].sort());

function invalidState(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition",
    "The BiteSaver device proof state is invalid.",
  );
}

function rejectedProof(): never {
  throw new CustomerBiteSaverContractError(
    "permission-denied",
    "BiteSaver device proof was rejected.",
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function dateMillis(value: unknown): number | null {
  let candidate = value;
  if (candidate !== null && typeof candidate === "object" &&
    !(candidate instanceof Date)
  ) {
    const toDate = (candidate as {toDate?: unknown}).toDate;
    if (typeof toDate !== "function") return null;
    try {
      candidate = toDate.call(candidate);
    } catch {
      return null;
    }
  }
  if (!(candidate instanceof Date)) return null;
  const millis = candidate.getTime();
  return Number.isSafeInteger(millis) && millis >= 0 ? millis : null;
}

function challengePath(challengeId: string): string {
  if (!/^bsdc_[A-Za-z0-9_-]{43}$/u.test(challengeId)) return invalidState();
  return `${privateCustomerBiteSaverDeviceChallengeCollection}/${challengeId}`;
}

export function customerBiteSaverInstallationPath(value: {
  rootKey: CustomerBiteSaverDeviceRootKeyV1;
  platform: CustomerBiteSaverDevicePlatform;
  credentialId: string;
}): string {
  return `${privateCustomerBiteSaverDeviceInstallationCollection}/` +
    customerBiteSaverInstallationRecordId(value);
}

function challengeFromDocument(
  document: CustomerBiteSaverStoredDocument | null,
  expectedChallengeId: string,
): CustomerBiteSaverStoredChallenge {
  if (document === null || document.path !== challengePath(expectedChallengeId) ||
    document.id !== expectedChallengeId || !isPlainRecord(document.data)
  ) {
    return rejectedProof();
  }
  const data = document.data;
  const issuedAtMillis = dateMillis(data.issuedAt);
  const validFromMillis = dateMillis(data.validFrom);
  const expiresAtMillis = dateMillis(data.expiresAt);
  const deleteAfterMillis = dateMillis(data.deleteAfter);
  const verified = data.state === "verified";
  if (!exactKeys(data, verified ? verifiedChallengeKeys : issuedChallengeKeys) ||
    data.protocolVersion !== customerBiteSaverDeviceProofProtocolVersion ||
    data.schemaVersion !== customerBiteSaverDeviceProofSchemaVersion ||
    data.role !== "deviceUseChallenge" ||
    (data.state !== "issued" && data.state !== "verified") ||
    data.challengeId !== expectedChallengeId ||
    issuedAtMillis === null || validFromMillis === null ||
    expiresAtMillis === null || deleteAfterMillis === null ||
    deleteAfterMillis !== expiresAtMillis +
      customerBiteSaverDeviceChallengeCleanupDelayMilliseconds
  ) {
    return invalidState();
  }
  const challenge = parseCustomerBiteSaverDeviceUseChallenge({
    schemaVersion: data.schemaVersion,
    protocolVersion: data.protocolVersion,
    challengeId: data.challengeId,
    platform: data.platform,
    purpose: data.purpose,
    requestFingerprint: data.requestFingerprint,
    authenticatedUserId: data.authenticatedUserId,
    origin: data.origin,
    logicalRequestId: data.logicalRequestId,
    issuedAtMillis,
    validFromMillis,
    expiresAtMillis,
    challengeBytes: data.challengeBytes,
  });
  if (!verified) {
    return Object.freeze({
      challenge,
      state: "issued",
      proofDigest: null,
      credentialId: null,
      deviceRef: null,
      verifiedAtMillis: null,
    });
  }
  const verifiedAtMillis = dateMillis(data.verifiedAt);
  if (typeof data.proofDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.proofDigest) ||
    typeof data.credentialId !== "string" ||
    !/^bsic_[A-Za-z0-9_-]{43}$/u.test(data.credentialId) ||
    typeof data.deviceRef !== "string" ||
    !/^bsd_[A-Za-z0-9_-]{43}$/u.test(data.deviceRef) ||
    verifiedAtMillis === null || verifiedAtMillis < issuedAtMillis ||
    verifiedAtMillis >= expiresAtMillis
  ) {
    return invalidState();
  }
  return Object.freeze({
    challenge,
    state: "verified",
    proofDigest: data.proofDigest,
    credentialId: data.credentialId,
    deviceRef: data.deviceRef,
    verifiedAtMillis,
  });
}

function validStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 8 &&
    value.every((entry) => typeof entry === "string" && entry.length > 0 &&
      entry.length <= 256);
}

function parseQualification(value: unknown): CustomerBiteSaverAndroidQualification | null {
  if (!isPlainRecord(value) || !exactKeys(value, qualificationKeys) ||
    typeof value.packageName !== "string" || value.packageName.length === 0 ||
    value.packageName.length > 255 || typeof value.versionCode !== "string" ||
    !/^[0-9]{1,20}$/u.test(value.versionCode) ||
    !validStringArray(value.certificateSha256Digests) ||
    value.appRecognitionVerdict !== "PLAY_RECOGNIZED" ||
    !validStringArray(value.deviceRecognitionVerdicts) ||
    (value.licensingVerdict !== null &&
      (typeof value.licensingVerdict !== "string" ||
        value.licensingVerdict.length > 128))
  ) {
    return null;
  }
  return Object.freeze({
    packageName: value.packageName,
    versionCode: value.versionCode,
    certificateSha256Digests: Object.freeze([...value.certificateSha256Digests]),
    appRecognitionVerdict: "PLAY_RECOGNIZED",
    deviceRecognitionVerdicts: Object.freeze([...value.deviceRecognitionVerdicts]),
    licensingVerdict: value.licensingVerdict,
  });
}

function installationFromDocument(
  document: CustomerBiteSaverStoredDocument | null,
  expectedPath: string,
  expectedPlatform: CustomerBiteSaverDevicePlatform,
  expectedCredentialId: string,
): CustomerBiteSaverStoredInstallation | null {
  if (document === null) return null;
  const data = document.data;
  const createdAtMillis = dateMillis(data.createdAt);
  const updatedAtMillis = dateMillis(data.updatedAt);
  const lastQualifiedAtMillis = dateMillis(data.lastQualifiedAt);
  const android = expectedPlatform === "android";
  if (document.path !== expectedPath ||
    document.id !== expectedPath.slice(expectedPath.lastIndexOf("/") + 1) ||
    !isPlainRecord(data) ||
    !exactKeys(data, android ? androidInstallationKeys : iosInstallationKeys) ||
    data.protocolVersion !== customerBiteSaverDeviceProofProtocolVersion ||
    data.schemaVersion !== customerBiteSaverDeviceProofSchemaVersion ||
    data.role !== "deviceInstallation" || data.platform !== expectedPlatform ||
    data.credentialId !== expectedCredentialId ||
    typeof data.deviceRef !== "string" ||
    !/^bsd_[A-Za-z0-9_-]{43}$/u.test(data.deviceRef) ||
    typeof data.credentialPublicKey !== "string" ||
    data.credentialPublicKey.length === 0 ||
    data.credentialPublicKey.length > 512 ||
    typeof data.credentialPublicKeySha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(data.credentialPublicKeySha256) ||
    createdAtMillis === null || updatedAtMillis === null ||
    lastQualifiedAtMillis === null ||
    createdAtMillis > lastQualifiedAtMillis ||
    lastQualifiedAtMillis > updatedAtMillis
  ) {
    return invalidState();
  }
  if (android) {
    const qualification = parseQualification(data.qualification);
    if (qualification === null) return invalidState();
    return Object.freeze({
      protocolVersion: customerBiteSaverDeviceProofProtocolVersion,
      schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
      role: "deviceInstallation",
      platform: "android",
      credentialId: expectedCredentialId,
      deviceRef: data.deviceRef,
      credentialPublicKey: data.credentialPublicKey,
      credentialPublicKeySha256: data.credentialPublicKeySha256,
      createdAtMillis,
      updatedAtMillis,
      lastQualifiedAtMillis,
      qualification,
      appAttestKeyId: null,
      appAttestPublicKeySpki: null,
      appId: null,
      environment: null,
      assertionCounter: null,
      enrollmentIssuedAtMillis: null,
      enrollmentChallengeId: null,
    });
  }
  const enrollmentIssuedAtMillis = dateMillis(data.enrollmentIssuedAt);
  if (enrollmentIssuedAtMillis === null ||
    enrollmentIssuedAtMillis > lastQualifiedAtMillis ||
    typeof data.enrollmentChallengeId !== "string" ||
    !/^bsdc_[A-Za-z0-9_-]{43}$/u.test(data.enrollmentChallengeId) ||
    typeof data.appAttestKeyId !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(data.appAttestKeyId) ||
    typeof data.appAttestPublicKeySpki !== "string" ||
    data.appAttestPublicKeySpki.length === 0 ||
    data.appAttestPublicKeySpki.length > 512 ||
    typeof data.appId !== "string" || data.appId.length === 0 ||
    data.appId.length > 255 ||
    (data.environment !== "development" && data.environment !== "production") ||
    typeof data.assertionCounter !== "number" ||
    !Number.isSafeInteger(data.assertionCounter) || data.assertionCounter < 0 ||
    data.assertionCounter > 0xffffffff
  ) {
    return invalidState();
  }
  return Object.freeze({
    protocolVersion: customerBiteSaverDeviceProofProtocolVersion,
    schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
    role: "deviceInstallation",
    platform: "ios",
    credentialId: expectedCredentialId,
    deviceRef: data.deviceRef,
    credentialPublicKey: data.credentialPublicKey,
    credentialPublicKeySha256: data.credentialPublicKeySha256,
    createdAtMillis,
    updatedAtMillis,
    lastQualifiedAtMillis,
    qualification: null,
    appAttestKeyId: data.appAttestKeyId,
    appAttestPublicKeySpki: data.appAttestPublicKeySpki,
    appId: data.appId,
    environment: data.environment,
    assertionCounter: data.assertionCounter,
    enrollmentIssuedAtMillis,
    enrollmentChallengeId: data.enrollmentChallengeId,
  });
}

export async function issueCustomerBiteSaverDeviceUseChallenge(value: {
  database: CustomerBiteSaverSearchDatabase;
  platform: CustomerBiteSaverDevicePlatform;
  request: CustomerBiteSaverCombinedUseRequest;
  authenticatedUserId: string | null;
  nowMillis: number;
  randomSource?: (size: number) => Uint8Array;
}): Promise<CustomerBiteSaverDeviceUseChallenge> {
  if (!Number.isSafeInteger(value.nowMillis) || value.nowMillis < 0 ||
    (value.platform !== "android" && value.platform !== "ios")
  ) {
    return invalidState();
  }
  const entropy = (value.randomSource ?? randomBytes)(32);
  if (!(entropy instanceof Uint8Array) || entropy.length !== 32) {
    return invalidState();
  }
  const challengeBytes = Buffer.from(entropy).toString("base64url");
  const challengeId = `bsdc_${challengeBytes}`;
  const expiresAtMillis = value.nowMillis +
    customerBiteSaverDeviceChallengeLifetimeMilliseconds;
  const challenge = parseCustomerBiteSaverDeviceUseChallenge({
    schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
    protocolVersion: customerBiteSaverDeviceProofProtocolVersion,
    challengeId,
    platform: value.platform,
    purpose: customerBiteSaverDeviceUsePurpose,
    requestFingerprint:
      customerBiteSaverCombinedUseRequestFingerprint(value.request),
    authenticatedUserId: value.authenticatedUserId,
    origin: value.request.origin.kind,
    logicalRequestId: value.request.logicalRequestId,
    issuedAtMillis: value.nowMillis,
    validFromMillis: value.nowMillis,
    expiresAtMillis,
    challengeBytes,
  });
  const document: CustomerBiteSaverIssuedChallengeDocument = Object.freeze({
    protocolVersion: customerBiteSaverDeviceProofProtocolVersion,
    schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
    role: "deviceUseChallenge",
    state: "issued",
    challengeId,
    platform: value.platform,
    purpose: customerBiteSaverDeviceUsePurpose,
    requestFingerprint: challenge.requestFingerprint,
    authenticatedUserId: value.authenticatedUserId,
    origin: challenge.origin,
    logicalRequestId: challenge.logicalRequestId,
    challengeBytes,
    issuedAt: new Date(value.nowMillis),
    validFrom: new Date(value.nowMillis),
    expiresAt: new Date(expiresAtMillis),
    deleteAfter: new Date(
      expiresAtMillis + customerBiteSaverDeviceChallengeCleanupDelayMilliseconds,
    ),
  });
  await value.database.runTransaction(async (transaction) => {
    if (await transaction.getDocument(challengePath(challengeId)) !== null) {
      return invalidState();
    }
    transaction.createDocument(challengePath(challengeId), document);
  });
  return challenge;
}

export async function loadCustomerBiteSaverDeviceChallenge(value: {
  database: CustomerBiteSaverSearchDatabase;
  challengeId: string;
  nowMillis: number;
}): Promise<CustomerBiteSaverStoredChallenge> {
  const stored = challengeFromDocument(
    await value.database.getDocument(challengePath(value.challengeId)),
    value.challengeId,
  );
  if (!Number.isSafeInteger(value.nowMillis) || value.nowMillis < 0 ||
    value.nowMillis < stored.challenge.validFromMillis ||
    value.nowMillis >= stored.challenge.expiresAtMillis
  ) {
    return rejectedProof();
  }
  return stored;
}

export async function loadCustomerBiteSaverDeviceInstallation(value: {
  database: CustomerBiteSaverSearchDatabase;
  rootKey: CustomerBiteSaverDeviceRootKeyV1;
  platform: CustomerBiteSaverDevicePlatform;
  credentialId: string;
}): Promise<CustomerBiteSaverStoredInstallation | null> {
  const path = customerBiteSaverInstallationPath(value);
  return installationFromDocument(
    await value.database.getDocument(path),
    path,
    value.platform,
    value.credentialId,
  );
}

function enrollmentDocument(
  enrollment: CustomerBiteSaverInstallationEnrollment,
  existing: CustomerBiteSaverStoredInstallation | null,
  nowMillis: number,
  challenge: CustomerBiteSaverDeviceUseChallenge,
): Readonly<Record<string, unknown>> {
  if (existing !== null && (
    existing.platform !== enrollment.platform ||
    existing.credentialId !== enrollment.credentialId ||
    existing.deviceRef !== enrollment.deviceRef ||
    existing.credentialPublicKey !== enrollment.credentialPublicKey ||
    existing.credentialPublicKeySha256 !== enrollment.credentialPublicKeySha256
  )) {
    return invalidState();
  }
  if (enrollment.platform === "ios" && existing !== null) {
    // A total order from the transactionally reread, server-issued challenge.
    // Completion order must never roll Ka (and its counter) back. Random ID is
    // a deterministic tie-breaker for challenges issued in the same millisecond.
    if (existing.enrollmentIssuedAtMillis === null ||
      existing.enrollmentChallengeId === null ||
      challenge.issuedAtMillis < existing.enrollmentIssuedAtMillis ||
      (challenge.issuedAtMillis === existing.enrollmentIssuedAtMillis &&
        challenge.challengeId <= existing.enrollmentChallengeId)
    ) return rejectedProof();
    if (existing.appAttestKeyId === enrollment.appAttestKeyId && (
      existing.appAttestPublicKeySpki !== enrollment.appAttestPublicKeySpki ||
      existing.appId !== enrollment.appId ||
      existing.environment !== enrollment.environment
    )) return rejectedProof();
  }
  const base = {
    protocolVersion: customerBiteSaverDeviceProofProtocolVersion,
    schemaVersion: customerBiteSaverDeviceProofSchemaVersion,
    role: "deviceInstallation" as const,
    platform: enrollment.platform,
    credentialId: enrollment.credentialId,
    deviceRef: enrollment.deviceRef,
    credentialPublicKey: enrollment.credentialPublicKey,
    credentialPublicKeySha256: enrollment.credentialPublicKeySha256,
    createdAt: new Date(existing?.createdAtMillis ?? nowMillis),
    updatedAt: new Date(nowMillis),
    lastQualifiedAt: new Date(nowMillis),
  };
  return enrollment.platform === "android"
    ? Object.freeze({...base, qualification: enrollment.qualification})
    : Object.freeze({
        ...base,
        appAttestKeyId: enrollment.appAttestKeyId,
        appAttestPublicKeySpki: enrollment.appAttestPublicKeySpki,
        appId: enrollment.appId,
        environment: enrollment.environment,
        assertionCounter: existing?.appAttestKeyId === enrollment.appAttestKeyId
          ? Math.max(existing.assertionCounter ?? 0, enrollment.initialAssertionCounter)
          : enrollment.initialAssertionCounter,
        enrollmentIssuedAt: new Date(challenge.issuedAtMillis),
        enrollmentChallengeId: challenge.challengeId,
      });
}

function checkedChallengeBinding(
  stored: CustomerBiteSaverStoredChallenge,
  expected: CustomerBiteSaverDeviceUseChallenge,
  nowMillis: number,
): void {
  if (stored.challenge.challengeId !== expected.challengeId ||
    stored.challenge.platform !== expected.platform ||
    stored.challenge.requestFingerprint !== expected.requestFingerprint ||
    stored.challenge.authenticatedUserId !== expected.authenticatedUserId ||
    stored.challenge.origin !== expected.origin ||
    stored.challenge.logicalRequestId !== expected.logicalRequestId ||
    stored.challenge.challengeBytes !== expected.challengeBytes ||
    stored.challenge.issuedAtMillis !== expected.issuedAtMillis ||
    stored.challenge.validFromMillis !== expected.validFromMillis ||
    stored.challenge.expiresAtMillis !== expected.expiresAtMillis ||
    nowMillis < stored.challenge.validFromMillis ||
    nowMillis >= stored.challenge.expiresAtMillis
  ) {
    return rejectedProof();
  }
}

async function transactionInstallation(
  transaction: CustomerBiteSaverTransaction,
  value: {
    rootKey: CustomerBiteSaverDeviceRootKeyV1;
    platform: CustomerBiteSaverDevicePlatform;
    credentialId: string;
  },
): Promise<{path: string; installation: CustomerBiteSaverStoredInstallation | null}> {
  const path = customerBiteSaverInstallationPath(value);
  return {
    path,
    installation: installationFromDocument(
      await transaction.getDocument(path),
      path,
      value.platform,
      value.credentialId,
    ),
  };
}

export async function commitCustomerBiteSaverVerifiedDeviceProof(value: {
  database: CustomerBiteSaverSearchDatabase;
  rootKey: CustomerBiteSaverDeviceRootKeyV1;
  challenge: CustomerBiteSaverDeviceUseChallenge;
  proofDigest: string;
  credentialId: string;
  deviceRef: string;
  now: () => number;
  providerValidUntilMillis?: number;
  enrollment?: CustomerBiteSaverInstallationEnrollment;
  iosAssertionCounter?: number;
  iosAppAttestKeyId?: string;
}): Promise<CustomerBiteSaverVerifiedProofCommit> {
  const challenge = parseCustomerBiteSaverDeviceUseChallenge(value.challenge);
  if (!/^[0-9a-f]{64}$/u.test(value.proofDigest) ||
    !/^bsic_[A-Za-z0-9_-]{43}$/u.test(value.credentialId) ||
    !/^bsd_[A-Za-z0-9_-]{43}$/u.test(value.deviceRef) ||
    typeof value.now !== "function" ||
    (value.providerValidUntilMillis !== undefined &&
      (!Number.isSafeInteger(value.providerValidUntilMillis) ||
        value.providerValidUntilMillis < 0)) ||
    (value.enrollment !== undefined &&
      (value.enrollment.platform !== challenge.platform ||
        value.enrollment.credentialId !== value.credentialId ||
        value.enrollment.deviceRef !== value.deviceRef)) ||
    (value.iosAssertionCounter !== undefined &&
      (!Number.isSafeInteger(value.iosAssertionCounter) ||
        value.iosAssertionCounter < 0 || value.iosAssertionCounter > 0xffffffff))
  ) {
    return invalidState();
  }
  const transactionTime = (): number => {
    let nowMillis: number;
    try {
      nowMillis = value.now();
    } catch {
      return invalidState();
    }
    if (!Number.isSafeInteger(nowMillis) || nowMillis < 0) {
      return invalidState();
    }
    if (value.providerValidUntilMillis !== undefined &&
      nowMillis >= value.providerValidUntilMillis
    ) {
      return rejectedProof();
    }
    return nowMillis;
  };
  return value.database.runTransaction(async (transaction) => {
    const path = challengePath(challenge.challengeId);
    const challengeDocument = await transaction.getDocument(path);
    const stored = challengeFromDocument(
      challengeDocument,
      challenge.challengeId,
    );
    if (stored.state === "verified") {
      checkedChallengeBinding(stored, challenge, transactionTime());
      if (stored.proofDigest !== value.proofDigest ||
        stored.credentialId !== value.credentialId ||
        stored.deviceRef !== value.deviceRef
      ) {
        return rejectedProof();
      }
      return Object.freeze({
        replayed: true,
        deviceRef: value.deviceRef,
        validFromMillis: challenge.validFromMillis,
        validUntilMillis: challenge.expiresAtMillis,
      });
    }

    const installationState = await transactionInstallation(transaction, {
      rootKey: value.rootKey,
      platform: challenge.platform,
      credentialId: value.credentialId,
    });
    const committedAtMillis = transactionTime();
    checkedChallengeBinding(stored, challenge, committedAtMillis);
    if (value.enrollment !== undefined) {
      transaction.setDocument(
        installationState.path,
        enrollmentDocument(
          value.enrollment,
          installationState.installation,
          committedAtMillis,
          stored.challenge,
        ),
      );
    } else {
      const installation = installationState.installation;
      if (installation === null || installation.deviceRef !== value.deviceRef) {
        return rejectedProof();
      }
      if (challenge.platform === "ios") {
        if (value.iosAssertionCounter === undefined ||
          value.iosAppAttestKeyId === undefined ||
          installation.platform !== "ios" ||
          installation.appAttestKeyId !== value.iosAppAttestKeyId ||
          installation.assertionCounter === null ||
          installation.enrollmentIssuedAtMillis === null ||
          installation.enrollmentChallengeId === null ||
          value.iosAssertionCounter <= installation.assertionCounter
        ) {
          return rejectedProof();
        }
        transaction.setDocument(installationState.path, Object.freeze({
          protocolVersion: installation.protocolVersion,
          schemaVersion: installation.schemaVersion,
          role: installation.role,
          platform: "ios",
          credentialId: installation.credentialId,
          deviceRef: installation.deviceRef,
          credentialPublicKey: installation.credentialPublicKey,
          credentialPublicKeySha256: installation.credentialPublicKeySha256,
          appAttestKeyId: installation.appAttestKeyId,
          appAttestPublicKeySpki: installation.appAttestPublicKeySpki,
          appId: installation.appId,
          environment: installation.environment,
          assertionCounter: value.iosAssertionCounter,
          enrollmentIssuedAt: new Date(installation.enrollmentIssuedAtMillis),
          enrollmentChallengeId: installation.enrollmentChallengeId,
          createdAt: new Date(installation.createdAtMillis),
          updatedAt: new Date(committedAtMillis),
          lastQualifiedAt: new Date(installation.lastQualifiedAtMillis),
        }));
      } else if (value.iosAssertionCounter !== undefined ||
        value.iosAppAttestKeyId !== undefined
      ) {
        return invalidState();
      }
    }

    const issuedData = challengeDocument?.data;
    if (issuedData === undefined) return invalidState();
    const verifiedDocument: CustomerBiteSaverVerifiedChallengeDocument =
      Object.freeze({
        ...(issuedData as unknown as CustomerBiteSaverIssuedChallengeDocument),
        state: "verified",
        proofDigest: value.proofDigest,
        credentialId: value.credentialId,
        deviceRef: value.deviceRef,
        verifiedAt: new Date(committedAtMillis),
      });
    transaction.setDocument(path, verifiedDocument);
    return Object.freeze({
      replayed: false,
      deviceRef: value.deviceRef,
      validFromMillis: challenge.validFromMillis,
      validUntilMillis: challenge.expiresAtMillis,
    });
  });
}

export const customerBiteSaverDeviceProofStoreInternals = Object.freeze({
  challengeFromDocument,
  challengePath,
  installationFromDocument,
});
