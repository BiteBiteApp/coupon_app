import { createHmac } from "node:crypto";
import {
  customerBiteSaverDeviceProofProtocolVersion,
  type CustomerBiteSaverDevicePlatform,
} from "./customer_bitesaver_device_proof_contract.js";
import { CustomerBiteSaverContractError } from
  "./customer_bitesaver_search_contract.js";

export const customerBiteSaverDeviceRootSecretNameV1 =
  "BITESAVER_DEVICE_ROOT_KEY_V1" as const;
export const customerBiteSaverAndroidDeviceRefDomainV1 =
  "BiteStar/BiteSaver/AndroidSsaidDeviceRef/v1\0" as const;
export const customerBiteSaverIosDeviceRefDomainV1 =
  "BiteStar/BiteSaver/IosRecoveryPublicKeyDeviceRef/v1\0" as const;
export const customerBiteSaverInstallationRecordDomainV1 =
  "BiteStar/BiteSaver/InstallationRecord/v1\0" as const;

export type CustomerBiteSaverDeviceRootKeyV1 = Uint8Array & {
  readonly __customerBiteSaverDeviceRootKeyV1: unique symbol;
};

function invalidConfiguration(): never {
  throw new CustomerBiteSaverContractError(
    "failed-precondition",
    "BiteSaver device verification is not configured.",
  );
}

function invalidIdentity(): never {
  throw new CustomerBiteSaverContractError(
    "permission-denied",
    "BiteSaver device identity is invalid.",
  );
}

function canonicalBytes(value: Uint8Array): Buffer {
  if (!(value instanceof Uint8Array) || value.length > 0xffffffff) {
    return invalidIdentity();
  }
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(value.length);
  return Buffer.concat([length, Buffer.from(value)]);
}

function canonicalText(value: string): Buffer {
  return canonicalBytes(Buffer.from(value, "utf8"));
}

function rootDigest(
  rootKey: CustomerBiteSaverDeviceRootKeyV1,
  domain: string,
  parts: readonly Uint8Array[],
): Buffer {
  requireCustomerBiteSaverDeviceRootKeyV1(rootKey);
  const hmac = createHmac("sha256", rootKey);
  hmac.update(Buffer.from(domain, "ascii"));
  hmac.update(canonicalText(customerBiteSaverDeviceProofProtocolVersion));
  for (const part of parts) hmac.update(canonicalBytes(part));
  return hmac.digest();
}

export function requireCustomerBiteSaverDeviceRootKeyV1(
  value: Uint8Array,
): asserts value is CustomerBiteSaverDeviceRootKeyV1 {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    return invalidConfiguration();
  }
}

export function parseCustomerBiteSaverDeviceRootKeyV1(
  encoded: string,
): CustomerBiteSaverDeviceRootKeyV1 {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(encoded)) {
    return invalidConfiguration();
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== encoded) {
    return invalidConfiguration();
  }
  return decoded as unknown as CustomerBiteSaverDeviceRootKeyV1;
}

export function deriveCustomerBiteSaverAndroidDeviceRef(value: {
  rootKey: CustomerBiteSaverDeviceRootKeyV1;
  androidSsaid: string;
}): string {
  if (typeof value.androidSsaid !== "string" ||
    !/^[0-9a-f]{16}$/u.test(value.androidSsaid)
  ) {
    return invalidIdentity();
  }
  return `bsd_${rootDigest(
    value.rootKey,
    customerBiteSaverAndroidDeviceRefDomainV1,
    [Buffer.from(value.androidSsaid, "utf8")],
  ).toString("base64url")}`;
}

export function deriveCustomerBiteSaverIosDeviceRef(value: {
  rootKey: CustomerBiteSaverDeviceRootKeyV1;
  recoveryPublicKeyX963: Uint8Array;
}): string {
  if (!(value.recoveryPublicKeyX963 instanceof Uint8Array) ||
    value.recoveryPublicKeyX963.length !== 65 ||
    value.recoveryPublicKeyX963[0] !== 0x04
  ) {
    return invalidIdentity();
  }
  return `bsd_${rootDigest(
    value.rootKey,
    customerBiteSaverIosDeviceRefDomainV1,
    [value.recoveryPublicKeyX963],
  ).toString("base64url")}`;
}

export function customerBiteSaverInstallationRecordId(value: {
  rootKey: CustomerBiteSaverDeviceRootKeyV1;
  platform: CustomerBiteSaverDevicePlatform;
  credentialId: string;
}): string {
  if ((value.platform !== "android" && value.platform !== "ios") ||
    !/^bsic_[A-Za-z0-9_-]{43}$/u.test(value.credentialId)
  ) {
    return invalidIdentity();
  }
  return `bsdi_${rootDigest(
    value.rootKey,
    customerBiteSaverInstallationRecordDomainV1,
    [
      Buffer.from(value.platform, "utf8"),
      Buffer.from(value.credentialId, "utf8"),
    ],
  ).toString("base64url")}`;
}
