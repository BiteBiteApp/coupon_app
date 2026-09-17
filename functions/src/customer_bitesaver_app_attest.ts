import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { X509Certificate as NodeX509Certificate } from "node:crypto";
import { Decoder } from "cbor-x";
import { X509Certificate as PeculiarX509Certificate } from "@peculiar/x509";
import { CustomerBiteSaverContractError } from
  "./customer_bitesaver_search_contract.js";

export const customerBiteSaverIosBundleId = "com.colesmart.bitestar" as const;
export const customerBiteSaverIosTeamId = "WXLXQ5D769" as const;
export const customerBiteSaverIosAppId =
  `${customerBiteSaverIosTeamId}.${customerBiteSaverIosBundleId}` as const;
export const customerBiteSaverAppAttestNonceExtensionOid =
  "1.2.840.113635.100.8.2" as const;

export type CustomerBiteSaverAppAttestEnvironment =
  | "development"
  | "production";

export type CustomerBiteSaverAppAttestPolicy = Readonly<{
  appId: typeof customerBiteSaverIosAppId;
  environment: CustomerBiteSaverAppAttestEnvironment;
  trustedRootCertificatesDer: readonly Uint8Array[];
  allowedValidationCategories: ReadonlySet<number>;
  allowedBundleVersions: ReadonlySet<string>;
}>;

export type CustomerBiteSaverVerifiedAppAttestation = Readonly<{
  appAttestPublicKeySpki: string;
  appId: typeof customerBiteSaverIosAppId;
  environment: CustomerBiteSaverAppAttestEnvironment;
  initialAssertionCounter: 0;
  validationCategory: number | null;
  bundleVersion: string | null;
}>;

export type CustomerBiteSaverVerifiedAppAssertion = Readonly<{
  assertionCounter: number;
  validationCategory: number | null;
  bundleVersion: string | null;
}>;

const cborDecoder = new Decoder({
  mapsAsObjects: false,
  useRecords: false,
  structuredClone: false,
});

function rejected(): never {
  throw new CustomerBiteSaverContractError(
    "permission-denied",
    "iOS device proof was rejected.",
  );
}

// This is a wire-shape preflight, not a second CBOR decoder. It covers only the
// App Attest types used below and sees every map before cbor-x can collapse keys.
// The byte limits remain at the callers; small depth/item limits bound traversal.
function validateCborMaps(value: Uint8Array, maximumTopLevelItems: number): void {
  const bytes = Buffer.from(value);
  const utf8 = new TextDecoder("utf-8", {fatal: true});
  let offset = 0;
  let items = 0;

  function argument(additional: number): number {
    if (additional < 24) return additional;
    const width = additional === 24 ? 1 : additional === 25 ? 2 :
      additional === 26 ? 4 : additional === 27 ? 8 : 0;
    if (width === 0 || offset + width > bytes.length) return rejected();
    const result = width === 8
      ? Number(bytes.readBigUInt64BE(offset))
      : bytes.readUIntBE(offset, width);
    offset += width;
    if (!Number.isSafeInteger(result)) return rejected();
    return result;
  }

  function item(depth: number, mapKey = false): string | number | undefined {
    items += 1;
    if (depth > 8 || items > 128 || offset >= bytes.length) return rejected();
    const head = bytes[offset++];
    const major = head >>> 5;
    const length = argument(head & 0x1f);
    if (major === 0 || major === 1) {
      const integer = major === 0 ? length : -1 - length;
      if (!Number.isSafeInteger(integer)) return rejected();
      return integer;
    }
    if (major === 3 || (major === 2 && !mapKey)) {
      if (length > bytes.length - offset) return rejected();
      const content = bytes.subarray(offset, offset + length);
      offset += length;
      return major === 3 ? utf8.decode(content) : undefined;
    }
    if (mapKey) return rejected();
    // cbor-x's explicit Map encoding uses tag 259. No other tag is part of
    // this protocol (including tags that transform keys or share references).
    if (major === 6 && length === 259 &&
      offset < bytes.length && (bytes[offset] >>> 5) === 5
    ) {
      return item(depth + 1);
    }
    if ((major !== 4 && major !== 5) || length > 32) return rejected();
    const seen = new Set<string | number>();
    for (let index = 0; index < length; index += 1) {
      if (major === 5) {
        const key = item(depth + 1, true);
        if (key === undefined || seen.has(key)) return rejected();
        seen.add(key);
      }
      item(depth + 1);
    }
    return undefined;
  }

  let topLevelItems = 0;
  while (offset < bytes.length) {
    topLevelItems += 1;
    if (topLevelItems > maximumTopLevelItems) return rejected();
    item(0);
  }
}

function decodeCbor(value: Uint8Array, maximumBytes: number): unknown {
  if (!(value instanceof Uint8Array) || value.length === 0 ||
    value.length > maximumBytes
  ) {
    return rejected();
  }
  try {
    validateCborMaps(value, 1);
    return cborDecoder.decode(Buffer.from(value));
  } catch {
    return rejected();
  }
}

function decodeCborSequence(
  value: Uint8Array,
  expectedItems: number | readonly number[],
): readonly unknown[] {
  if (!(value instanceof Uint8Array) || value.length === 0 || value.length > 1_024) {
    return rejected();
  }
  const items: unknown[] = [];
  try {
    validateCborMaps(
      value,
      typeof expectedItems === "number" ? expectedItems :
        Math.max(...expectedItems),
    );
    cborDecoder.decodeMultiple(Buffer.from(value), (item: unknown) => {
      items.push(item);
    });
  } catch {
    return rejected();
  }
  const accepted = typeof expectedItems === "number"
    ? items.length === expectedItems
    : expectedItems.includes(items.length);
  if (!accepted) return rejected();
  return Object.freeze(items);
}

function strictMap(
  value: unknown,
  keys: readonly (string | number)[],
): Map<unknown, unknown> {
  if (!(value instanceof Map) || value.size !== keys.length ||
    keys.some((key) => !value.has(key)) ||
    [...value.keys()].some((key) => !keys.includes(key as string | number))
  ) {
    return rejected();
  }
  return value;
}

function boundedBytes(
  value: unknown,
  minimum: number,
  maximum: number,
): Buffer {
  if (!(value instanceof Uint8Array) || value.length < minimum ||
    value.length > maximum
  ) {
    return rejected();
  }
  return Buffer.from(value);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function expectedAaguid(
  environment: CustomerBiteSaverAppAttestEnvironment,
): Buffer {
  return environment === "development"
    ? Buffer.from("appattestdevelop", "ascii")
    : Buffer.concat([
        Buffer.from("appattest", "ascii"),
        Buffer.alloc(7),
      ]);
}

function validPolicy(
  value: CustomerBiteSaverAppAttestPolicy,
): CustomerBiteSaverAppAttestPolicy {
  if (value.appId !== customerBiteSaverIosAppId ||
    (value.environment !== "development" && value.environment !== "production") ||
    !Array.isArray(value.trustedRootCertificatesDer) ||
    value.trustedRootCertificatesDer.length === 0 ||
    value.trustedRootCertificatesDer.length > 4 ||
    value.trustedRootCertificatesDer.some((certificate) =>
      !(certificate instanceof Uint8Array) || certificate.length < 256 ||
      certificate.length > 8_192) ||
    !(value.allowedValidationCategories instanceof Set) ||
    value.allowedValidationCategories.size === 0 ||
    value.allowedValidationCategories.size > 10 ||
    [...value.allowedValidationCategories].some((category) =>
      !Number.isInteger(category) || category < 1 || category > 10 ||
      category === 7 || category === 8 || category === 9) ||
    !(value.allowedBundleVersions instanceof Set) ||
    value.allowedBundleVersions.size === 0 ||
    value.allowedBundleVersions.size > 32 ||
    [...value.allowedBundleVersions].some((version) =>
      typeof version !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/u.test(version))
  ) {
    throw new CustomerBiteSaverContractError(
      "failed-precondition",
      "iOS device verification policy is invalid.",
    );
  }
  return value;
}

function strictEcdsaDerSignature(value: Uint8Array): Buffer {
  const signature = boundedBytes(value, 64, 80);
  if (signature[0] !== 0x30 || signature[1] !== signature.length - 2) {
    return rejected();
  }
  let offset = 2;
  for (let component = 0; component < 2; component += 1) {
    if (signature[offset] !== 0x02) return rejected();
    const length = signature[offset + 1];
    offset += 2;
    if (length < 1 || length > 33 || offset + length > signature.length ||
      (signature[offset] & 0x80) !== 0 ||
      (length > 1 && signature[offset] === 0 &&
        (signature[offset + 1] & 0x80) === 0)
    ) {
      return rejected();
    }
    offset += length;
  }
  if (offset !== signature.length) return rejected();
  return signature;
}

function publicKeyX963(certificate: NodeX509Certificate): Buffer {
  if (certificate.publicKey.asymmetricKeyType !== "ec" ||
    certificate.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    return rejected();
  }
  const jwk = certificate.publicKey.export({format: "jwk"});
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" ||
    typeof jwk.x !== "string" || typeof jwk.y !== "string"
  ) {
    return rejected();
  }
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.length !== 32 || y.length !== 32) return rejected();
  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

function certificateTimeValid(
  certificate: NodeX509Certificate,
  nowMillis: number,
): boolean {
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  return Number.isSafeInteger(nowMillis) && nowMillis >= validFrom &&
    nowMillis < validTo;
}

function verifyCertificateChain(value: {
  certificates: readonly Buffer[];
  policy: CustomerBiteSaverAppAttestPolicy;
  nowMillis: number;
}): {leaf: NodeX509Certificate; publicKeyX963: Buffer; spki: Buffer} {
  if (value.certificates.length < 2 || value.certificates.length > 3) {
    return rejected();
  }
  let chain: NodeX509Certificate[];
  let roots: NodeX509Certificate[];
  try {
    chain = value.certificates.map((der) => new NodeX509Certificate(der));
    roots = value.policy.trustedRootCertificatesDer.map((der) =>
      new NodeX509Certificate(Buffer.from(der)));
  } catch {
    return rejected();
  }
  if (chain.some((certificate) =>
    !certificateTimeValid(certificate, value.nowMillis)) ||
    roots.some((certificate) =>
      !certificateTimeValid(certificate, value.nowMillis))
  ) {
    return rejected();
  }
  for (let index = 0; index + 1 < chain.length; index += 1) {
    const child = chain[index];
    const issuer = chain[index + 1];
    if (!issuer.ca || !child.checkIssued(issuer) ||
      !child.verify(issuer.publicKey)) {
      return rejected();
    }
  }
  const last = chain[chain.length - 1];
  const trusted = roots.some((root) => {
    if (equalBytes(last.raw, root.raw)) return true;
    return root.ca && last.checkIssued(root) && last.verify(root.publicKey);
  });
  if (!trusted) return rejected();
  const leaf = chain[0];
  if (leaf.ca) return rejected();
  const spki = leaf.publicKey.export({format: "der", type: "spki"});
  return {leaf, publicKeyX963: publicKeyX963(leaf), spki};
}

function nonceExtension(leafDer: Uint8Array): Buffer {
  let certificate: PeculiarX509Certificate;
  try {
    certificate = new PeculiarX509Certificate(Buffer.from(leafDer));
  } catch {
    return rejected();
  }
  const extensions = certificate.getExtensions(
    customerBiteSaverAppAttestNonceExtensionOid,
  );
  if (extensions.length !== 1) return rejected();
  const encoded = Buffer.from(extensions[0].value);
  if (encoded.length !== 38 ||
    !equalBytes(encoded.subarray(0, 6), Buffer.from([
      0x30, 0x24, 0xa1, 0x22, 0x04, 0x20,
    ]))
  ) {
    return rejected();
  }
  return encoded.subarray(6);
}

type ParsedAttestedAuthenticatorData = Readonly<{
  rpIdHash: Buffer;
  counter: number;
  aaguid: Buffer;
  credentialId: Buffer;
  publicKeyX963: Buffer;
  validationCategory: number | null;
  bundleVersion: string | null;
}>;

function parsedCosePublicKey(value: unknown): Buffer {
  const cose = strictMap(value, [1, 3, -1, -2, -3]);
  if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) {
    return rejected();
  }
  const x = boundedBytes(cose.get(-2), 32, 32);
  const y = boundedBytes(cose.get(-3), 32, 32);
  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

function parseAuthenticatorExtensions(value: unknown): {
  validationCategory: number;
  bundleVersion: string;
} {
  const extensions = strictMap(value, [
    "apple_validation_category_01",
    "apple_bundle_version_01",
  ]);
  const encodedValidationCategory = boundedBytes(
    extensions.get("apple_validation_category_01"),
    4,
    4,
  );
  const validationCategory = encodedValidationCategory.readUInt32LE(0);
  const bundleVersion = extensions.get("apple_bundle_version_01");
  if (typeof bundleVersion !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/u.test(bundleVersion)
  ) {
    return rejected();
  }
  return {validationCategory, bundleVersion};
}

const legacyAuthenticatorProperties = Object.freeze({
  validationCategory: null,
  bundleVersion: null,
});

function parseAttestedAuthenticatorData(
  value: Uint8Array,
): ParsedAttestedAuthenticatorData {
  const bytes = boundedBytes(value, 55 + 32 + 1, 1_024);
  const rpIdHash = bytes.subarray(0, 32);
  const flags = bytes[32];
  const counter = bytes.readUInt32BE(33);
  const aaguid = bytes.subarray(37, 53);
  const credentialLength = bytes.readUInt16BE(53);
  const credentialStart = 55;
  const credentialEnd = credentialStart + credentialLength;
  if (flags !== 0x40 || counter !== 0 || credentialLength !== 32 ||
    credentialEnd >= bytes.length)
  {
    return rejected();
  }
  const credentialId = bytes.subarray(credentialStart, credentialEnd);
  const encodedCredential = bytes.subarray(credentialEnd);
  const items = decodeCborSequence(
    encodedCredential,
    [1, 2],
  );
  const cose = items[0];
  const publicKey = parsedCosePublicKey(cose);
  const extensions = items.length === 2
    ? parseAuthenticatorExtensions(items[1])
    : legacyAuthenticatorProperties;
  return Object.freeze({
    rpIdHash,
    counter,
    aaguid,
    credentialId,
    publicKeyX963: publicKey,
    ...extensions,
  });
}

function parseAssertionAuthenticatorData(value: Uint8Array): {
  rpIdHash: Buffer;
  counter: number;
  validationCategory: number | null;
  bundleVersion: string | null;
} {
  const bytes = boundedBytes(value, 37, 1_024);
  const flags = bytes[32];
  if (flags !== 0x40) return rejected();
  const extensions = bytes.length > 37
    ? parseAuthenticatorExtensions(
        decodeCborSequence(bytes.subarray(37), 1)[0],
      )
    : legacyAuthenticatorProperties;
  return {
    rpIdHash: bytes.subarray(0, 32),
    counter: bytes.readUInt32BE(33),
    ...extensions,
  };
}

export class CustomerBiteSaverAppAttestVerifier {
  readonly #policy: CustomerBiteSaverAppAttestPolicy;
  readonly #rpIdHash: Buffer;

  constructor(policy: CustomerBiteSaverAppAttestPolicy) {
    this.#policy = validPolicy(policy);
    this.#rpIdHash = createHash("sha256").update(policy.appId, "utf8").digest();
  }

  verifyAttestation(input: Readonly<{
    attestationObject: Uint8Array;
    appAttestKeyId: string;
    clientDataHash: Uint8Array;
    nowMillis: number;
  }>): CustomerBiteSaverVerifiedAppAttestation {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(input.appAttestKeyId) ||
      !(input.clientDataHash instanceof Uint8Array) ||
      input.clientDataHash.length !== 32 ||
      !Number.isSafeInteger(input.nowMillis) || input.nowMillis < 0
    ) {
      return rejected();
    }
    const keyId = Buffer.from(input.appAttestKeyId, "base64url");
    if (keyId.length !== 32 || keyId.toString("base64url") !== input.appAttestKeyId) {
      return rejected();
    }
    const object = strictMap(
      decodeCbor(input.attestationObject, 65_536),
      ["fmt", "attStmt", "authData"],
    );
    if (object.get("fmt") !== "apple-appattest") return rejected();
    const statement = strictMap(object.get("attStmt"), ["x5c", "receipt"]);
    const rawCertificates = statement.get("x5c");
    if (!Array.isArray(rawCertificates) || rawCertificates.length < 2 ||
      rawCertificates.length > 3
    ) {
      return rejected();
    }
    const certificates = rawCertificates.map((certificate) =>
      boundedBytes(certificate, 256, 8_192));
    boundedBytes(statement.get("receipt"), 1, 16_384);
    const authData = boundedBytes(object.get("authData"), 88, 1_024);
    const chain = verifyCertificateChain({
      certificates,
      policy: this.#policy,
      nowMillis: input.nowMillis,
    });
    const expectedNonce = createHash("sha256").update(Buffer.concat([
      authData,
      Buffer.from(input.clientDataHash),
    ])).digest();
    if (!equalBytes(nonceExtension(certificates[0]), expectedNonce)) {
      return rejected();
    }
    const authenticator = parseAttestedAuthenticatorData(authData);
    if (!equalBytes(authenticator.rpIdHash, this.#rpIdHash) ||
      !equalBytes(authenticator.aaguid, expectedAaguid(this.#policy.environment)) ||
      !equalBytes(authenticator.credentialId, keyId) ||
      !equalBytes(authenticator.publicKeyX963, chain.publicKeyX963) ||
      !equalBytes(createHash("sha256").update(chain.publicKeyX963).digest(), keyId) ||
      (authenticator.validationCategory !== null &&
        !this.#policy.allowedValidationCategories.has(
          authenticator.validationCategory,
        )) ||
      (authenticator.bundleVersion !== null &&
        !this.#policy.allowedBundleVersions.has(authenticator.bundleVersion))
    ) {
      return rejected();
    }
    return Object.freeze({
      appAttestPublicKeySpki: chain.spki.toString("base64url"),
      appId: customerBiteSaverIosAppId,
      environment: this.#policy.environment,
      initialAssertionCounter: 0,
      validationCategory: authenticator.validationCategory,
      bundleVersion: authenticator.bundleVersion,
    });
  }

  verifyAssertion(input: Readonly<{
    assertionObject: Uint8Array;
    clientDataHash: Uint8Array;
    appAttestPublicKeySpki: Uint8Array;
  }>): CustomerBiteSaverVerifiedAppAssertion {
    if (!(input.clientDataHash instanceof Uint8Array) ||
      input.clientDataHash.length !== 32 ||
      !(input.appAttestPublicKeySpki instanceof Uint8Array) ||
      input.appAttestPublicKeySpki.length < 80 ||
      input.appAttestPublicKeySpki.length > 160
    ) {
      return rejected();
    }
    const object = strictMap(
      decodeCbor(input.assertionObject, 16_384),
      ["signature", "authenticatorData"],
    );
    const signature = strictEcdsaDerSignature(
      boundedBytes(object.get("signature"), 64, 80),
    );
    const authData = boundedBytes(object.get("authenticatorData"), 37, 1_024);
    const authenticator = parseAssertionAuthenticatorData(authData);
    if (!equalBytes(authenticator.rpIdHash, this.#rpIdHash) ||
      authenticator.counter <= 0 ||
      (authenticator.validationCategory !== null &&
        !this.#policy.allowedValidationCategories.has(
          authenticator.validationCategory,
        )) ||
      (authenticator.bundleVersion !== null &&
        !this.#policy.allowedBundleVersions.has(authenticator.bundleVersion))
    ) {
      return rejected();
    }
    let publicKey;
    try {
      publicKey = createPublicKey({
        key: Buffer.from(input.appAttestPublicKeySpki),
        format: "der",
        type: "spki",
      });
    } catch {
      return rejected();
    }
    if (publicKey.asymmetricKeyType !== "ec" ||
      publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      return rejected();
    }
    const nonce = createHash("sha256").update(Buffer.concat([
      authData,
      Buffer.from(input.clientDataHash),
    ])).digest();
    if (!verify("sha256", nonce, publicKey, signature)) return rejected();
    return Object.freeze({
      assertionCounter: authenticator.counter,
      validationCategory: authenticator.validationCategory,
      bundleVersion: authenticator.bundleVersion,
    });
  }
}

export const customerBiteSaverAppAttestInternals = Object.freeze({
  expectedAaguid,
  nonceExtension,
  parseAssertionAuthenticatorData,
  parseAttestedAuthenticatorData,
  strictEcdsaDerSignature,
  verifyCertificateChain,
});
