import {request as httpsRequest} from "node:https";

export const reviewTextModel = "omni-moderation-latest";
export const reviewTextPolicy = "openai-clean-or-human-v1";
export const reviewTextCategories = [
  "harassment", "harassment/threatening", "hate", "hate/threatening",
  "illicit", "illicit/violent", "self-harm", "self-harm/intent",
  "self-harm/instructions", "sexual", "sexual/minors", "violence", "violence/graphic",
] as const;
export type ReviewTextSignal = Readonly<{
  model: string; requestId: string; flagged: boolean;
  categories: Readonly<Record<string, boolean>>;
  scores: Readonly<Record<string, number>>;
}>;
export interface ReviewTextProvider {
  screen(headline: string, notes: string): Promise<ReviewTextSignal>;
}
export function validateReviewText(headline: string, notes: string): void {
  if (headline.length > 200 || notes.length > 4000 ||
      Buffer.byteLength(headline + notes, "utf8") > 16800) {
    throw new Error("Review text exceeds the screening limit.");
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid moderation response.");
  return value as Record<string, unknown>;
}
/** Fail closed on schema changes; an alias or dated omni model is audited verbatim. */
export function parseReviewTextSignal(value: unknown): ReviewTextSignal {
  const root = record(value);
  if (typeof root.id !== "string" || !/^modr-[A-Za-z0-9_-]{1,180}$/.test(root.id) ||
      typeof root.model !== "string" || !/^omni-moderation-(latest|\d{4}-\d{2}-\d{2})$/.test(root.model) ||
      !Array.isArray(root.results) || root.results.length !== 1) throw new Error("Invalid moderation identity or cardinality.");
  const result = record(root.results[0]);
  const categories = record(result.categories), scores = record(result.category_scores);
  const types = record(result.category_applied_input_types);
  const expected = [...reviewTextCategories].sort().join(",");
  if (typeof result.flagged !== "boolean" || [categories, scores, types].some(v => Object.keys(v).sort().join(",") !== expected)) {
    throw new Error("Invalid moderation categories.");
  }
  for (const key of reviewTextCategories) {
    if (typeof categories[key] !== "boolean" || typeof scores[key] !== "number" ||
        !Number.isFinite(scores[key]) || (scores[key] as number) < 0 || (scores[key] as number) > 1 ||
        !Array.isArray(types[key]) || (types[key] as unknown[]).length !== 1 || (types[key] as unknown[])[0] !== "text") {
      throw new Error("Invalid moderation category value.");
    }
  }
  // Inconsistent broad/category flags are held, never interpreted as permission.
  return {model: root.model, requestId: root.id,
    flagged: result.flagged || Object.values(categories).some(v => v === true),
    categories: categories as Record<string, boolean>, scores: scores as Record<string, number>};
}
export type ModerationTransport = (body: string, apiKey: string) => Promise<unknown>;
/** Fixed host/path; no redirects, raw error logging, SDK retries or metadata. */
export const moderationHttpsTransport: ModerationTransport = (body, apiKey) => new Promise((resolve, reject) => {
  const req = httpsRequest({hostname: "api.openai.com", path: "/v1/moderations", method: "POST",
    headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body)}}, res => {
    let size = 0;
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32768) { req.destroy(new Error("Moderation response too large.")); return; }
      chunks.push(chunk);
    });
    res.on("error", () => reject(new Error("Moderation unavailable.")));
    res.on("end", () => {
      if (res.statusCode !== 200) { reject(new Error("Moderation unavailable.")); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Invalid moderation JSON.")); }
    });
  });
  const timer = setTimeout(() => req.destroy(new Error("Moderation timeout.")), 8000);
  req.on("close", () => clearTimeout(timer));
  req.on("error", () => reject(new Error("Moderation unavailable.")));
  req.end(body);
});
let inFlight = 0;
export class OpenAIReviewTextProvider implements ReviewTextProvider {
  constructor(private readonly apiKey: () => string,
    private readonly transport: ModerationTransport = moderationHttpsTransport) {}
  async screen(headline: string, notes: string): Promise<ReviewTextSignal> {
    validateReviewText(headline, notes);
    if (inFlight >= 2) throw new Error("Moderation busy.");
    const key = this.apiKey();
    if (!key || /[\r\n]/.test(key)) throw new Error("Moderation unconfigured.");
    inFlight++;
    try {
      const body = JSON.stringify({model: reviewTextModel, input: `Headline:\n${headline}\n\nReview:\n${notes}`});
      return parseReviewTextSignal(await this.transport(body, key));
    } finally { inFlight--; }
  }
}
