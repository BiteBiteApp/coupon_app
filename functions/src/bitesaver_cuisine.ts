import {foodCategoryBlueprints} from "./customer_bitescore_search_matcher_data.js";

// Same bounded public cuisine limits used by the existing catalog projection.
export const maximumBiteSaverCuisines = 32;
export const maximumBiteSaverCuisineLength = 100;

export function normalizeBiteSaverCuisines(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumBiteSaverCuisines) {
    throw new Error("Enter no more than 32 cuisines.");
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || /[\p{Cc}\p{Cf}\p{Cs},]/u.test(raw) ||
        Array.from(raw).length > maximumBiteSaverCuisineLength) {
      throw new Error("Each cuisine must be a single line of 100 characters or fewer.");
    }
    const text = raw.trim().replace(/\s+/gu, " ");
    if (!text || !/\p{L}/u.test(text)) {
      throw new Error("Enter a cuisine name, such as Barbecue or American.");
    }
    const key = text.toLowerCase();
    if (!seen.has(key)) { seen.add(key); result.push(text); }
  }
  return Object.freeze(result);
}

export function publicBiteSaverCuisines(value: unknown): readonly string[] {
  try { return normalizeBiteSaverCuisines(value ?? []); } catch { return Object.freeze([]); }
}

// Keep aligned with the existing BiteSaver query normalizer, not fuzzy food matching.
function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/[\u2018\u2019\u201b\u2032']/gu, "")
    .replace(/[^a-z0-9]+/gu, " ").replace(/\s+/gu, " ").trim();
}
const bbq = foodCategoryBlueprints.find((category) => category.id === "bbq")!;
const bbqAliases = [...new Set([bbq.name, ...bbq.tags].map(normalizeSearch))]
  .sort((a, b) => b.length - a.length);
function canonicalSearch(value: string): string {
  let result = ` ${normalizeSearch(value)} `;
  for (const alias of bbqAliases) result = result.split(` ${alias} `).join(" bbq ");
  return result.trim();
}
export function biteSaverCuisineMatches(query: string, cuisines: unknown): boolean {
  const needle = canonicalSearch(query);
  return needle.length > 0 && publicBiteSaverCuisines(cuisines).some((value) =>
    ` ${canonicalSearch(value)} `.includes(` ${needle} `));
}
