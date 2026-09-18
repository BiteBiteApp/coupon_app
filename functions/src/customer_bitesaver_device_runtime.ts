import { X509Certificate } from "node:crypto";
import {
  CustomerBiteSaverAppAttestVerifier,
  customerBiteSaverIosAppId,
} from "./customer_bitesaver_app_attest.js";
import {
  parseCustomerBiteSaverDeviceRootKeyV1,
} from "./customer_bitesaver_device_identity.js";
import {
  createUseCustomerBiteSaverCouponHandler,
  type CustomerBiteSaverDeviceUsageCallableDependencies,
} from "./customer_bitesaver_device_usage_callable.js";
import {
  createGoogleCustomerBiteSaverPlayIntegrityDecoder,
  CustomerBiteSaverPlayIntegrityVerifier,
  customerBiteSaverAndroidPackageName,
  type CustomerBiteSaverPlayIntegrityDecoder,
} from "./customer_bitesaver_play_integrity.js";
import { CustomerBiteSaverContractError } from
  "./customer_bitesaver_search_contract.js";

// Owner-verified PLAY APP-SIGNING certificate (not the upload certificate).
const playAppSigningSha256 =
  "51:F9:20:25:C3:4E:A8:F5:DB:CD:A5:01:A1:B2:C8:53:" +
  "C6:D6:B0:CB:D0:B2:6C:4C:13:A5:CD:BF:95:E4:08:49";

// Public trust material pinned 2026-09-18 from Apple's Private PKI repository:
// https://www.apple.com/certificateauthority/private/
// https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
// DER SHA-256: 1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932
// Identity/hash checked with Node 24 and OpenSSL; also verified the signature of
// Apple's published App Attestation CA 1 intermediate under this root.
// No runtime network fetch, system trust-store fallback, or test trust root.
const appleAppAttestationRootCaV1 = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

function playSigningDigest(): string {
  if (!/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/u.test(playAppSigningSha256)) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "Android device verification policy is invalid.",
    );
  }
  return Buffer.from(playAppSigningSha256.replace(/:/gu, ""), "hex")
    .toString("base64url");
}

/** Fixed production policy. Only the provider transport is injectable in tests. */
export function createProductionCustomerBiteSaverDeviceProviders(
  decoder: CustomerBiteSaverPlayIntegrityDecoder =
    createGoogleCustomerBiteSaverPlayIntegrityDecoder(),
) {
  // pubspec 1.0.0+2 -> Android versionCode 2 and iOS CFBundleVersion 2.
  // Future builds must update/review these exact allowlists before deployment.
  // Each factory invocation owns its policy sets; none are client-configurable.
  return Object.freeze({
    playIntegrityVerifier: new CustomerBiteSaverPlayIntegrityVerifier({
      decoder,
      policy: {
        packageName: customerBiteSaverAndroidPackageName,
        allowedVersionCodes: new Set(["2"]),
        allowedCertificateSha256Digests: new Set([playSigningDigest()]),
        requiredDeviceRecognitionVerdicts: new Set(["MEETS_DEVICE_INTEGRITY"]),
        maximumTokenAgeMilliseconds: 120_000,
        maximumFutureSkewMilliseconds: 10_000,
        allowTestingResponses: false,
        // LICENSED remains an owner decision; no requirement is imposed here.
      },
    }),
    appAttestVerifier: new CustomerBiteSaverAppAttestVerifier({
      appId: customerBiteSaverIosAppId,
      environment: "production",
      trustedRootCertificatesDer: [
        new X509Certificate(appleAppAttestationRootCaV1).raw,
      ],
      // Apple's validating-apps-that-connect-to-your-server guide:
      // 2 = TestFlight, 4 = App Store. Preserve reviewed optional extensions.
      allowedValidationCategories: new Set([2, 4]),
      allowedBundleVersions: new Set(["2"]),
    }),
  });
}

type ProductionUseDependencies = Omit<
  CustomerBiteSaverDeviceUsageCallableDependencies,
  "rootKey" | "playIntegrityVerifier" | "appAttestVerifier" | "identityKeyV1"
> & Required<Pick<CustomerBiteSaverDeviceUsageCallableDependencies,
  "identityKeyV1">> & Readonly<{
  encodedRootKey: string;
  playIntegrityDecoder?: CustomerBiteSaverPlayIntegrityDecoder;
}>;

/**
 * The deployed use callable must bind BITESAVER_DEVICE_ROOT_KEY_V1 and its
 * runtime identity must have access to that secret. Reverify the actual identity,
 * secret IAM and Play Integrity ADC during the later targeted deployment.
 * Never resolve secrets at module load or fall back to synthetic credentials.
 */
export function createProductionCustomerBiteSaverCouponUseHandler(
  dependencies: ProductionUseDependencies,
): ReturnType<typeof createUseCustomerBiteSaverCouponHandler> {
  const rootKey = parseCustomerBiteSaverDeviceRootKeyV1(
    dependencies.encodedRootKey,
  );
  const providers = createProductionCustomerBiteSaverDeviceProviders(
    dependencies.playIntegrityDecoder,
  );
  return createUseCustomerBiteSaverCouponHandler({
    database: dependencies.database,
    discoveryKey: dependencies.discoveryKey,
    identityKeyV1: dependencies.identityKeyV1,
    rootKey,
    ...providers,
    ...(dependencies.now === undefined ? {} : {now: dependencies.now}),
    ...(dependencies.randomSource === undefined ? {} : {
      randomSource: dependencies.randomSource,
    }),
  });
}
