import {
  foodAliasGroups,
  foodCategoryBlueprints,
  foodDiacritics,
  foodDirectionalAliasGroups,
} from "./customer_bitescore_search_matcher_data.js";

// Keep these semantics aligned with BiteScoreFoodSearch and BitescoreCategories.
// In particular, do not replace the reviewed diacritic map with Unicode NFD:
// that changes the existing product's matching behavior.
export function normalizeBiteScoreFood(value: string): string {
  let result = value;
  for (const [from, to] of Object.entries(foodDiacritics)) {
    result = result.split(from).join(to).split(from.toUpperCase()).join(to);
  }
  return result.trim().toLowerCase().replace(/&/gu, " and ")
    .replace(/[\u2018\u2019\u201b\u2032']/gu, "")
    .replace(/[^a-z0-9]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function singular(value: string): string {
  if (value.length > 3 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 4 && /(?:ches|shes|sses|xes|zes)$/u.test(value)) {
    return value.slice(0, -2);
  }
  return value.length > 3 && value.endsWith("s") ? value.slice(0, -1) : value;
}

export function biteScoreFoodTerms(value: string): Set<string> {
  const normalized = normalizeBiteScoreFood(value);
  if (!normalized) return new Set();
  const terms = new Set([normalized]);
  const tokens = normalized.split(" ");
  if (tokens.length > 1) {
    terms.add(tokens.join(""));
    const last = tokens[tokens.length - 1];
    if (singular(last) !== last) {
      terms.add([...tokens.slice(0, -1), singular(last)].join(" "));
    }
  }
  for (const token of tokens) {
    terms.add(token);
    terms.add(singular(token));
  }
  return terms;
}

function aliasValueTerms(value: string): Set<string> {
  const normalized = normalizeBiteScoreFood(value);
  const terms = new Set([normalized]);
  const tokens = normalized.split(" ");
  if (tokens.length > 1) {
    terms.add(tokens.join(""));
    const last = tokens[tokens.length - 1];
    if (singular(last) !== last) {
      terms.add([...tokens.slice(0, -1), singular(last)].join(" "));
    }
  } else {
    terms.add(singular(normalized));
  }
  terms.delete("");
  return terms;
}

const aliases = new Map<string, Set<string>>();
function addAliasGroup(from: readonly string[], to: readonly string[]): void {
  const lookups = new Set(from.flatMap((v) => [...biteScoreFoodTerms(v)]));
  const expanded = new Set([...from, ...to].flatMap((v) => [...aliasValueTerms(v)]));
  for (const term of lookups) {
    if (term.includes(" ") || term.length >= 2) {
      aliases.set(term, new Set([...(aliases.get(term) ?? []), ...expanded]));
    }
  }
}
for (const group of foodAliasGroups) addAliasGroup(group, []);
for (const group of foodDirectionalAliasGroups) addAliasGroup(group.from_, group.to);
const stopWords = new Set(["and", "the", "with"]);

function queryTerms(normalized: string): string[] {
  if (normalized.includes(" ")) {
    const tokens = normalized.split(" ").filter((v) => v && !stopWords.has(v));
    return tokens.length === 0 ? [normalized] : tokens;
  }
  return [...biteScoreFoodTerms(normalized)].filter((v) => !stopWords.has(v));
}

function sourceMatches(source: Set<string>, candidates: Iterable<string>): boolean {
  for (const term of candidates) {
    if (!term) continue;
    if (source.has(term) ||
        (term.length >= 4 && [...source].some((v) => v.includes(term))) ||
        (term.includes(" ") && source.has(term.replace(/ /gu, "")))) return true;
  }
  return false;
}

function fuzzy(query: string, candidate: string): boolean {
  if (query === candidate || query.length < 4 || candidate.length < 4) {
    return query === candidate;
  }
  if (Math.abs(query.length - candidate.length) > 2 || query[0] !== candidate[0]) {
    return false;
  }
  const maximum = query.length <= 6 ? 1 : 2;
  // Three rows preserve the original optimal-string-alignment distance while
  // bounding memory independently of a long source field.
  let previous = Array.from({length: candidate.length + 1}, (_, i) => i);
  let preceding = previous;
  for (let i = 1; i <= query.length; i += 1) {
    const current = [i];
    let minimum = i;
    for (let j = 1; j <= candidate.length; j += 1) {
      let value = Math.min(current[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (query[i - 1] === candidate[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && query[i - 1] === candidate[j - 2] &&
          query[i - 2] === candidate[j - 1]) {
        value = Math.min(value, preceding[j - 2] + 1);
      }
      current.push(value);
      minimum = Math.min(minimum, value);
    }
    if (minimum > maximum) return false;
    preceding = previous;
    previous = current;
  }
  const distance = previous[candidate.length];
  const longest = Math.max(query.length, candidate.length);
  return distance <= maximum && (longest - distance) / longest >= 0.72;
}

function tokensMatch(query: string[], source: Set<string>, alias: boolean,
  enableFuzzy: boolean): boolean {
  return query.every((term) => {
    const candidates = new Set([term, singular(term),
      ...(alias ? aliases.get(term) ?? [] : [])]);
    if (sourceMatches(source, candidates)) return true;
    if (!enableFuzzy || term.length < 4) return false;
    const fuzzyCandidates = new Set<string>();
    for (const known of aliases.keys()) {
      if (fuzzy(term, known)) {
        fuzzyCandidates.add(known);
        if (alias) for (const expanded of aliases.get(known) ?? []) {
          fuzzyCandidates.add(expanded);
        }
      }
    }
    for (const candidate of source) if (fuzzy(term, candidate)) {
      fuzzyCandidates.add(candidate);
    }
    return sourceMatches(source, fuzzyCandidates);
  });
}

export function matchesBiteScorePlainText(source: string, query: string): boolean {
  const normalized = normalizeBiteScoreFood(query);
  const text = normalizeBiteScoreFood(source);
  if (!normalized || text.includes(normalized)) return true;
  const terms = queryTerms(normalized);
  return terms.length > 0 && tokensMatch(terms, biteScoreFoodTerms(text), false, false);
}

export function matchesBiteScoreFood(sources: readonly string[], query: string,
  enableFuzzy = false): boolean {
  const normalized = normalizeBiteScoreFood(query);
  if (!normalized) return true;
  const texts = sources.map(normalizeBiteScoreFood).filter(Boolean);
  const source = new Set(texts.flatMap((v) => [...biteScoreFoodTerms(v)]));
  if (source.size === 0) return false;
  if (texts.some((v) => v === normalized ||
      (normalized.length >= 4 && v.includes(normalized)))) return true;
  if (sourceMatches(source, aliases.get(normalized) ?? [])) return true;
  const terms = queryTerms(normalized);
  return terms.length > 0 && tokensMatch(terms, source, true, enableFuzzy);
}

export function biteScoreCategoryTerms(value: {
  category?: string; subcategory?: string; categoryManualKeywords?: string;
  categoryTags?: readonly string[];
}): string[] {
  const tags = new Set<string>();
  const add = (text: string | undefined): void => {
    const normalized = (text ?? "").trim().toLowerCase()
      .replace(/’/gu, "'").replace(/\s+/gu, " ");
    if (!normalized) return;
    tags.add(normalized);
    for (const part of normalized.split("/")) if (part.trim()) tags.add(part.trim());
    for (const word of normalized.split(/[^a-z0-9]+/u)) {
      if (word.length >= 3 && !stopWords.has(word)) {
        tags.add(word);
        tags.add(singular(word));
      }
    }
  };
  const category = foodCategoryBlueprints.find((v) =>
    v.name.toLowerCase() === (value.category ?? "").trim().toLowerCase());
  add(category?.name ?? value.category);
  if (category) for (const tag of category.tags) add(tag);
  add(value.subcategory);
  const subcategory = (value.subcategory ?? "").trim().toLowerCase();
  if (subcategory === "french fries") add("Fries / loaded fries");
  if (subcategory === "fries / loaded fries") add("French Fries");
  for (const text of (value.categoryManualKeywords ?? "").split(",")) add(text);
  const classification = normalizeBiteScoreFood(value.subcategory ?? "");
  if (["cuban sandwich", "cuban sandwiches", "cubano"].includes(classification)) {
    for (const text of ["cuban_sandwich", "cuban sandwich", "cubano", "cuban",
      "deli_sandwiches", "deli", "sandwich", "sandwiches", category?.id]) add(text);
  }
  if (["chicken pie", "chicken pies", "chicken pot pie", "chicken pot pies",
    "chicken pie chicken pot pie"].includes(classification)) {
    for (const text of ["chicken_pie", "chicken pie", "chicken pies",
      "chicken pot pie", "chicken pot pies", "pot pie", "pot pies", "american",
      category?.id]) add(text);
  }
  return [...tags, ...(value.categoryTags ?? [])];
}

export function normalizeBiteScoreFinderText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim()
    .replace(/\s+/gu, " ");
}

export function biteScoreFinderNameScore(query: string, restaurantName: string): number {
  const normalize = (v: string): string => v.toLowerCase().replace(/&/gu, " and ")
    .replace(/[’'`]+/gu, "").replace(/[^a-z0-9]+/gu, " ").trim()
    .replace(/\s+/gu, " ");
  const text = normalize(restaurantName);
  const needle = normalize(query);
  if (!needle || !text) return 0;
  if (text === needle) return 100;
  if (text.startsWith(needle)) return 90;
  if (text.includes(needle)) return 80;
  const tokens = (v: string): Set<string> => new Set(v.split(" ").filter(Boolean)
    .flatMap((t) => t.length > 3 && t.endsWith("s") ? [t, t.slice(0, -1)] : [t]));
  const queryTokens = tokens(needle);
  const nameTokens = tokens(text);
  const matched = [...queryTokens].filter((t) => nameTokens.has(t) ||
    [...nameTokens].some((n) => t.length >= 3 && n.startsWith(t))).length;
  if (matched === queryTokens.size) return 70;
  return matched > 0 && matched === queryTokens.size - 1 ? 55 : 0;
}

export function biteScoreFinderCloseScore(query: string, restaurantName: string): number {
  const left = normalizeBiteScoreFinderText(query);
  const right = normalizeBiteScoreFinderText(restaurantName);
  if (left === right) return 2; // Existing exact-match decision precedes the close-match dialog.
  if (left.includes(right) || right.includes(left)) return 1;
  if (left.startsWith(right) || right.startsWith(left)) return 0.92;
  const tokens = (v: string): Set<string> => new Set(v.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean));
  const a = tokens(query);
  const b = tokens(restaurantName);
  const union = new Set([...a, ...b]);
  const shared = [...a].filter((v) => b.has(v)).length;
  const tokenScore = union.size === 0 ? 0 : shared / union.size;
  let previous = Array.from({length: right.length + 1}, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current.push(Math.min(current[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)));
    }
    previous = current;
  }
  const longest = Math.max(left.length, right.length);
  const score = Math.max(tokenScore, longest === 0 ? 0 : 1 - previous[right.length] / longest);
  return score >= 0.55 ? score : 0;
}
