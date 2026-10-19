import {createHash} from "node:crypto";
import {
  requirePostgisExecutionPermit, digestPostgisConfiguration,
  type VerifiedPostgisExecutionPermit, type PostgisApprovalExpectation,
} from "./postgis_execution_approval.js";
import {postgisCanonicalJson, type PostgisJson} from "./postgis_source.js";
import {
  postgisRecoveryIdentity, validatePostgisRecoverySnapshot, validatePostgisSourceFence, registerPostgisRecoveryArtifactReader,
  type PostgisRecoveryManifest, type PostgisRecoveryRow, type PostgisRecoverySnapshotReader, type PostgisRecoveryArtifactProof,
} from "./postgis_source_recovery.js";

const protocol = "bitestar.postgis-gcs-snapshot.v1";
const chunkBytes = 8 * 1024 * 1024, envelopeBytes = 8 * 1024 * 1024;
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const md5 = (bytes: Buffer): string => createHash("md5").update(bytes).digest("base64");
const json = (value: unknown): string => postgisCanonicalJson(value as PostgisJson);
const parse = (bytes: Buffer): any => {
  try {return JSON.parse(bytes.toString("utf8"));}
  catch {throw new Error("Invalid snapshot provider JSON.");}
};
const generation = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,29}$/u.test(value);

export type PostgisSnapshotGcsConfig = Readonly<{
  bucket: string; bucketCreatedAt: string; prefix: string; snapshotId: string;
  serviceAccountEmail: string; maxSnapshotBytes: number;
}>;
export type PostgisSnapshotRequest = Readonly<{
  method: "GET" | "POST"; url: string; contentType?: string; body?: Buffer;
  maxResponseBytes: number; timeoutMs: number;
}>;
export type PostgisSnapshotTransport = (request: PostgisSnapshotRequest) => Promise<Readonly<{status: number; body: Buffer}>>;
type ObjectReceipt = Readonly<{name: string; generation: string; bytes: number; sha256: string}>;
type Chunk = ObjectReceipt & Readonly<{count: number; first: string; last: string}>;
type Envelope = Readonly<{
  protocol: string; binding: PostgisApprovalExpectation; manifest: PostgisRecoveryManifest;
  chunks: readonly Chunk[]; dataBytes: number;
}>;
const approvedStores = new WeakMap<object, Readonly<{check: () => void; configDigest: string; snapshotId: string}>>();
export function requireApprovedPostgisSnapshotStore(
  store: GcsPostgisSnapshotStore, configuration: Readonly<Record<string, unknown>>, id: string,
): void {
  const record = store && typeof store === "object" ? approvedStores.get(store) : undefined;
  if (!record) throw new Error("An approved GCS snapshot store is required.");
  record.check();
  if (record.configDigest !== digestPostgisConfiguration(configuration)) throw new Error("Snapshot configuration binding mismatch.");
  if (record.snapshotId !== id) throw new Error("Snapshot ID is outside approved scope.");
}

/** Only this explicit factory can request ADC. Imports, construction and dry-run
 * validation remain inert. Tokens are refreshed by the supported auth library;
 * neither credentials nor provider response bodies escape as errors/logs.
 */
function googleTransport(check: () => void, serviceAccount: string): PostgisSnapshotTransport {
  let auth: import("google-auth-library").GoogleAuth | undefined;
  return async request => {
    check();
    const url = new URL(request.url);
    if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com" || url.port) throw new Error("Invalid snapshot provider endpoint.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    const operation = async (): Promise<{status: number; body: Buffer}> => {
      if (!auth) {
        const {GoogleAuth} = await import("google-auth-library");
        auth = new GoogleAuth({scopes: ["https://www.googleapis.com/auth/devstorage.read_write"]});
      }
      const credentials = await auth.getCredentials();
      if (credentials.client_email !== serviceAccount) throw new Error("Snapshot identity mismatch.");
      const token = await auth.getAccessToken();
      if (!token || controller.signal.aborted) throw new Error("Snapshot credentials unavailable.");
      check();
      const response = await fetch(url, {method: request.method, redirect: "error", signal: controller.signal,
        headers: {Authorization: `Bearer ${token}`, ...(request.contentType ? {"Content-Type": request.contentType} : {})},
        body: request.body as unknown as BodyInit | undefined});
      if (!response.body) return {status: response.status, body: Buffer.alloc(0)};
      const reader = response.body.getReader(), chunks: Buffer[] = [];
      let length = 0;
      try {
        while (true) {
          const entry = await reader.read(); if (entry.done) break;
          length += entry.value.byteLength;
          if (length > request.maxResponseBytes) throw new Error("Snapshot provider response exceeds bound.");
          chunks.push(Buffer.from(entry.value));
        }
      } finally {await reader.cancel().catch(() => undefined);}
      return {status: response.status, body: Buffer.concat(chunks)};
    };
    let rejectTimeout: ((reason: Error) => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {rejectTimeout = reject;});
    const onAbort = (): void => rejectTimeout?.(new Error("Snapshot provider deadline exceeded."));
    controller.signal.addEventListener("abort", onAbort, {once: true});
    try {return await Promise.race([operation(), timeout]);}
    catch {throw new Error("Snapshot provider request failed or exceeded its deadline.");}
    finally {clearTimeout(timer); controller.signal.removeEventListener("abort", onAbort);}
  };
}

/** Immutable GCS objects plus a last-published manifest. The signed configuration
 * binds ONE snapshot ID to this run prefix and a <=5 GiB total. A new snapshot
 * needs a separately reserved approved configuration; partial objects count too.
 * Injected transports exercise the same JSON API requests without ADC/network.
 */
export class GcsPostgisSnapshotStore implements PostgisRecoverySnapshotReader {
  private readonly config: PostgisSnapshotGcsConfig;
  private readonly expected: PostgisApprovalExpectation;
  private readonly transport: PostgisSnapshotTransport;
  private readonly pinned = new Map<string, string>();
  private protectedUntilMs: number | null = null;
  constructor(
    configuration: Readonly<Record<string, unknown>>, permit: VerifiedPostgisExecutionPermit,
    options: Readonly<{transport?: PostgisSnapshotTransport; now?: () => number}> = {},
  ) {
    const document = JSON.parse(json(configuration)) as any;
    const c = document.hosted?.snapshot as PostgisSnapshotGcsConfig;
    if (!c || JSON.stringify(Object.keys(c).sort()) !== JSON.stringify([
      "bucket", "bucketCreatedAt", "maxSnapshotBytes", "prefix", "serviceAccountEmail", "snapshotId"].sort()) ||
      !/^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]$/u.test(c.bucket) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/u.test(c.bucketCreatedAt) || !Number.isFinite(Date.parse(c.bucketCreatedAt)) ||
      c.prefix !== `runs/${document.runId}/snapshots/` || !/^[A-Za-z0-9_-]{1,100}$/u.test(c.snapshotId) ||
      !new RegExp(`^[a-z][a-z0-9-]{4,28}@${document.projectId}\\.iam\\.gserviceaccount\\.com$`, "u").test(c.serviceAccountEmail) ||
      !Number.isSafeInteger(c.maxSnapshotBytes) || c.maxSnapshotBytes < 1024 || c.maxSnapshotBytes > 5 * 1024 ** 3 ||
      document.syntheticOnly !== true || document.projectId === "coupon-app-29446" || !Array.isArray(document.allowedProjectIds) ||
      document.allowedProjectIds.length !== 1 || document.allowedProjectIds[0] !== document.projectId) {
      throw new Error("Invalid isolated snapshot configuration.");
    }
    this.config = Object.freeze({...c});
    this.expected = Object.freeze({projectId: document.projectId, projectNumber: document.projectNumber,
      runId: document.runId, candidateDigest: document.candidateDigest,
      configDigest: digestPostgisConfiguration(document), gate: document.gate, purpose: "execute"});
    const now = options.now ?? Date.now;
    this.check = () => requirePostgisExecutionPermit(permit, {...this.expected, nowMs: now()});
    this.check();
    this.transport = options.transport ?? googleTransport(this.check, c.serviceAccountEmail);
    approvedStores.set(this, Object.freeze({check: this.check, configDigest: this.expected.configDigest, snapshotId: c.snapshotId}));
    registerPostgisRecoveryArtifactReader(this, async (id, previous) => {
      // Optional fast path only. No bucket policy is created or modified here.
      // Generation pinning alone cannot promise an object survives deletion.
      const bucket = await this.bucket();
      if (bucket.retentionPolicy?.isLocked !== true) throw new Error("Bounded source pruning requires separately approved locked snapshot retention; ordinary snapshot reads remain available.");
      const until = previous?.validUntilMs ?? Math.max(permit.cleanupUntilMs, now() + 24 * 60 * 60_000);
      if (!Number.isSafeInteger(until) || until === null || until <= now() || until < permit.cleanupUntilMs) throw new Error("Snapshot retention proof expired before the recovery/cleanup horizon.");
      this.protectedUntilMs = until;
      const envelope = await this.envelope(id);
      if (!envelope) throw new Error("Retained recovery snapshot is unavailable.");
      const identity = sha256(Buffer.from(json({bucket:this.config.bucket,bucketCreatedAt:this.config.bucketCreatedAt,
        generation:this.pinned.get(id),envelope,until})));
      return {kind:"gcs-locked-retention",identity,validUntilMs:until} as PostgisRecoveryArtifactProof;
    });
  }
  private readonly check: () => void;
  assertConfiguration(configuration: Readonly<Record<string, unknown>>, id: string): void {
    requireApprovedPostgisSnapshotStore(this, configuration, id);
  }
  private id(id: string): void {this.check(); if (id !== this.config.snapshotId) throw new Error("Snapshot ID is outside approved scope.");}
  private objectUrl(name: string): string {return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.config.bucket)}/o/${encodeURIComponent(name)}`;}
  private name(id: string, suffix: string): string {this.id(id); return `${this.config.prefix}${id}/${suffix}`;}
  private async request(request: Omit<PostgisSnapshotRequest, "timeoutMs">): Promise<{status: number; body: Buffer}> {
    this.check();
    let result: Awaited<ReturnType<PostgisSnapshotTransport>>;
    try {result = await this.transport({...request, timeoutMs: 15_000});}
    catch {throw new Error("Snapshot provider transport timeout or failure.");}
    this.check();
    if (!Number.isInteger(result.status) || !Buffer.isBuffer(result.body) || result.body.length > request.maxResponseBytes) {
      throw new Error("Invalid snapshot provider response.");
    }
    return result;
  }
  private async bucket(): Promise<any> {
    const result = await this.request({method: "GET", url: `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.config.bucket)}`,
      maxResponseBytes: 128 * 1024});
    if (result.status !== 200) throw new Error(`Snapshot bucket unavailable (${result.status}).`);
    const data = parse(result.body);
    if (data.name !== this.config.bucket || data.projectNumber !== this.expected.projectNumber || data.timeCreated !== this.config.bucketCreatedAt) {
      throw new Error("Snapshot bucket ownership/incarnation mismatch.");
    }
    return data;
  }
  private metadataMatches(data: any, receipt: ObjectReceipt): boolean {
    return data.name === receipt.name && data.bucket === this.config.bucket && data.generation === receipt.generation &&
      data.size === String(receipt.bytes) && data.metadata?.sha256 === receipt.sha256 &&
      data.metadata?.runId === this.expected.runId && data.metadata?.candidateDigest === this.expected.candidateDigest &&
      data.metadata?.configDigest === this.expected.configDigest;
  }
  private async readObject(receipt: ObjectReceipt): Promise<Buffer> {
    const parameters = `generation=${receipt.generation}&ifGenerationMatch=${receipt.generation}`;
    const meta = await this.request({method: "GET", url: `${this.objectUrl(receipt.name)}?${parameters}`, maxResponseBytes: 128 * 1024});
    if (meta.status !== 200 || !this.metadataMatches(parse(meta.body), receipt)) throw new Error("Snapshot object generation/metadata unavailable.");
    if (this.protectedUntilMs !== null) {
      const expiration = Date.parse(parse(meta.body).retentionExpirationTime);
      if (!Number.isFinite(expiration) || expiration < this.protectedUntilMs) throw new Error("Snapshot object retention does not cover the validated recovery horizon.");
    }
    const media = await this.request({method: "GET", url: `${this.objectUrl(receipt.name)}?alt=media&${parameters}`, maxResponseBytes: receipt.bytes});
    if (media.status !== 200 || media.body.length !== receipt.bytes || sha256(media.body) !== receipt.sha256 ||
        parse(meta.body).md5Hash !== md5(media.body)) throw new Error("Snapshot object missing or checksum mismatch.");
    return media.body;
  }
  private async put(name: string, bytes: Buffer): Promise<ObjectReceipt> {
    const hash = sha256(bytes), metadata = {name, md5Hash: md5(bytes), metadata: {
      sha256: hash, runId: this.expected.runId, candidateDigest: this.expected.candidateDigest, configDigest: this.expected.configDigest}};
    const boundary = `snapshot_${hash}`;
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    let result: {status: number; body: Buffer} | undefined;
    try {result = await this.request({method: "POST", url: `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.config.bucket)}/o?uploadType=multipart&ifGenerationMatch=0`,
      contentType: `multipart/related; boundary=${boundary}`, body, maxResponseBytes: 128 * 1024});} catch { /* Reconcile once; never retry an unconstrained write. */ }
    if (result && result.status !== 200 && result.status !== 201 && result.status !== 412 && result.status < 500) {
      throw new Error(`Snapshot object create refused (${result.status}).`);
    }
    // Covers success, duplicate writer and a lost acknowledgement with the exact
    // same receipt checks. Missing/denied is failure, never completion evidence.
    const found = await this.request({method: "GET", url: this.objectUrl(name), maxResponseBytes: 128 * 1024});
    if (found.status !== 200) throw new Error(`Snapshot upload is incomplete (${found.status}).`);
    const data = parse(found.body);
    if (!generation(data.generation)) throw new Error("Invalid snapshot object generation.");
    const receipt = {name, generation: data.generation, bytes: bytes.length, sha256: hash};
    if (!this.metadataMatches(data, receipt)) throw new Error("Conflicting immutable snapshot object.");
    await this.readObject(receipt);
    return receipt;
  }
  private async envelope(id: string): Promise<Envelope | null> {
    this.id(id); await this.bucket();
    const name = this.name(id, "manifest.json");
    const result = await this.request({method: "GET", url: this.objectUrl(name), maxResponseBytes: 128 * 1024});
    if (result.status === 404 && !this.pinned.has(id)) return null;
    if (result.status !== 200) throw new Error("Snapshot manifest is unavailable.");
    const data = parse(result.body), size = Number(data.size);
    if (!generation(data.generation) || !Number.isSafeInteger(size) || size < 1 || size > envelopeBytes ||
        (this.pinned.has(id) && this.pinned.get(id) !== data.generation)) throw new Error("Snapshot manifest generation changed or is invalid.");
    const receipt = {name, generation: data.generation, bytes: size, sha256: data.metadata?.sha256};
    if (!/^[a-f0-9]{64}$/u.test(receipt.sha256)) throw new Error("Snapshot manifest checksum missing.");
    const envelope = parse(await this.readObject(receipt)) as Envelope;
    if (envelope.protocol !== protocol || json(envelope.binding) !== json(this.expected) ||
        envelope.manifest?.snapshotId !== id || !Array.isArray(envelope.chunks) || envelope.chunks.length > 20_000 ||
        !Number.isSafeInteger(envelope.dataBytes) || envelope.dataBytes < 0 ||
        envelope.dataBytes + size > this.config.maxSnapshotBytes) throw new Error("Snapshot manifest scope/completeness is invalid.");
    validatePostgisSourceFence(envelope.manifest.fence);
    let total = 0, count = 0, previous = "";
    for (const [index, chunk] of envelope.chunks.entries()) {
      if (chunk.name !== this.name(id, `rows-${String(index).padStart(6, "0")}.jsonl`) || !generation(chunk.generation) ||
          !Number.isInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > chunkBytes || !/^[a-f0-9]{64}$/u.test(chunk.sha256) ||
          !Number.isInteger(chunk.count) || chunk.count < 1 || chunk.count > 500 ||
          typeof chunk.first !== "string" || typeof chunk.last !== "string" || chunk.first <= previous || chunk.last < chunk.first) {
        throw new Error("Snapshot chunk manifest is incomplete or unordered.");
      }
      previous = chunk.last; total += chunk.bytes; count += chunk.count;
    }
    if (total !== envelope.dataBytes || count !== envelope.manifest.rowCount) throw new Error("Snapshot manifest totals mismatch.");
    this.pinned.set(id, data.generation);
    return envelope;
  }
  async readRecoveryManifest(id: string): Promise<PostgisRecoveryManifest | null> {return (await this.envelope(id))?.manifest ?? null;}
  async readRecoveryRows(id: string, after: string | null, limit: number): Promise<readonly PostgisRecoveryRow[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid snapshot page bound.");
    const envelope = await this.envelope(id);
    if (!envelope) throw new Error("Snapshot manifest is missing.");
    const rows: PostgisRecoveryRow[] = [];
    for (const chunk of envelope.chunks) {
      if (after !== null && chunk.last <= after) continue;
      const text = (await this.readObject(chunk)).toString("utf8");
      if (!text.endsWith("\n")) throw new Error("Snapshot chunk is truncated.");
      const lines = text.slice(0, -1).split("\n");
      if (lines.length !== chunk.count || lines.some(line => !line || Buffer.byteLength(line) > 128 * 1024)) throw new Error("Invalid snapshot row framing.");
      const page = lines.map(line => parse(Buffer.from(line)) as PostgisRecoveryRow);
      let previous = "";
      for (const row of page) {
        const identity = postgisRecoveryIdentity(row);
        if (identity <= previous) throw new Error("Snapshot rows are unordered.");
        previous = identity;
      }
      if (postgisRecoveryIdentity(page[0]) !== chunk.first || previous !== chunk.last) throw new Error("Snapshot chunk boundary mismatch.");
      for (const row of page) if (after === null || postgisRecoveryIdentity(row) > after) {
        rows.push(row); if (rows.length === limit) return rows;
      }
    }
    return rows;
  }
  async publish(reader: PostgisRecoverySnapshotReader, manifest: PostgisRecoveryManifest): Promise<void> {
    this.id(manifest.snapshotId);
    await validatePostgisRecoverySnapshot(reader, manifest);
    await this.bucket();
    const chunks: Chunk[] = [];
    let after: string | null = null, dataBytes = 0;
    while (true) {
      const rows = await reader.readRecoveryRows(manifest.snapshotId, after, 500);
      if (!rows.length) break;
      let batch: PostgisRecoveryRow[] = [], bytes = 0;
      const flush = async (): Promise<void> => {
        if (!batch.length) return;
        const payload = Buffer.from(batch.map(row => json(row) + "\n").join(""));
        dataBytes += payload.length;
        if (dataBytes > this.config.maxSnapshotBytes - envelopeBytes || chunks.length >= 20_000) throw new Error("Snapshot exceeds its reserved storage bound.");
        const receipt = await this.put(this.name(manifest.snapshotId, `rows-${String(chunks.length).padStart(6, "0")}.jsonl`), payload);
        chunks.push({...receipt, count: batch.length, first: postgisRecoveryIdentity(batch[0]), last: postgisRecoveryIdentity(batch[batch.length - 1])});
        batch = []; bytes = 0;
      };
      for (const row of rows) {
        const length = Buffer.byteLength(json(row)) + 1;
        if (length > 128 * 1024) throw new Error("Snapshot row exceeds its bound.");
        if (bytes + length > chunkBytes) await flush();
        batch.push(row); bytes += length; after = postgisRecoveryIdentity(row);
      }
      await flush();
      if (rows.length < 500) break;
    }
    // Validate the source again before the terminal commit, then validate the
    // actual remote bytes. A local success flag never authorizes journal prune.
    await validatePostgisRecoverySnapshot(reader, manifest);
    const envelope: Envelope = {protocol, binding: this.expected, manifest, chunks, dataBytes};
    const payload = Buffer.from(json(envelope));
    if (payload.length > envelopeBytes || dataBytes + payload.length > this.config.maxSnapshotBytes) throw new Error("Snapshot envelope exceeds its bound.");
    const receipt = await this.put(this.name(manifest.snapshotId, "manifest.json"), payload);
    this.pinned.set(manifest.snapshotId, receipt.generation);
    await validatePostgisRecoverySnapshot(this, manifest);
  }
}
