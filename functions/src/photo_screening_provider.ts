import {GoogleAuth} from "google-auth-library";

export const safeSearchCategories = ["adult", "violence", "racy", "medical", "spoof"] as const;
export const safeSearchLikelihoods = ["UNKNOWN", "VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"] as const;
export type SafeSearchResult = Record<typeof safeSearchCategories[number], typeof safeSearchLikelihoods[number]>;
export interface PhotoScreeningProvider {
  readonly name: string;
  screen(bytes: Buffer): Promise<SafeSearchResult>;
}
export function parseSafeSearch(value: unknown): SafeSearchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid SafeSearch response");
  const result = {} as SafeSearchResult;
  for (const key of safeSearchCategories) {
    const likelihood = (value as Record<string, unknown>)[key];
    if (!safeSearchLikelihoods.includes(likelihood as never)) throw new Error("Invalid SafeSearch likelihood");
    result[key] = likelihood as SafeSearchResult[typeof key];
  }
  return result;
}
/** Conservative candidate policy; no automatic rejection rule is approved.
 * Medical/spoof are recorded but never themselves treated as objectionable. */
export function classifySafeSearch(value: unknown): "approved" | "needs_review" {
  const result = parseSafeSearch(value);
  return [result.adult, result.violence, result.racy].every(v => v === "VERY_UNLIKELY" || v === "UNLIKELY") ? "approved" : "needs_review";
}
/** Official REST API with server ADC. One request, SafeSearch only, no library
 * retries. Constructed lazily ONLY after durable application admission. */
export class GoogleSafeSearchProvider implements PhotoScreeningProvider {
  readonly name = "google-vision-safesearch-v1";
  async screen(bytes: Buffer): Promise<SafeSearchResult> {
    if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.NODE_ENV === "test") {
      throw new Error("Real Vision requests are disabled in local tests");
    }
    const auth = new GoogleAuth({scopes: ["https://www.googleapis.com/auth/cloud-platform"]});
    const client = await auth.getClient();
    const response = await client.request<{responses?: {safeSearchAnnotation?: unknown; error?: unknown}[]}>({
      url: "https://vision.googleapis.com/v1/images:annotate", method: "POST", timeout: 20_000,
      retry: false, data: {requests: [{image: {content: bytes.toString("base64")}, features: [{type: "SAFE_SEARCH_DETECTION"}]}]},
    });
    if (response.data.responses?.length !== 1 || response.data.responses[0].error) throw new Error("SafeSearch failed");
    return parseSafeSearch(response.data.responses[0].safeSearchAnnotation);
  }
}
