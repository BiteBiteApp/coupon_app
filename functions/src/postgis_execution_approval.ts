import {createHash, createPublicKey, verify} from "node:crypto";

export const postgisApprovalProtocol = "bitestar.postgis-execution-approval.v1";
export type PostgisApprovalClaims = Readonly<{
  protocolVersion: typeof postgisApprovalProtocol;
  projectId: string; projectNumber: string; runId: string;
  candidateDigest: string; configDigest: string;
  notBeforeMs: number; validUntilMs: number; cleanupUntilMs: number;
  allowedGates: readonly number[];
  costCheckpointUsd?: 100;
}>;
export type PostgisApprovalEnvelope = Readonly<{keyId: string; payloadBase64: string; signatureBase64: string}>;
export type PostgisApprovalExpectation = Readonly<{
  projectId: string; projectNumber: string; runId: string;
  candidateDigest: string; configDigest: string; gate: number;
  purpose?: "execute" | "cleanup";
  nowMs?: number;
}>;
declare const verified: unique symbol;
export type VerifiedPostgisExecutionPermit = Readonly<PostgisApprovalClaims & {[verified]: true}>;
const permits = new WeakMap<object, PostgisApprovalClaims>();
/** Configuration hashes use recursively sorted JSON with safe integer numbers.
 * Configuration is nonsecret and must not contain its own digest/signature.
 */
export function digestPostgisConfiguration(configuration: unknown): string {
  function canonical(value: unknown, depth: number): string {
    if (depth > 20) invalid();
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "string" && /^[\x20-\x7e]*$/u.test(value)) return JSON.stringify(value);
    if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(",")}]`;
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return `{${Object.keys(value).sort().map(key => {
        if (!/^[\x20-\x7e]+$/u.test(key)) invalid();
        return `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`;
      }).join(",")}}`;
    }
    return invalid();
  }
  const bytes = canonical(configuration, 0);
  if (bytes.length > 256 * 1024) invalid();
  return createHash("sha256").update(bytes).digest("hex");
}
function invalid(): never {throw new Error("Missing, invalid or expired PostGIS execution approval.");}
function fields(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
/** ASCII claims and safe integer clocks keep this byte format identical across
 * Node and Python. No float serialization or ambient project inference is used.
 */
export function canonicalPostgisApproval(claims: PostgisApprovalClaims): string {
  return JSON.stringify(Object.fromEntries(Object.entries(claims).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}
function claimsFrom(value: unknown): PostgisApprovalClaims {
  const optional = value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "costCheckpointUsd");
  if (!fields(value, ["protocolVersion", "projectId", "projectNumber", "runId", "candidateDigest", "configDigest",
    "notBeforeMs", "validUntilMs", "cleanupUntilMs", "allowedGates", ...(optional ? ["costCheckpointUsd"] : [])]) ||
    (optional && value.costCheckpointUsd !== 100) || value.protocolVersion !== postgisApprovalProtocol ||
    typeof value.projectId !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(value.projectId) ||
    value.projectId === "coupon-app-29446" || value.projectId.startsWith("demo-") ||
    typeof value.projectNumber !== "string" || !/^[1-9][0-9]{5,19}$/u.test(value.projectNumber) ||
    typeof value.runId !== "string" || !/^bs-postgis-[a-z0-9-]{1,60}$/u.test(value.runId) ||
    ![value.candidateDigest, value.configDigest].every(v => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v)) ||
    ![value.notBeforeMs, value.validUntilMs, value.cleanupUntilMs].every(v => typeof v === "number" && Number.isSafeInteger(v) && v >= 0) ||
    !Array.isArray(value.allowedGates) || value.allowedGates.length < 1 || value.allowedGates.length > 5 ||
    value.allowedGates.some((gate, index, all) => !Number.isInteger(gate) || gate < 1 || gate > 5 || (index > 0 && gate <= all[index - 1]))) invalid();
  const c = value as unknown as PostgisApprovalClaims;
  if (c.validUntilMs <= c.notBeforeMs || c.validUntilMs - c.notBeforeMs > 72 * 60 * 60_000 ||
      c.cleanupUntilMs < c.validUntilMs || c.cleanupUntilMs - c.validUntilMs > 7 * 24 * 60 * 60_000) invalid();
  return c;
}
function check(c: PostgisApprovalClaims, expected: PostgisApprovalExpectation): void {
  const now = expected.nowMs ?? Date.now();
  if (!Number.isSafeInteger(now) || now < c.notBeforeMs || !Number.isInteger(expected.gate) ||
      !c.allowedGates.includes(expected.gate) ||
      (expected.purpose !== undefined && expected.purpose !== "execute" && expected.purpose !== "cleanup") ||
      (expected.purpose === "cleanup" ? expected.gate !== 5 || now >= c.cleanupUntilMs : now >= c.validUntilMs) ||
      ["projectId", "projectNumber", "runId", "candidateDigest", "configDigest"].some(key =>
        c[key as keyof PostgisApprovalClaims] !== expected[key as keyof PostgisApprovalExpectation])) invalid();
}
function base64(value: unknown, maximum: number): Buffer {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) invalid();
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) invalid();
  return bytes;
}
/** Pure cryptographic verification. Trusted keys are supplied separately from
 * the untrusted envelope by immutable operator configuration. No ADC/API access.
 */
export function verifyPostgisExecutionApproval(
  envelope: unknown, trustedKeys: Readonly<Record<string, string>>, expected: PostgisApprovalExpectation,
): VerifiedPostgisExecutionPermit {
  try {
    if (!fields(envelope, ["keyId", "payloadBase64", "signatureBase64"]) || typeof envelope.keyId !== "string" ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(envelope.keyId) ||
        !Object.prototype.hasOwnProperty.call(trustedKeys, envelope.keyId)) invalid();
    const key = createPublicKey(trustedKeys[envelope.keyId]);
    const bytes = base64(envelope.payloadBase64, 16 * 1024), signature = base64(envelope.signatureBase64, 128);
    if (key.asymmetricKeyType !== "ed25519" || signature.length !== 64 || !verify(null, bytes, key, signature)) invalid();
    const text = bytes.toString("utf8"), claims = claimsFrom(JSON.parse(text));
    if (text !== canonicalPostgisApproval(claims)) invalid();
    check(claims, expected);
    const frozen = Object.freeze({...claims, allowedGates: Object.freeze([...claims.allowedGates])});
    permits.set(frozen, frozen);
    return frozen as VerifiedPostgisExecutionPermit;
  } catch {return invalid();}
}
export function requirePostgisExecutionPermit(permit: VerifiedPostgisExecutionPermit, expected: PostgisApprovalExpectation): void {
  const claims = permit !== null && typeof permit === "object" ? permits.get(permit) : undefined;
  if (!claims) invalid();
  check(claims, expected);
}
