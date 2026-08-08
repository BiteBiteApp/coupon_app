import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { pageProtocolVersion } from "./pagination_protocol.js";

export const opaqueCursorPrefix = "bsp1.";
export const opaqueCursorDefaultLifetimeMs = 30 * 60 * 1_000;
export const opaqueCursorMaximumFutureSkewMs = 60 * 1_000;
export const opaqueCursorNonceByteLength = 12;
export const opaqueCursorAuthenticationTagByteLength = 16;

export type CursorPurpose = "forward" | "backward" | "last" | "page";
export type CursorSortValue = string | number | boolean | null;

export interface OpaqueCursorData {
  readonly protocolVersion: typeof pageProtocolVersion;
  readonly queryFingerprint: string;
  readonly source: string;
  readonly searchMode: string;
  readonly pageSize: number;
  readonly purpose: CursorPurpose;
  readonly sortTuple: readonly CursorSortValue[];
  readonly callerBinding: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly sessionId?: string;
}

export interface EncodeOpaqueCursorInput {
  readonly queryFingerprint: string;
  readonly source: string;
  readonly searchMode: string;
  readonly pageSize: number;
  readonly purpose: CursorPurpose;
  readonly sortTuple: readonly CursorSortValue[];
  readonly callerBinding: string;
  readonly sessionId?: string;
  readonly lifetimeMs?: number;
}

export interface OpaqueCursorBinding {
  readonly queryFingerprint: string;
  readonly source: string;
  readonly searchMode: string;
  readonly pageSize: number;
  readonly callerBinding: string;
  readonly purposes?: readonly CursorPurpose[];
}

export interface OpaqueCursorCodecOptions {
  readonly key: Uint8Array;
  readonly clock?: () => number;
  readonly nonceSource?: (size: number) => Uint8Array;
  readonly maximumFutureSkewMs?: number;
}

export class OpaqueCursorError extends Error {
  readonly code = "opaque_cursor_error";

  constructor() {
    super("The page cursor is invalid or expired.");
    this.name = "OpaqueCursorError";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireString(value: unknown, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new OpaqueCursorError();
  }
  return value;
}

function requireFingerprint(value: unknown): string {
  const fingerprint = requireString(value, 64);
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) {
    throw new OpaqueCursorError();
  }
  return fingerprint;
}

function requireSafeInteger(value: unknown, minimum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new OpaqueCursorError();
  }
  return value;
}

function requirePurpose(value: unknown): CursorPurpose {
  if (
    value !== "forward" &&
    value !== "backward" &&
    value !== "last" &&
    value !== "page"
  ) {
    throw new OpaqueCursorError();
  }
  return value;
}

function requireSortTuple(value: unknown): readonly CursorSortValue[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new OpaqueCursorError();
  }
  const tuple = value.map((entry): CursorSortValue => {
    if (
      entry === null ||
      typeof entry === "boolean" ||
      (typeof entry === "string" && entry.length <= 256) ||
      (typeof entry === "number" && Number.isSafeInteger(entry))
    ) {
      return entry;
    }
    throw new OpaqueCursorError();
  });
  return Object.freeze(tuple);
}

function requireExactPayloadKeys(data: Record<string, unknown>): void {
  const required = [
    "protocolVersion",
    "queryFingerprint",
    "source",
    "searchMode",
    "pageSize",
    "purpose",
    "sortTuple",
    "callerBinding",
    "issuedAtMs",
    "expiresAtMs",
  ];
  const allowed = new Set([...required, "sessionId"]);
  if (
    required.some((key) => !hasOwn(data, key)) ||
    Object.keys(data).some((key) => !allowed.has(key))
  ) {
    throw new OpaqueCursorError();
  }
}

function parsePayload(value: unknown): OpaqueCursorData {
  if (!isPlainRecord(value)) {
    throw new OpaqueCursorError();
  }
  requireExactPayloadKeys(value);
  if (value.protocolVersion !== pageProtocolVersion) {
    throw new OpaqueCursorError();
  }
  const issuedAtMs = requireSafeInteger(value.issuedAtMs, 0);
  const expiresAtMs = requireSafeInteger(value.expiresAtMs, 0);
  if (
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > opaqueCursorDefaultLifetimeMs
  ) {
    throw new OpaqueCursorError();
  }
  const sessionId = hasOwn(value, "sessionId")
    ? requireString(value.sessionId, 128)
    : undefined;
  return Object.freeze({
    protocolVersion: pageProtocolVersion,
    queryFingerprint: requireFingerprint(value.queryFingerprint),
    source: requireString(value.source, 100),
    searchMode: requireString(value.searchMode, 100),
    pageSize: requireSafeInteger(value.pageSize, 1),
    purpose: requirePurpose(value.purpose),
    sortTuple: requireSortTuple(value.sortTuple),
    callerBinding: requireFingerprint(value.callerBinding),
    issuedAtMs,
    expiresAtMs,
    ...(sessionId === undefined ? {} : { sessionId }),
  });
}

export class OpaqueCursorCodec {
  readonly #key: Buffer;
  readonly #clock: () => number;
  readonly #nonceSource: (size: number) => Uint8Array;
  readonly #maximumFutureSkewMs: number;

  constructor(options: OpaqueCursorCodecOptions) {
    try {
      if (!(options.key instanceof Uint8Array) || options.key.byteLength !== 32) {
        throw new OpaqueCursorError();
      }
      const maximumFutureSkewMs =
        options.maximumFutureSkewMs ?? opaqueCursorMaximumFutureSkewMs;
      if (!Number.isSafeInteger(maximumFutureSkewMs) || maximumFutureSkewMs < 0) {
        throw new OpaqueCursorError();
      }
      this.#key = Buffer.from(options.key);
      this.#clock = options.clock ?? Date.now;
      this.#nonceSource = options.nonceSource ?? randomBytes;
      this.#maximumFutureSkewMs = maximumFutureSkewMs;
    } catch (error) {
      if (error instanceof OpaqueCursorError) {
        throw error;
      }
      throw new OpaqueCursorError();
    }
  }

  encode(input: EncodeOpaqueCursorInput): string {
    try {
      const issuedAtMs = requireSafeInteger(this.#clock(), 0);
      const lifetimeMs = requireSafeInteger(
        input.lifetimeMs ?? opaqueCursorDefaultLifetimeMs,
        1,
      );
      if (lifetimeMs > opaqueCursorDefaultLifetimeMs) {
        throw new OpaqueCursorError();
      }
      const payload = parsePayload({
        protocolVersion: pageProtocolVersion,
        queryFingerprint: input.queryFingerprint,
        source: input.source,
        searchMode: input.searchMode,
        pageSize: input.pageSize,
        purpose: input.purpose,
        sortTuple: input.sortTuple,
        callerBinding: input.callerBinding,
        issuedAtMs,
        expiresAtMs: issuedAtMs + lifetimeMs,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      });
      if (!Number.isSafeInteger(payload.expiresAtMs)) {
        throw new OpaqueCursorError();
      }
      const nonceBytes = this.#nonceSource(opaqueCursorNonceByteLength);
      if (
        !(nonceBytes instanceof Uint8Array) ||
        nonceBytes.byteLength !== opaqueCursorNonceByteLength
      ) {
        throw new OpaqueCursorError();
      }
      const nonce = Buffer.from(nonceBytes);
      const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
      cipher.setAAD(Buffer.from(opaqueCursorPrefix, "ascii"));
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(payload), "utf8"),
        cipher.final(),
      ]);
      const authenticationTag = cipher.getAuthTag();
      const packed = Buffer.concat([nonce, authenticationTag, encrypted]);
      return `${opaqueCursorPrefix}${packed.toString("base64url")}`;
    } catch (error) {
      if (error instanceof OpaqueCursorError) {
        throw error;
      }
      throw new OpaqueCursorError();
    }
  }

  decode(token: unknown, binding: OpaqueCursorBinding): OpaqueCursorData {
    try {
      if (
        typeof token !== "string" ||
        !token.startsWith(opaqueCursorPrefix)
      ) {
        throw new OpaqueCursorError();
      }
      const encoded = token.slice(opaqueCursorPrefix.length);
      if (
        encoded.length === 0 ||
        encoded.length > 32_768 ||
        !/^[A-Za-z0-9_-]+$/u.test(encoded)
      ) {
        throw new OpaqueCursorError();
      }
      const packed = Buffer.from(encoded, "base64url");
      if (
        packed.toString("base64url") !== encoded ||
        packed.byteLength <=
          opaqueCursorNonceByteLength +
            opaqueCursorAuthenticationTagByteLength
      ) {
        throw new OpaqueCursorError();
      }
      const nonce = packed.subarray(0, opaqueCursorNonceByteLength);
      const authenticationTag = packed.subarray(
        opaqueCursorNonceByteLength,
        opaqueCursorNonceByteLength + opaqueCursorAuthenticationTagByteLength,
      );
      const encrypted = packed.subarray(
        opaqueCursorNonceByteLength + opaqueCursorAuthenticationTagByteLength,
      );
      const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
      decipher.setAAD(Buffer.from(opaqueCursorPrefix, "ascii"));
      decipher.setAuthTag(authenticationTag);
      const plaintext = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString("utf8");
      const payload = parsePayload(JSON.parse(plaintext) as unknown);
      const now = requireSafeInteger(this.#clock(), 0);
      if (
        payload.issuedAtMs > now + this.#maximumFutureSkewMs ||
        now >= payload.expiresAtMs ||
        payload.queryFingerprint !== requireFingerprint(binding.queryFingerprint) ||
        payload.source !== requireString(binding.source, 100) ||
        payload.searchMode !== requireString(binding.searchMode, 100) ||
        payload.pageSize !== requireSafeInteger(binding.pageSize, 1) ||
        payload.callerBinding !== requireFingerprint(binding.callerBinding)
      ) {
        throw new OpaqueCursorError();
      }
      if (
        binding.purposes !== undefined &&
        (!Array.isArray(binding.purposes) ||
          binding.purposes.length === 0 ||
          !binding.purposes.map(requirePurpose).includes(payload.purpose))
      ) {
        throw new OpaqueCursorError();
      }
      return payload;
    } catch (error) {
      if (error instanceof OpaqueCursorError) {
        throw error;
      }
      throw new OpaqueCursorError();
    }
  }
}
