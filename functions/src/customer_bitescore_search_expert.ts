import {foodCategoryBlueprints} from "./customer_bitescore_search_matcher_data.js";
import {customerBiteScoreExpertTypes} from "./customer_bitescore_search_expert_data.js";
import {matchesBiteScoreFood, normalizeBiteScoreFood} from "./customer_bitescore_search_matcher.js";

const term = (value: string): string => value.trim().toLowerCase().replace(/’/gu, "'").replace(/\s+/gu, " ");
const has = (values: readonly string[], value: string): boolean => !!value && values.some((v) => term(v) === value);

/** Exact LocalExperts.matchDishes qualification; no new badge/points policy. */
export function customerBiteScoreExpertMatches(dish: Readonly<Record<string, unknown>>, expertId: string): boolean {
  const type = customerBiteScoreExpertTypes.find((v) => v.id === expertId);
  if (!type) return false;
  const text = (key: string): string => typeof dish[key] === "string" ? dish[key] : "";
  const rawCategory = text("category");
  const category = foodCategoryBlueprints.find((v) => term(v.name) === term(rawCategory));
  const categoryId = category?.id ?? "";
  const categoryName = term(category?.name ?? rawCategory);
  const subcategory = term(text("subcategory"));
  const tags = Array.isArray(dish.categoryTags) ? dish.categoryTags.filter((v): v is string => typeof v === "string") : [];
  const sources = [text("displayName"), text("subcategory"), ...tags].map((v) => v.trim()).filter(Boolean);
  const aliases = (values: readonly string[]): boolean => values.some((value) => matchesBiteScoreFood(sources, value));
  if (has(type.excludedCategoryIds, categoryId) || has(type.excludedCategoryNames, categoryName) ||
      has(type.excludedSubcategories, subcategory) || aliases(type.excludedAliases)) return false;
  if (has(type.mappedSubcategories, subcategory) || aliases(type.aliases)) return true;
  const normalizedSources = new Set(sources.map(normalizeBiteScoreFood).filter(Boolean));
  if (type.exactAliases.some((v) => normalizedSources.has(normalizeBiteScoreFood(v)))) return true;
  return type.categoryMayQualify && (has(type.mappedCategoryIds, categoryId) || has(type.mappedCategoryNames, categoryName));
}

export function customerBiteScoreExpertIdIsValid(value: string): boolean {
  return customerBiteScoreExpertTypes.some((v) => v.id === value);
}
