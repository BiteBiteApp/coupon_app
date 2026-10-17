import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import type {DecodedIdToken} from "firebase-admin/auth";
import {postgisStagingCallableNames} from "./postgis_staging_runtime.js";
import {requireHostedPostgisConfiguration, type HostedPostgisConfiguration} from "./postgis_hosted_runtime.js";
import type {VerifiedPostgisExecutionPermit} from "./postgis_execution_approval.js";

export type HostedCallableTransport = Readonly<{
  verifyIdToken(token: string): Promise<DecodedIdToken>;
  verifyAppCheckToken(token: string): Promise<{app_id: string; token: Record<string, unknown>}>;
  invoke(name: string, request: CallableRequest<unknown>): Promise<unknown>;
}>;
function invalid(): never {throw new HttpsError("invalid-argument", "Invalid callable request.");}
function decode(value: unknown, depth = 0): unknown {
  if (depth > 30) invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {if (!Number.isFinite(value)) invalid();return value;}
  if (Array.isArray(value)) return value.map(item => decode(item, depth + 1));
  if (!value || typeof value !== "object") invalid();
  const object = value as Record<string, unknown>;
  if (object["@type"] === "type.googleapis.com/google.protobuf.Int64Value" ||
      object["@type"] === "type.googleapis.com/google.protobuf.UInt64Value") {
    if (Object.keys(object).sort().join(",") !== "@type,value" || typeof object.value !== "string" ||
        !/^-?(0|[1-9][0-9]*)$/u.test(object.value) || !Number.isSafeInteger(Number(object.value)) ||
        (object["@type"].includes("UInt") && Number(object.value) < 0)) invalid();
    return Number(object.value);
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, decode(item, depth + 1)]));
}
async function dataFrom(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "") ||
      request.headers["content-encoding"] !== undefined) invalid();
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512 * 1024) throw new HttpsError("resource-exhausted", "Request exceeds the callable bound.");
    chunks.push(Buffer.from(chunk));
  }
  let value: unknown;
  try {value = JSON.parse(Buffer.concat(chunks).toString("utf8"));} catch {invalid();}
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join(",") !== "data") invalid();
  return decode((value as {data: unknown}).data);
}
function tokenFrom(request: IncomingMessage, header: string, bearer = false): string | undefined {
  const value = request.headers[header];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 16_384 ||
      (bearer ? !/^Bearer [^\s]+$/u.test(value) : !/^[^\s]+$/u.test(value))) throw new HttpsError("unauthenticated", "Invalid authentication.");
  return bearer ? value.slice(7) : value;
}
function safe(error: unknown): HttpsError {
  return error instanceof HttpsError ? error : new HttpsError("internal", "Search is temporarily unavailable.");
}
const standardHeaders = new Set(["host", "connection", "content-length", "content-type", "authorization", "accept", "accept-language",
  "accept-encoding", "user-agent", "origin", "referer", "firebase-instance-id-token", "x-firebase-appcheck", "x-cloud-trace-context",
  "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "traceparent", "tracestate", "sec-fetch-site", "sec-fetch-mode",
  "sec-fetch-dest", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"]);
/** Callable-compatible, bounded HTTP transport. The supplied Auth SDK verifies
 * issuer/audience/signature against this explicitly selected isolated project.
 * Native identity helpers consume only that verified token; guest calls remain
 * unprivileged. This transport never accepts UID/admin hints in headers/body.
 */
export function createHostedPostgisRequestListener(configuration: HostedPostgisConfiguration,
  permit: VerifiedPostgisExecutionPermit, transport: HostedCallableTransport) {
  configuration = JSON.parse(JSON.stringify(configuration)) as HostedPostgisConfiguration;
  requireHostedPostgisConfiguration(configuration, permit);
  let inFlight = 0;
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");response.setHeader("vary", "Origin");
    // The platform timeout alone leaves HTTP work alive. Bound the response
    // here, while retaining its admission slot until native work settles. This
    // prevents timed-out SDK requests from admitting unbounded replacement work.
    const responseDeadline = setTimeout(() => {
      if (!response.writableEnded) {
        response.statusCode = 504;
        response.end(JSON.stringify({error: {status: "DEADLINE_EXCEEDED", message: "Search request timed out."}}));
      }
    }, 25_000);
    let admitted = false;
    try {
      requireHostedPostgisConfiguration(configuration, permit);
      const name = (request.url ?? "").slice(1);
      if (!(postgisStagingCallableNames as readonly string[]).includes(name)) throw new HttpsError("not-found", "Unknown candidate callable.");
      const origin = request.headers.origin;
      if (origin !== undefined) {
        if (!configuration.hosted.allowedOrigins.includes(origin)) throw new HttpsError("permission-denied", "Origin is not approved.");
        response.setHeader("access-control-allow-origin", origin);
      }
      if (request.method === "OPTIONS") {
        if (!origin || request.headers["access-control-request-method"] !== "POST" ||
            String(request.headers["access-control-request-headers"] ?? "").split(",").filter(Boolean)
              .some(header => !["content-type", "authorization", "x-firebase-appcheck", "firebase-instance-id-token"].includes(header.trim().toLowerCase()))) invalid();
        response.setHeader("access-control-allow-methods", "POST");
        response.setHeader("access-control-allow-headers", "Content-Type, Authorization, X-Firebase-AppCheck, Firebase-Instance-ID-Token");
        response.setHeader("access-control-max-age", "300");response.statusCode = 204;request.resume();response.end();return;
      }
      if (request.method !== "POST" || Object.keys(request.headers).some(header => !standardHeaders.has(header))) invalid();
      if (inFlight >= 4) throw new HttpsError("resource-exhausted", "The candidate is busy. Retry the request.");
      admitted = true;inFlight++;
      const data = await dataFrom(request);
      let auth: CallableRequest<unknown>["auth"], app: CallableRequest<unknown>["app"];
      const rawToken = tokenFrom(request, "authorization", true);
      if (rawToken) {
        let decoded: DecodedIdToken;
        try {decoded = await transport.verifyIdToken(rawToken);} catch {throw new HttpsError("unauthenticated", "Invalid authentication.");}
        if (!decoded.uid || decoded.aud !== configuration.projectId || decoded.iss !== `https://securetoken.google.com/${configuration.projectId}`) {
          throw new HttpsError("unauthenticated", "Invalid authentication.");
        }
        auth = {uid: decoded.uid, token: decoded, rawToken};
      }
      const appToken = tokenFrom(request, "x-firebase-appcheck");
      if (configuration.hosted.enforceAppCheck && !appToken) throw new HttpsError("unauthenticated", "App verification is required.");
      if (appToken) {
        try {const decoded = await transport.verifyAppCheckToken(appToken);app = {appId: decoded.app_id, token: decoded.token} as CallableRequest<unknown>["app"];}
        catch {throw new HttpsError("unauthenticated", "Invalid app verification.");}
      }
      const result = await transport.invoke(name, {data, auth, app, rawRequest: request, acceptsStreaming: false,
        instanceIdToken: tokenFrom(request, "firebase-instance-id-token")} as CallableRequest<unknown>);
      const body = JSON.stringify({result});
      if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new HttpsError("resource-exhausted", "Response exceeds the callable bound.");
      if (!response.writableEnded) response.end(body);
    } catch (error) {
      request.resume();
      if (!response.writableEnded) {
        const failure = safe(error);response.statusCode = failure.httpErrorCode.status;
        response.end(JSON.stringify({error: {status: failure.httpErrorCode.canonicalName, message: failure.message}}));
      }
    } finally {clearTimeout(responseDeadline);if (admitted) inFlight--;}
  };
}
/** Explicit Cloud Run bind. No listener is created during module import. */
export async function startHostedPostgisHttpHost(configuration: HostedPostgisConfiguration,
  permit: VerifiedPostgisExecutionPermit, transport: HostedCallableTransport, port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid approved HTTP port.");
  const server = createServer(createHostedPostgisRequestListener(configuration, permit, transport));
  server.requestTimeout = 10_000;server.headersTimeout = 5000;server.keepAliveTimeout = 1000;server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => {server.once("error", reject);server.listen(port, "0.0.0.0", resolve);});
  return {async close() {await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {server.closeAllConnections();resolve();}, 2000);
    server.close(error => {clearTimeout(timer);if (error) reject(error);else resolve();});
  });}};
}
