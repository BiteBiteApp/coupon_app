import {createPublicKey, verify} from "node:crypto";

export type PostgisPhaseTransitionClaims = Readonly<{
  protocolVersion: "bitestar.postgis-phase-transition.v1";
  projectId: string; projectNumber: string; runId: string;
  priorCandidateDigest: string; priorConfigDigest: string;
  nextCandidateDigest: string; nextConfigDigest: string;
  nextApprovalDigest: string; evidenceDigest: string;
  firstBillableAtMs: number; deadlineMs: number;
  fromPhase: "diagnostic"; toPhase: "serving"; sequence: 1;
  notBeforeMs: number; validUntilMs: number;
}>;
export type PostgisPhaseTransitionExpectation = Omit<PostgisPhaseTransitionClaims, "protocolVersion" | "notBeforeMs" | "validUntilMs"> &
  Readonly<{purpose: "phase-transition"; nowMs: number}>;
const keys = ["protocolVersion", "projectId", "projectNumber", "runId", "priorCandidateDigest", "priorConfigDigest",
  "nextCandidateDigest", "nextConfigDigest", "nextApprovalDigest", "evidenceDigest", "firstBillableAtMs", "deadlineMs",
  "fromPhase", "toPhase", "sequence", "notBeforeMs", "validUntilMs"].sort();
export function canonicalPostgisPhaseTransition(value: PostgisPhaseTransitionClaims): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}
function invalid(): never {throw new Error("Missing, invalid or expired PostGIS phase transition approval.");}
/** Separate explicit signature: an ordinary execution approval cannot mutate a
 * ledger phase. This verifier has no provider imports, credential or I/O path.
 */
export function verifyPostgisPhaseTransitionApproval(envelope: unknown, trustedKeys: Readonly<Record<string, string>>,
  expected: PostgisPhaseTransitionExpectation): PostgisPhaseTransitionClaims {
  try {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(",") !== "keyId,payloadBase64,signatureBase64") invalid();
    const e = envelope as Record<string, unknown>;
    if (typeof e.keyId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(e.keyId) || !Object.prototype.hasOwnProperty.call(trustedKeys, e.keyId)) invalid();
    const decode = (value: unknown, max: number) => {
      if (typeof value !== "string" || !value || value.length > max || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) invalid();
      const bytes = Buffer.from(value, "base64");if (bytes.toString("base64") !== value) invalid();return bytes;
    };
    const bytes = decode(e.payloadBase64, 16 * 1024), signature = decode(e.signatureBase64, 128), key = createPublicKey(trustedKeys[e.keyId]);
    if (key.asymmetricKeyType !== "ed25519" || signature.length !== 64 || !verify(null, bytes, key, signature)) invalid();
    const c = JSON.parse(bytes.toString("utf8")) as PostgisPhaseTransitionClaims;
    if (!c || Object.keys(c).sort().join(",") !== keys.join(",") || bytes.toString("utf8") !== canonicalPostgisPhaseTransition(c) ||
      c.protocolVersion !== "bitestar.postgis-phase-transition.v1" || c.fromPhase !== "diagnostic" || c.toPhase !== "serving" || c.sequence !== 1 ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(c.projectId) || c.projectId === "coupon-app-29446" || c.projectId.startsWith("demo-") ||
      !/^[1-9][0-9]{5,19}$/u.test(c.projectNumber) || !/^bs-postgis-[a-z0-9-]{1,60}$/u.test(c.runId) ||
      ![c.priorCandidateDigest, c.priorConfigDigest, c.nextCandidateDigest, c.nextConfigDigest, c.nextApprovalDigest, c.evidenceDigest]
        .every(value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)) ||
      ![c.firstBillableAtMs, c.deadlineMs, c.notBeforeMs, c.validUntilMs, expected.nowMs].every(value => Number.isSafeInteger(value) && value >= 0) ||
      c.deadlineMs <= c.firstBillableAtMs || c.deadlineMs - c.firstBillableAtMs > 259_200_000 ||
      c.notBeforeMs < c.firstBillableAtMs || c.validUntilMs <= c.notBeforeMs || c.validUntilMs > c.deadlineMs ||
      expected.nowMs < c.notBeforeMs || expected.nowMs >= c.validUntilMs || expected.purpose !== "phase-transition") invalid();
    for (const name of keys.filter(name => !["protocolVersion", "notBeforeMs", "validUntilMs"].includes(name))) {
      if (c[name as keyof typeof c] !== expected[name as keyof typeof expected]) invalid();
    }
    return Object.freeze(c);
  } catch {return invalid();}
}
