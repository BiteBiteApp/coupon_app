import { auth, playintegrity, type playintegrity_v1 } from
  "@googleapis/playintegrity";
import type { CustomerBiteSaverAndroidQualification } from
  "./customer_bitesaver_device_proof_store.js";
import { CustomerBiteSaverContractError } from
  "./customer_bitesaver_search_contract.js";

export const customerBiteSaverAndroidPackageName =
  "com.colesmart.bitestar" as const;

export type CustomerBiteSaverPlayIntegrityPolicy = Readonly<{
  packageName: typeof customerBiteSaverAndroidPackageName;
  allowedVersionCodes: ReadonlySet<string>;
  allowedCertificateSha256Digests: ReadonlySet<string>;
  requiredDeviceRecognitionVerdicts: ReadonlySet<string>;
  requiredLicensingVerdict?: "LICENSED";
  maximumTokenAgeMilliseconds?: number;
  maximumFutureSkewMilliseconds?: number;
  allowTestingResponses?: boolean;
}>;

export type CustomerBiteSaverPlayIntegrityDecoder = Readonly<{
  decode(packageName: string, integrityToken: string): Promise<unknown>;
}>;

export type CustomerBiteSaverPlayIntegrityVerification = Readonly<{
  qualification: CustomerBiteSaverAndroidQualification;
  requestTimeMillis: number;
  validUntilMillis: number;
}>;

const tokenPayloadKeys = new Set([
  "accountDetails",
  "appIntegrity",
  "deviceIntegrity",
  "environmentDetails",
  "requestDetails",
  "testingDetails",
]);
const requestDetailsKeys = new Set([
  "nonce",
  "requestHash",
  "requestPackageName",
  "timestampMillis",
]);
const appIntegrityKeys = new Set([
  "appRecognitionVerdict",
  "certificateSha256Digest",
  "packageName",
  "versionCode",
]);
const deviceIntegrityKeys = new Set([
  "deviceAttributes",
  "deviceRecall",
  "deviceRecognitionVerdict",
  "legacyDeviceRecognitionVerdict",
  "recentDeviceActivity",
]);
const accountDetailsKeys = new Set(["accountActivity", "appLicensingVerdict"]);
const testingDetailsKeys = new Set(["isTestingResponse"]);
const recognizedDeviceVerdicts = new Set([
  "MEETS_BASIC_INTEGRITY",
  "MEETS_DEVICE_INTEGRITY",
  "MEETS_STRONG_INTEGRITY",
  "MEETS_VIRTUAL_INTEGRITY",
]);
const recognizedLicensingVerdicts = new Set([
  "LICENSED",
  "UNLICENSED",
  "UNEVALUATED",
]);

function rejected(): never {
  throw new CustomerBiteSaverContractError(
    "permission-denied",
    "Android device proof was rejected.",
  );
}

function unavailable(): never {
  throw new CustomerBiteSaverContractError(
    "unavailable",
    "Android device verification is temporarily unavailable.",
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function stringArray(value: unknown, maximum: number): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0 ||
      entry.length > 256)
  ) {
    return null;
  }
  return Object.freeze([...value]) as readonly string[];
}

function exactSetContainsAll(
  actual: readonly string[],
  required: ReadonlySet<string>,
): boolean {
  const values = new Set(actual);
  return values.size === actual.length &&
    [...required].every((entry) => values.has(entry));
}

function normalizedPolicy(
  policy: CustomerBiteSaverPlayIntegrityPolicy,
): Required<Omit<CustomerBiteSaverPlayIntegrityPolicy,
  "requiredLicensingVerdict">> &
  Pick<CustomerBiteSaverPlayIntegrityPolicy, "requiredLicensingVerdict"> {
  const maximumTokenAgeMilliseconds =
    policy.maximumTokenAgeMilliseconds ?? 120_000;
  const maximumFutureSkewMilliseconds =
    policy.maximumFutureSkewMilliseconds ?? 10_000;
  if (policy.packageName !== customerBiteSaverAndroidPackageName ||
    !(policy.allowedVersionCodes instanceof Set) ||
    policy.allowedVersionCodes.size === 0 ||
    !(policy.allowedCertificateSha256Digests instanceof Set) ||
    policy.allowedCertificateSha256Digests.size === 0 ||
    !(policy.requiredDeviceRecognitionVerdicts instanceof Set) ||
    policy.requiredDeviceRecognitionVerdicts.size === 0 ||
    [...policy.allowedVersionCodes].some((value) => !/^[0-9]{1,20}$/u.test(value)) ||
    [...policy.allowedCertificateSha256Digests].some((value) =>
      !/^[A-Za-z0-9_-]{43}$/u.test(value)) ||
    [...policy.requiredDeviceRecognitionVerdicts].some((value) =>
      !recognizedDeviceVerdicts.has(value)) ||
    !Number.isSafeInteger(maximumTokenAgeMilliseconds) ||
    maximumTokenAgeMilliseconds <= 0 || maximumTokenAgeMilliseconds > 600_000 ||
    !Number.isSafeInteger(maximumFutureSkewMilliseconds) ||
    maximumFutureSkewMilliseconds < 0 || maximumFutureSkewMilliseconds > 60_000
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "Android device verification policy is invalid.",
    );
  }
  return Object.freeze({
    ...policy,
    maximumTokenAgeMilliseconds,
    maximumFutureSkewMilliseconds,
    allowTestingResponses: policy.allowTestingResponses ?? false,
  });
}

export class CustomerBiteSaverPlayIntegrityVerifier {
  readonly #decoder: CustomerBiteSaverPlayIntegrityDecoder;
  readonly #policy: ReturnType<typeof normalizedPolicy>;

  constructor(options: Readonly<{
    decoder: CustomerBiteSaverPlayIntegrityDecoder;
    policy: CustomerBiteSaverPlayIntegrityPolicy;
  }>) {
    this.#decoder = options.decoder;
    this.#policy = normalizedPolicy(options.policy);
  }

  async verify(input: Readonly<{
    integrityToken: string;
    expectedRequestHash: string;
    nowMillis: number;
  }>): Promise<CustomerBiteSaverPlayIntegrityVerification> {
    if (typeof input.integrityToken !== "string" ||
      input.integrityToken.length === 0 || input.integrityToken.length > 32_768 ||
      !/^[A-Za-z0-9._~-]+$/u.test(input.integrityToken) ||
      typeof input.expectedRequestHash !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(input.expectedRequestHash) ||
      !Number.isSafeInteger(input.nowMillis) || input.nowMillis < 0
    ) {
      return rejected();
    }
    let raw: unknown;
    try {
      raw = await this.#decoder.decode(
        this.#policy.packageName,
        input.integrityToken,
      );
    } catch {
      return unavailable();
    }
    if (!isPlainRecord(raw) || !hasOnlyKeys(raw, new Set(["tokenPayloadExternal"])) ||
      !isPlainRecord(raw.tokenPayloadExternal) ||
      !hasOnlyKeys(raw.tokenPayloadExternal, tokenPayloadKeys)
    ) {
      return rejected();
    }
    const payload = raw.tokenPayloadExternal;
    if (!isPlainRecord(payload.requestDetails) ||
      !hasOnlyKeys(payload.requestDetails, requestDetailsKeys) ||
      payload.requestDetails.nonce !== undefined &&
        payload.requestDetails.nonce !== null ||
      payload.requestDetails.requestHash !== input.expectedRequestHash ||
      payload.requestDetails.requestPackageName !== this.#policy.packageName ||
      typeof payload.requestDetails.timestampMillis !== "string" ||
      !/^[0-9]{1,16}$/u.test(payload.requestDetails.timestampMillis)
    ) {
      return rejected();
    }
    const tokenTime = Number(payload.requestDetails.timestampMillis);
    if (!Number.isSafeInteger(tokenTime) || tokenTime < 0 ||
      tokenTime > input.nowMillis + this.#policy.maximumFutureSkewMilliseconds ||
      input.nowMillis - tokenTime > this.#policy.maximumTokenAgeMilliseconds
    ) {
      return rejected();
    }

    if (!isPlainRecord(payload.appIntegrity) ||
      !hasOnlyKeys(payload.appIntegrity, appIntegrityKeys) ||
      payload.appIntegrity.appRecognitionVerdict !== "PLAY_RECOGNIZED" ||
      payload.appIntegrity.packageName !== this.#policy.packageName ||
      typeof payload.appIntegrity.versionCode !== "string" ||
      !this.#policy.allowedVersionCodes.has(payload.appIntegrity.versionCode)
    ) {
      return rejected();
    }
    const certificates = stringArray(
      payload.appIntegrity.certificateSha256Digest,
      8,
    );
    if (certificates === null || certificates.some((digest) =>
      !/^[A-Za-z0-9_-]{43}$/u.test(digest)) ||
      certificates.some((digest) =>
        !this.#policy.allowedCertificateSha256Digests.has(digest))
    ) {
      return rejected();
    }

    if (!isPlainRecord(payload.deviceIntegrity) ||
      !hasOnlyKeys(payload.deviceIntegrity, deviceIntegrityKeys)
    ) {
      return rejected();
    }
    const deviceVerdicts = stringArray(
      payload.deviceIntegrity.deviceRecognitionVerdict,
      8,
    );
    if (deviceVerdicts === null ||
      deviceVerdicts.some((verdict) => !recognizedDeviceVerdicts.has(verdict)) ||
      !exactSetContainsAll(
        deviceVerdicts,
        this.#policy.requiredDeviceRecognitionVerdicts,
      )
    ) {
      return rejected();
    }

    if (!isPlainRecord(payload.accountDetails) ||
      !hasOnlyKeys(payload.accountDetails, accountDetailsKeys) ||
      typeof payload.accountDetails.appLicensingVerdict !== "string" ||
      !recognizedLicensingVerdicts.has(
        payload.accountDetails.appLicensingVerdict,
      ) ||
      (this.#policy.requiredLicensingVerdict !== undefined &&
        payload.accountDetails.appLicensingVerdict !==
          this.#policy.requiredLicensingVerdict)
    ) {
      return rejected();
    }
    if (payload.testingDetails !== undefined && payload.testingDetails !== null) {
      if (!isPlainRecord(payload.testingDetails) ||
        !hasOnlyKeys(payload.testingDetails, testingDetailsKeys) ||
        typeof payload.testingDetails.isTestingResponse !== "boolean" ||
        (payload.testingDetails.isTestingResponse &&
          !this.#policy.allowTestingResponses)
      ) {
        return rejected();
      }
    }
    return Object.freeze({
      qualification: Object.freeze({
        packageName: this.#policy.packageName,
        versionCode: payload.appIntegrity.versionCode,
        certificateSha256Digests: certificates,
        appRecognitionVerdict: "PLAY_RECOGNIZED",
        deviceRecognitionVerdicts: deviceVerdicts,
        licensingVerdict: payload.accountDetails.appLicensingVerdict,
      }),
      requestTimeMillis: tokenTime,
      validUntilMillis: tokenTime + this.#policy.maximumTokenAgeMilliseconds,
    });
  }
}

export function createGoogleCustomerBiteSaverPlayIntegrityDecoder():
CustomerBiteSaverPlayIntegrityDecoder {
  // The declared API dependency exposes ADC; lookup remains lazy until decode.
  const authentication = new auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/playintegrity"],
  });
  const client = playintegrity({version: "v1", auth: authentication});
  return Object.freeze({
    async decode(packageName: string, integrityToken: string): Promise<unknown> {
      const response = await client.v1.decodeIntegrityToken({
        packageName,
        requestBody: {integrityToken},
      });
      return response.data;
    },
  });
}

export type CustomerBiteSaverPlayIntegrityPayload =
  playintegrity_v1.Schema$DecodeIntegrityTokenResponse;
