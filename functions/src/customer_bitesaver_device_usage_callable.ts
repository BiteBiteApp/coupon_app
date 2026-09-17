import {
  parseCustomerBiteSaverIssueDeviceChallengeRequest,
  parseCustomerBiteSaverUseCouponWithDeviceProofRequest,
  type CustomerBiteSaverDeviceUseChallenge,
} from "./customer_bitesaver_device_proof_contract.js";
import {
  createCustomerBiteSaverRequestDeviceEvidenceVerifier,
  type CustomerBiteSaverDeviceEvidenceVerifierDependencies,
} from "./customer_bitesaver_device_evidence_verifier.js";
import { issueCustomerBiteSaverDeviceUseChallenge } from
  "./customer_bitesaver_device_proof_store.js";
import {
  customerBiteSaverSignedUserId,
  parseCustomerBiteSaverCombinedUseRequest,
  type CustomerBiteSaverDeviceUseContext,
  type CustomerBiteSaverDeviceUseResult,
} from "./customer_bitesaver_device_usage_core.js";
import { handleCustomerBiteSaverDeviceBoundUse } from
  "./customer_bitesaver_device_usage_handler.js";
import type { CustomerBiteSaverIdentityKeyV1 } from
  "./customer_bitesaver_public_identity.js";

export const issueCustomerBiteSaverDeviceUseChallengeCallableName =
  "issueCustomerBiteSaverDeviceUseChallenge" as const;
export const useCustomerBiteSaverCouponCallableName =
  "useCustomerBiteSaverCoupon" as const;

export type CustomerBiteSaverFutureCallableActor = Readonly<{
  uid: string | null;
  isAnonymous: boolean;
}>;

export type CustomerBiteSaverDeviceUsageCallableDependencies =
  Omit<CustomerBiteSaverDeviceEvidenceVerifierDependencies, "now"> & Readonly<{
    discoveryKey: Uint8Array;
    identityKeyV1?: CustomerBiteSaverIdentityKeyV1;
    now?: () => number;
    randomSource?: (size: number) => Uint8Array;
  }>;

function identity(actor: CustomerBiteSaverFutureCallableActor):
CustomerBiteSaverDeviceUseContext["identity"] {
  return Object.freeze({
    authUid: actor.uid,
    authIsAnonymous: actor.isAnonymous,
  });
}

export function createIssueCustomerBiteSaverDeviceUseChallengeHandler(
  dependencies: CustomerBiteSaverDeviceUsageCallableDependencies,
): (
  rawRequest: unknown,
  actor: CustomerBiteSaverFutureCallableActor,
) => Promise<CustomerBiteSaverDeviceUseChallenge> {
  return async (rawRequest, actor) => {
    const request = parseCustomerBiteSaverIssueDeviceChallengeRequest(
      rawRequest,
      parseCustomerBiteSaverCombinedUseRequest,
    );
    const operationIdentity = identity(actor);
    const authenticatedUserId = customerBiteSaverSignedUserId(
      operationIdentity,
    );
    const trustedNow = dependencies.now ?? Date.now;
    return issueCustomerBiteSaverDeviceUseChallenge({
      database: dependencies.database,
      platform: request.platform,
      request: request.request,
      authenticatedUserId,
      nowMillis: trustedNow(),
      ...(dependencies.randomSource === undefined ? {} : {
        randomSource: dependencies.randomSource,
      }),
    });
  };
}

export function createUseCustomerBiteSaverCouponHandler(
  dependencies: CustomerBiteSaverDeviceUsageCallableDependencies,
): (
  rawRequest: unknown,
  actor: CustomerBiteSaverFutureCallableActor,
) => Promise<CustomerBiteSaverDeviceUseResult> {
  return async (rawRequest, actor) => {
    const request = parseCustomerBiteSaverUseCouponWithDeviceProofRequest(
      rawRequest,
      parseCustomerBiteSaverCombinedUseRequest,
    );
    const trustedNow = dependencies.now ?? Date.now;
    const verifierDependencies: CustomerBiteSaverDeviceEvidenceVerifierDependencies =
      Object.freeze({...dependencies, now: trustedNow});
    return handleCustomerBiteSaverDeviceBoundUse(request.request, {
      database: dependencies.database,
      discoveryKey: dependencies.discoveryKey,
      ...(dependencies.identityKeyV1 === undefined ? {} : {
        identityKeyV1: dependencies.identityKeyV1,
      }),
      identity: identity(actor),
      deviceEvidenceVerifier: createCustomerBiteSaverRequestDeviceEvidenceVerifier({
        dependencies: verifierDependencies,
        challengeId: request.challengeId,
        proof: request.proof,
      }),
      now: trustedNow,
      ...(dependencies.randomSource === undefined ? {} : {
        randomSource: dependencies.randomSource,
      }),
    });
  };
}
