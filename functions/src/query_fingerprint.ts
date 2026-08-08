import { createHash } from "node:crypto";

export class QueryFingerprintError extends Error {
  readonly code = "query_fingerprint_error";

  constructor() {
    super("Search criteria could not be fingerprinted.");
    this.name = "QueryFingerprintError";
  }
}

export interface QueryFingerprintOptions {
  readonly unorderedListPaths?: readonly string[];
}

type CanonicalValue =
  | readonly ["null"]
  | readonly ["string", string]
  | readonly ["boolean", boolean]
  | readonly ["integer", string]
  | readonly ["list", readonly CanonicalValue[]]
  | readonly [
      "map",
      readonly (readonly [string, CanonicalValue])[],
    ];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(
  value: unknown,
  path: string,
  unorderedListPaths: ReadonlySet<string>,
  activeObjects: Set<object>,
): CanonicalValue {
  if (value === null) {
    return ["null"];
  }
  if (typeof value === "string") {
    return ["string", value];
  }
  if (typeof value === "boolean") {
    return ["boolean", value];
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new QueryFingerprintError();
    }
    return ["integer", value.toString()];
  }
  if (Array.isArray(value)) {
    if (activeObjects.has(value)) {
      throw new QueryFingerprintError();
    }
    activeObjects.add(value);
    try {
      const entries = value.map((entry, index) =>
        canonicalize(
          entry,
          `${path}[${index}]`,
          unorderedListPaths,
          activeObjects,
        ),
      );
      if (unorderedListPaths.has(path)) {
        entries.sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      }
      return ["list", entries];
    } finally {
      activeObjects.delete(value);
    }
  }
  if (isPlainRecord(value)) {
    if (activeObjects.has(value)) {
      throw new QueryFingerprintError();
    }
    activeObjects.add(value);
    try {
      const entries = Object.keys(value)
        .sort()
        .map(
          (key): readonly [string, CanonicalValue] => [
            key,
            canonicalize(
              value[key],
              path.length === 0 ? key : `${path}.${key}`,
              unorderedListPaths,
              activeObjects,
            ),
          ],
        );
      return ["map", entries];
    } finally {
      activeObjects.delete(value);
    }
  }
  throw new QueryFingerprintError();
}

export function canonicalSerializeQueryCriteria(
  criteria: unknown,
  options: QueryFingerprintOptions = {},
): string {
  if (!isPlainRecord(criteria)) {
    throw new QueryFingerprintError();
  }
  const paths = options.unorderedListPaths ?? [];
  if (paths.some((path) => typeof path !== "string" || path.length === 0)) {
    throw new QueryFingerprintError();
  }
  const unorderedListPaths = new Set(paths);
  if (unorderedListPaths.size !== paths.length) {
    throw new QueryFingerprintError();
  }
  return JSON.stringify(
    canonicalize(criteria, "", unorderedListPaths, new Set<object>()),
  );
}

export function createQueryFingerprint(
  criteria: unknown,
  options: QueryFingerprintOptions = {},
): string {
  const canonical = canonicalSerializeQueryCriteria(criteria, options);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
