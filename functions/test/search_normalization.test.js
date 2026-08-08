"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SearchNormalizationError,
  buildCityStateKey,
  buildWordPrefixTokens,
  maximumSearchNameLength,
  maximumWordPrefixTokenCount,
  normalizeCityName,
  normalizeSearchName,
  normalizeStateCode,
  normalizeZip5,
} = require("../lib/search_normalization.js");

function rejectsNormalization(operation) {
  assert.throws(operation, SearchNormalizationError);
}

test("ZIP normalization preserves five digits and leading zero", () => {
  assert.equal(normalizeZip5("34461"), "34461");
  assert.equal(normalizeZip5(" 01234 "), "01234");
});

test("ZIP+4 normalization returns the five-digit base", () => {
  assert.equal(normalizeZip5(" 34461-1234 "), "34461");
});

test("ZIP normalization rejects malformed strings and numeric input", () => {
  for (const value of ["3446", "344611", "34A61", "34461-123", "", 34461]) {
    rejectsNormalization(() => normalizeZip5(value));
  }
});

test("state normalization trims, uppercases, and accepts US/DC codes", () => {
  assert.equal(normalizeStateCode(" fl "), "FL");
  assert.equal(normalizeStateCode("dc"), "DC");
});

test("state normalization rejects blank and arbitrary two-letter values", () => {
  for (const value of ["", " ", "ZZ", "F", "FLA", null]) {
    rejectsNormalization(() => normalizeStateCode(value));
  }
});

test("city normalization handles accents, punctuation, case, and whitespace", () => {
  assert.equal(normalizeCityName("  SÃO---José  "), "sao jose");
  assert.equal(normalizeCityName("Coeur   d'Alene"), "coeur d alene");
  assert.equal(buildCityStateKey(" Inverness ", "fl"), "FL|inverness");
});

test("exact city keys require a valid state and remain state scoped", () => {
  assert.notEqual(
    buildCityStateKey("Springfield", "IL"),
    buildCityStateKey("Springfield", "MO"),
  );
  rejectsNormalization(() => buildCityStateKey("Springfield", ""));
  rejectsNormalization(() => buildCityStateKey("", "FL"));
});

test("city aliases are never silently merged", () => {
  assert.notEqual(normalizeCityName("Saint Cloud"), normalizeCityName("St Cloud"));
  assert.notEqual(normalizeCityName("Fort Myers"), normalizeCityName("Ft Myers"));
  assert.notEqual(normalizeCityName("Mount Dora"), normalizeCityName("Mt Dora"));
});

test("name normalization removes apostrophes without splitting and spaces other punctuation", () => {
  assert.equal(normalizeSearchName(" Paige’s  Root-Beer "), "paiges root beer");
  assert.equal(normalizeSearchName("L'été Café"), "lete cafe");
});

test("word prefixes support required searches and never add middle substrings", () => {
  const subscription = buildWordPrefixTokens("Subscription");
  const testName = buildWordPrefixTokens("Aug 5 BiteStar Subscription Test");
  const paiges = buildWordPrefixTokens("Paige’s Root Beer");
  assert.ok(subscription.includes("sub"));
  assert.ok(testName.includes("subscription"));
  assert.ok(paiges.includes("paig"));
  assert.equal(subscription.includes("ubs"), false);
});

test("word-prefix order and deduplication are deterministic", () => {
  assert.deepEqual(buildWordPrefixTokens("Beta beta Alpha"), [
    "be", "bet", "beta", "al", "alp", "alph", "alpha",
  ]);
  assert.deepEqual(
    buildWordPrefixTokens("Beta beta Alpha"),
    buildWordPrefixTokens("Beta beta Alpha"),
  );
});

test("name length and token count policies are hard bounded", () => {
  assert.equal(maximumSearchNameLength, 100);
  assert.equal(maximumWordPrefixTokenCount <= 128, true);
  const bounded = "abcdefghij ".repeat(9).trim();
  assert.equal(Array.from(bounded).length <= maximumSearchNameLength, true);
  assert.equal(
    buildWordPrefixTokens(bounded).length <= maximumWordPrefixTokenCount,
    true,
  );
  rejectsNormalization(() => normalizeSearchName("a".repeat(101)));
});
