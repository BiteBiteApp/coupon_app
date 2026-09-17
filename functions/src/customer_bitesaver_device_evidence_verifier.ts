import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import {
  buildCustomerBiteSaverDeviceProofTranscript,
  customerBiteSaverCredentialId,
  customerBiteSaverDeviceProofDigest,
  customerBiteSaverDeviceProofTranscriptSha256,
  customerBiteSaverIosAssertionClientDataHash,
  decodeCustomerBiteSaverBase64Url,
  encodeCustomerBiteSaverDeviceProofTranscript,
  type CustomerBiteSaverDeviceProof,
} from "./customer_bitesaver_device_proof_contract.js";
import {
  commitCustomerBiteSaverVerifiedDeviceProof,
  loadCustomerBiteSaverDeviceChallenge,
  loadCustomerBiteSaverDeviceInstallation,
  type CustomerBiteSaverInstallationEnrollment,
  type CustomerBiteSaverStoredChallenge,
  type CustomerBiteSaverStoredInstallation,
} from "./customer_bitesaver_device_proof_store.js";
import {
  deriveCustomerBiteSaverAndroidDeviceRef,
  deriveCustomerBiteSaverIosDeviceRef,
  type CustomerBiteSaverDeviceRootKeyV1,
} from "./customer_bitesaver_device_identity.js";
import type {
  CustomerBiteSaverDeviceEvidenceVerifier,
  CustomerBiteSaverVerifiedDeviceEvidence,
} from "./customer_bitesaver_device_usage_core.js";
import { customerBiteSaverDeviceUsePurpose } from
  "./customer_bitesaver_device_usage_core.js";
import type { CustomerBiteSaverSearchDatabase } from
  "./customer_bitesaver_search_store.js";
import { CustomerBiteSaverContractError } from
  "./customer_bitesaver_search_contract.js";
import type { CustomerBiteSaverPlayIntegrityVerifier } from
  "./customer_bitesaver_play_integrity.js";
import type { CustomerBiteSaverAppAttestVerifier } from
  "./customer_bitesaver_app_attest.js";

export type CustomerBiteSaverDeviceEvidenceVerifierDependencies = Readonly<{
  database: CustomerBiteSaverSearchDatabase;
  rootKey: CustomerBiteSaverDeviceRootKeyV1;
  playIntegrityVerifier: CustomerBiteSaverPlayIntegrityVerifier;
  appAttestVerifier: CustomerBiteSaverAppAttestVerifier;
  now: () => number;
}>;

function rejected(): never {
  throw new CustomerBiteSaverContractError(
    "permission-denied",
    "BiteSaver device proof was rejected.",
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function requireP256Spki(value: Uint8Array): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey({
      key: Buffer.from(value),
      format: "der",
      type: "spki",
    });
  } catch {
    return rejected();
  }
  if (key.asymmetricKeyType !== "ec" ||
    key.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
    !equalBytes(
      key.export({format: "der", type: "spki"}),
      value,
    )
  ) {
    return rejected();
  }
  return key;
}

function p256X963Key(value: Uint8Array): KeyObject {
  if (!(value instanceof Uint8Array) || value.length !== 65 || value[0] !== 4) {
    return rejected();
  }
  try {
    const key = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: Buffer.from(value.subarray(1, 33)).toString("base64url"),
        y: Buffer.from(value.subarray(33, 65)).toString("base64url"),
      },
      format: "jwk",
    });
    if (key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      return rejected();
    }
    return key;
  } catch {
    return rejected();
  }
}

function verifyPossession(
  publicKey: KeyObject,
  transcript: Uint8Array,
  signature: Uint8Array,
): void {
  try {
    if (!verifySignature(
      "sha256",
      Buffer.from(transcript),
      publicKey,
      Buffer.from(signature),
    )) {
      return rejected();
    }
  } catch {
    return rejected();
  }
}

function proofPlatform(proof: CustomerBiteSaverDeviceProof): "android" | "ios" {
  return proof.kind === "androidEnrollment" || proof.kind === "androidUse"
    ? "android"
    : "ios";
}

function exactVerifiedReplay(value: {
  stored: CustomerBiteSaverStoredChallenge;
  proofDigest: string;
  credentialId: string;
}): string | null {
  if (value.stored.state !== "verified") return null;
  if (value.stored.proofDigest !== value.proofDigest ||
    value.stored.credentialId !== value.credentialId ||
    value.stored.deviceRef === null
  ) {
    return rejected();
  }
  return value.stored.deviceRef;
}

function checkedInstallation(
  installation: CustomerBiteSaverStoredInstallation | null,
  platform: "android" | "ios",
  credentialId: string,
): CustomerBiteSaverStoredInstallation {
  if (installation === null || installation.platform !== platform ||
    installation.credentialId !== credentialId
  ) {
    return rejected();
  }
  return installation;
}

function evidence(value: {
  deviceRef: string;
  requestFingerprint: string;
  authenticatedUserId: string | null;
  validFromMillis: number;
  validUntilMillis: number;
}): CustomerBiteSaverVerifiedDeviceEvidence {
  return Object.freeze({
    state: "verified",
    deviceSubject: value.deviceRef,
    requestFingerprint: value.requestFingerprint,
    authenticatedUserId: value.authenticatedUserId,
    validFromMillis: value.validFromMillis,
    validUntilMillis: value.validUntilMillis,
  });
}

export function createCustomerBiteSaverRequestDeviceEvidenceVerifier(value: {
  dependencies: CustomerBiteSaverDeviceEvidenceVerifierDependencies;
  challengeId: string;
  proof: CustomerBiteSaverDeviceProof;
}): CustomerBiteSaverDeviceEvidenceVerifier {
  let consumed = false;
  return Object.freeze({
    async verify(
      input: Parameters<CustomerBiteSaverDeviceEvidenceVerifier["verify"]>[0],
    ) {
      if (consumed) return rejected();
      consumed = true;
      if (input.purpose !== customerBiteSaverDeviceUsePurpose ||
        !Number.isSafeInteger(input.nowMillis) || input.nowMillis < 0
      ) {
        return rejected();
      }
      const dependencies = value.dependencies;
      const verificationStartedAtMillis = dependencies.now();
      if (!Number.isSafeInteger(verificationStartedAtMillis) ||
        verificationStartedAtMillis < 0
      ) {
        throw new CustomerBiteSaverContractError(
          "failed-precondition",
          "BiteSaver device verification clock is invalid.",
        );
      }
      const proof = value.proof;
      const proofDigest = customerBiteSaverDeviceProofDigest(proof);
      const stored = await loadCustomerBiteSaverDeviceChallenge({
        database: dependencies.database,
        challengeId: value.challengeId,
        nowMillis: verificationStartedAtMillis,
      });
      const challenge = stored.challenge;
      if (challenge.purpose !== input.purpose ||
        challenge.requestFingerprint !== input.requestFingerprint ||
        challenge.authenticatedUserId !== input.authenticatedUserId ||
        challenge.origin !== input.origin ||
        challenge.platform !== proofPlatform(proof)
      ) {
        return rejected();
      }
      const replayDeviceRef = exactVerifiedReplay({
        stored,
        proofDigest,
        credentialId: proof.credentialId,
      });
      if (replayDeviceRef !== null) {
        const committedAtMillis = dependencies.now();
        if (!Number.isSafeInteger(committedAtMillis) ||
          committedAtMillis < verificationStartedAtMillis ||
          committedAtMillis >= challenge.expiresAtMillis
        ) {
          return rejected();
        }
        const committed = await commitCustomerBiteSaverVerifiedDeviceProof({
          database: dependencies.database,
          rootKey: dependencies.rootKey,
          challenge,
          proofDigest,
          credentialId: proof.credentialId,
          deviceRef: replayDeviceRef,
          now: dependencies.now,
        });
        return evidence({
          deviceRef: committed.deviceRef,
          requestFingerprint: input.requestFingerprint,
          authenticatedUserId: input.authenticatedUserId,
          validFromMillis: committed.validFromMillis,
          validUntilMillis: committed.validUntilMillis,
        });
      }

      let deviceRef: string;
      let enrollment: CustomerBiteSaverInstallationEnrollment | undefined;
      let iosAssertionCounter: number | undefined;
      let iosAppAttestKeyId: string | undefined;
      let providerValidUntilMillis: number | undefined;
      // An awaited store read may outlive the challenge. Fence each provider
      // boundary with fresh trusted time, retaining the later commit fences.
      const providerVerificationTime = (): number => {
        const nowMillis = dependencies.now();
        if (!Number.isSafeInteger(nowMillis) ||
          nowMillis < verificationStartedAtMillis ||
          nowMillis < challenge.validFromMillis ||
          nowMillis >= challenge.expiresAtMillis
        ) return rejected();
        return nowMillis;
      };
      if (proof.kind === "androidEnrollment") {
        const publicKeyDer = decodeCustomerBiteSaverBase64Url(
          proof.installationPublicKeySpki,
          80,
          160,
        );
        const publicKey = requireP256Spki(publicKeyDer);
        const publicKeyHash = createHash("sha256").update(publicKeyDer).digest();
        if (customerBiteSaverCredentialId("android", publicKeyHash) !==
          proof.credentialId
        ) {
          return rejected();
        }
        const transcript = buildCustomerBiteSaverDeviceProofTranscript({
          challenge,
          proofKind: proof.kind,
          credentialId: proof.credentialId,
          androidInstallationPublicKeySha256: publicKeyHash,
          androidSsaid: proof.androidSsaid,
        });
        const transcriptBytes = encodeCustomerBiteSaverDeviceProofTranscript(
          transcript,
        );
        verifyPossession(
          publicKey,
          transcriptBytes,
          decodeCustomerBiteSaverBase64Url(proof.possessionSignature, 64, 80),
        );
        const integrity = await dependencies.playIntegrityVerifier.verify({
          integrityToken: proof.integrityToken,
          expectedRequestHash:
            customerBiteSaverDeviceProofTranscriptSha256(transcript)
              .toString("base64url"),
          nowMillis: providerVerificationTime(),
        });
        providerValidUntilMillis = integrity.validUntilMillis;
        deviceRef = deriveCustomerBiteSaverAndroidDeviceRef({
          rootKey: dependencies.rootKey,
          androidSsaid: proof.androidSsaid,
        });
        enrollment = Object.freeze({
          platform: "android",
          credentialId: proof.credentialId,
          deviceRef,
          credentialPublicKey: publicKeyDer.toString("base64url"),
          credentialPublicKeySha256: publicKeyHash.toString("hex"),
          qualification: integrity.qualification,
        });
      } else if (proof.kind === "androidUse") {
        const installation = checkedInstallation(
          await loadCustomerBiteSaverDeviceInstallation({
            database: dependencies.database,
            rootKey: dependencies.rootKey,
            platform: "android",
            credentialId: proof.credentialId,
          }),
          "android",
          proof.credentialId,
        );
        const publicKeyDer = decodeCustomerBiteSaverBase64Url(
          installation.credentialPublicKey,
          80,
          160,
        );
        const publicKeyHash = Buffer.from(
          installation.credentialPublicKeySha256,
          "hex",
        );
        if (!equalBytes(
          createHash("sha256").update(publicKeyDer).digest(),
          publicKeyHash,
        ) || customerBiteSaverCredentialId("android", publicKeyHash) !==
          proof.credentialId
        ) {
          return rejected();
        }
        const transcript = buildCustomerBiteSaverDeviceProofTranscript({
          challenge,
          proofKind: proof.kind,
          credentialId: proof.credentialId,
          androidInstallationPublicKeySha256: publicKeyHash,
        });
        verifyPossession(
          requireP256Spki(publicKeyDer),
          encodeCustomerBiteSaverDeviceProofTranscript(transcript),
          decodeCustomerBiteSaverBase64Url(proof.possessionSignature, 64, 80),
        );
        deviceRef = installation.deviceRef;
      } else if (proof.kind === "iosEnrollment") {
        const recoveryKeyX963 = decodeCustomerBiteSaverBase64Url(
          proof.recoveryPublicKeyX963,
          65,
          65,
        );
        const recoveryKeyHash = createHash("sha256").update(recoveryKeyX963)
          .digest();
        if (customerBiteSaverCredentialId("ios", recoveryKeyHash) !==
          proof.credentialId
        ) {
          return rejected();
        }
        const transcript = buildCustomerBiteSaverDeviceProofTranscript({
          challenge,
          proofKind: proof.kind,
          credentialId: proof.credentialId,
          iosRecoveryPublicKeyX963: recoveryKeyX963,
          iosAppAttestKeyId: proof.appAttestKeyId,
        });
        const transcriptBytes = encodeCustomerBiteSaverDeviceProofTranscript(
          transcript,
        );
        verifyPossession(
          p256X963Key(recoveryKeyX963),
          transcriptBytes,
          decodeCustomerBiteSaverBase64Url(proof.possessionSignature, 64, 80),
        );
        const attestation = dependencies.appAttestVerifier.verifyAttestation({
          attestationObject: decodeCustomerBiteSaverBase64Url(
            proof.attestationObject,
            1,
            65_536,
          ),
          appAttestKeyId: proof.appAttestKeyId,
          clientDataHash:
            customerBiteSaverDeviceProofTranscriptSha256(transcript),
          nowMillis: providerVerificationTime(),
        });
        deviceRef = deriveCustomerBiteSaverIosDeviceRef({
          rootKey: dependencies.rootKey,
          recoveryPublicKeyX963: recoveryKeyX963,
        });
        enrollment = Object.freeze({
          platform: "ios",
          credentialId: proof.credentialId,
          deviceRef,
          credentialPublicKey: recoveryKeyX963.toString("base64url"),
          credentialPublicKeySha256: recoveryKeyHash.toString("hex"),
          appAttestKeyId: proof.appAttestKeyId,
          appAttestPublicKeySpki: attestation.appAttestPublicKeySpki,
          appId: attestation.appId,
          environment: attestation.environment,
          initialAssertionCounter: attestation.initialAssertionCounter,
        });
      } else {
        const installation = checkedInstallation(
          await loadCustomerBiteSaverDeviceInstallation({
            database: dependencies.database,
            rootKey: dependencies.rootKey,
            platform: "ios",
            credentialId: proof.credentialId,
          }),
          "ios",
          proof.credentialId,
        );
        if (installation.appAttestKeyId !== proof.appAttestKeyId ||
          installation.appAttestPublicKeySpki === null ||
          installation.appId === null || installation.environment === null ||
          installation.assertionCounter === null
        ) {
          return rejected();
        }
        const recoveryKeyX963 = decodeCustomerBiteSaverBase64Url(
          installation.credentialPublicKey,
          65,
          65,
        );
        const recoveryKeyHash = createHash("sha256").update(recoveryKeyX963)
          .digest();
        if (recoveryKeyHash.toString("hex") !==
          installation.credentialPublicKeySha256 ||
          customerBiteSaverCredentialId("ios", recoveryKeyHash) !==
            proof.credentialId
        ) {
          return rejected();
        }
        const transcript = buildCustomerBiteSaverDeviceProofTranscript({
          challenge,
          proofKind: proof.kind,
          credentialId: proof.credentialId,
          iosRecoveryPublicKeyX963: recoveryKeyX963,
          iosAppAttestKeyId: proof.appAttestKeyId,
        });
        const transcriptBytes = encodeCustomerBiteSaverDeviceProofTranscript(
          transcript,
        );
        const possessionSignature = decodeCustomerBiteSaverBase64Url(
          proof.possessionSignature,
          64,
          80,
        );
        verifyPossession(
          p256X963Key(recoveryKeyX963),
          transcriptBytes,
          possessionSignature,
        );
        providerVerificationTime();
        const assertion = dependencies.appAttestVerifier.verifyAssertion({
          assertionObject: decodeCustomerBiteSaverBase64Url(
            proof.assertionObject,
            1,
            16_384,
          ),
          clientDataHash: customerBiteSaverIosAssertionClientDataHash(
            customerBiteSaverDeviceProofTranscriptSha256(transcript),
            possessionSignature,
          ),
          appAttestPublicKeySpki: decodeCustomerBiteSaverBase64Url(
            installation.appAttestPublicKeySpki,
            80,
            160,
          ),
        });
        deviceRef = installation.deviceRef;
        iosAssertionCounter = assertion.assertionCounter;
        iosAppAttestKeyId = proof.appAttestKeyId;
      }

      const committedAtMillis = dependencies.now();
      if (!Number.isSafeInteger(committedAtMillis) || committedAtMillis < 0 ||
        committedAtMillis < verificationStartedAtMillis ||
        committedAtMillis >= challenge.expiresAtMillis ||
        (providerValidUntilMillis !== undefined &&
          committedAtMillis >= providerValidUntilMillis)
      ) {
        return rejected();
      }
      const committed = await commitCustomerBiteSaverVerifiedDeviceProof({
        database: dependencies.database,
        rootKey: dependencies.rootKey,
        challenge,
        proofDigest,
        credentialId: proof.credentialId,
        deviceRef,
        now: dependencies.now,
        ...(providerValidUntilMillis === undefined ? {} : {
          providerValidUntilMillis,
        }),
        ...(enrollment === undefined ? {} : {enrollment}),
        ...(iosAssertionCounter === undefined ? {} : {iosAssertionCounter}),
        ...(iosAppAttestKeyId === undefined ? {} : {iosAppAttestKeyId}),
      });
      return evidence({
        deviceRef: committed.deviceRef,
        requestFingerprint: input.requestFingerprint,
        authenticatedUserId: input.authenticatedUserId,
        validFromMillis: committed.validFromMillis,
        validUntilMillis: committed.validUntilMillis,
      });
    },
  });
}
