import {createHash} from "node:crypto";

export const dishReviewAggregateAccumulatorVersion =
  "bitestar.dish-review-aggregate-accumulator.v1" as const;
export const dishReviewAggregateWinnerVersion =
  "bitestar.dish-proposal-aggregate-winner.v1" as const;

export type DishReviewAggregateRole = "target" | "source";

export type DishReviewAggregateSourceDocument = Readonly<{
  id: string;
  data: Readonly<Record<string, unknown>> | null;
}>;

export type DishReviewAggregateCandidate = Readonly<{
  sourceDocumentId: string;
  dishId: string;
  restaurantId: string;
  userId: string;
  overallImpression: number;
  tastinessScore: number | null;
  qualityScore: number | null;
  valueScore: number | null;
  overallBiteScore: number;
  freshnessSeconds: number;
  freshnessNanoseconds: number;
}>;

export type DishReviewAggregateWinnerDocument = Readonly<{
  version: typeof dishReviewAggregateWinnerVersion;
  winnerId: string;
  jobId: string;
  aggregateRole: DishReviewAggregateRole;
  dishId: string;
  reviewerFingerprint: string;
  sourceDocumentId: string;
  overallImpression: number;
  tastinessScore: number | null;
  qualityScore: number | null;
  valueScore: number | null;
  overallBiteScore: number;
  freshnessSeconds: number;
  freshnessNanoseconds: number;
  fingerprint: string;
  indexedAt: Date;
}>;

export type DishReviewAggregateAccumulator = Readonly<{
  accumulatorVersion: typeof dishReviewAggregateAccumulatorVersion;
  dishId: string;
  committedRatingCount: number;
  overallBiteScoreSum: number;
  overallImpressionSum: number;
  tastinessScoreSum: number;
  tastinessScoreCount: number;
  qualityScoreSum: number;
  qualityScoreCount: number;
  valueScoreSum: number;
  valueScoreCount: number;
}>;

export type DishReviewAggregate = Readonly<{
  dishId: string;
  restaurantId: string;
  overallBiteScore: number;
  ratingCount: number;
  overallImpressionAverage: number | null;
  tastinessScoreAverage: number | null;
  qualityScoreAverage: number | null;
  valueScoreAverage: number | null;
}>;

const accumulatorKeys = Object.freeze([
  "accumulatorVersion",
  "dishId",
  "committedRatingCount",
  "overallBiteScoreSum",
  "overallImpressionSum",
  "tastinessScoreSum",
  "tastinessScoreCount",
  "qualityScoreSum",
  "qualityScoreCount",
  "valueScoreSum",
  "valueScoreCount",
] as const);

const winnerKeys = Object.freeze([
  "version",
  "winnerId",
  "jobId",
  "aggregateRole",
  "dishId",
  "reviewerFingerprint",
  "sourceDocumentId",
  "overallImpression",
  "tastinessScore",
  "qualityScore",
  "valueScore",
  "overallBiteScore",
  "freshnessSeconds",
  "freshnessNanoseconds",
  "fingerprint",
  "indexedAt",
] as const);

const maximumFirestoreDocumentIdBytes = 1_500;
const minimumFirestoreTimestampSeconds = -62_135_596_800;
const maximumFirestoreTimestampSeconds = 253_402_300_799;
const maximumTimestampNanoseconds = 999_999_999;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function requireExactDocumentSegment(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    Buffer.byteLength(value, "utf8") > maximumFirestoreDocumentIdBytes
  ) {
    throw new Error(`${label} must be an exact Firestore document-ID segment.`);
  }
  return value;
}

function requireCanonicalOperationalId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("/") ||
    value === "." ||
    value === ".." ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value, "utf8") > maximumFirestoreDocumentIdBytes
  ) {
    throw new Error(`${label} is not canonical.`);
  }
  return value;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type TimestampFreshness = Readonly<{
  seconds: number;
  nanoseconds: number;
}>;

function freshnessFromDate(value: Date): TimestampFreshness | null {
  const millis = value.getTime();
  if (!Number.isFinite(millis)) {
    return null;
  }
  const seconds = Math.floor(millis / 1_000);
  if (
    seconds < minimumFirestoreTimestampSeconds ||
    seconds > maximumFirestoreTimestampSeconds
  ) {
    return null;
  }
  return Object.freeze({
    seconds,
    nanoseconds: (millis - seconds * 1_000) * 1_000_000,
  });
}

function readTimestampFreshness(value: unknown): TimestampFreshness | null {
  if (value instanceof Date) {
    return freshnessFromDate(value);
  }
  const timestamp = record(value);
  if (timestamp === null) {
    return null;
  }
  const hasSeconds = "seconds" in timestamp;
  const hasNanoseconds = "nanoseconds" in timestamp;
  if (hasSeconds || hasNanoseconds) {
    if (
      !Number.isSafeInteger(timestamp.seconds) ||
      !Number.isSafeInteger(timestamp.nanoseconds) ||
      (timestamp.seconds as number) < minimumFirestoreTimestampSeconds ||
      (timestamp.seconds as number) > maximumFirestoreTimestampSeconds ||
      (timestamp.nanoseconds as number) < 0 ||
      (timestamp.nanoseconds as number) > maximumTimestampNanoseconds
    ) {
      return null;
    }
    return Object.freeze({
      seconds: timestamp.seconds as number,
      nanoseconds: timestamp.nanoseconds as number,
    });
  }
  if (typeof timestamp.toDate !== "function") {
    return null;
  }
  try {
    const converted = (timestamp.toDate as () => unknown)();
    return converted instanceof Date ? freshnessFromDate(converted) : null;
  } catch {
    return null;
  }
}

function readTimestampMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  const timestamp = record(value);
  if (timestamp === null || typeof timestamp.toDate !== "function") {
    return null;
  }
  try {
    const converted = (timestamp.toDate as () => unknown)();
    if (!(converted instanceof Date)) {
      return null;
    }
    const millis = converted.getTime();
    return Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

function requireDate(value: unknown, label: string): Date {
  const millis = readTimestampMillis(value);
  if (millis === null) {
    throw new Error(`${label} is invalid.`);
  }
  return new Date(millis);
}

function canonicalHash(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareFreshness(
  left: Pick<
    DishReviewAggregateCandidate,
    "freshnessSeconds" | "freshnessNanoseconds" | "sourceDocumentId"
  >,
  right: Pick<
    DishReviewAggregateWinnerDocument,
    "freshnessSeconds" | "freshnessNanoseconds" | "sourceDocumentId"
  >,
): number {
  if (left.freshnessSeconds !== right.freshnessSeconds) {
    return left.freshnessSeconds < right.freshnessSeconds ? -1 : 1;
  }
  if (left.freshnessNanoseconds !== right.freshnessNanoseconds) {
    return left.freshnessNanoseconds < right.freshnessNanoseconds ? -1 : 1;
  }
  return compareStrings(left.sourceDocumentId, right.sourceDocumentId);
}

export function parseDishReviewAggregateCandidate(
  document: DishReviewAggregateSourceDocument,
): DishReviewAggregateCandidate | null {
  const data = document.data;
  if (data === null) {
    return null;
  }

  const dishId = readString(data.dishId);
  const restaurantId = readString(data.restaurantId);
  const userId = readString(data.userId);
  if (dishId === null || restaurantId === null || userId === null) {
    return null;
  }

  const overallBiteScore = readNumber(data.overallBiteScore) ?? 0;
  const tastinessScore = readNumber(data.tastinessScore) ??
    readNumber(data.tasteScore);
  const qualityScore = readNumber(data.qualityScore);
  const valueScore = readNumber(data.valueScore);
  const overallImpression = readNumber(data.overallImpression) ??
    qualityScore ??
    tastinessScore ??
    (overallBiteScore > 0
      ? Math.min(10, Math.max(1, overallBiteScore / 10))
      : null);
  if (overallImpression === null) {
    return null;
  }
  const freshness = readTimestampFreshness(data.updatedAt) ??
    readTimestampFreshness(data.createdAt) ??
    Object.freeze({seconds: 0, nanoseconds: 0});

  return Object.freeze({
    sourceDocumentId: document.id,
    dishId,
    restaurantId,
    userId,
    overallImpression,
    tastinessScore,
    qualityScore,
    valueScore,
    overallBiteScore,
    freshnessSeconds: freshness.seconds,
    freshnessNanoseconds: freshness.nanoseconds,
  });
}

export function createDishReviewAggregateReviewerFingerprint(
  normalizedReviewerUid: string,
): string {
  const reviewerUid = readString(normalizedReviewerUid);
  if (reviewerUid === null) {
    throw new Error("Normalized reviewer UID is required.");
  }
  return canonicalHash([
    dishReviewAggregateWinnerVersion,
    ["reviewer", reviewerUid],
  ]);
}

function requireAggregateRole(
  value: unknown,
  label: string,
): DishReviewAggregateRole {
  if (value !== "target" && value !== "source") {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireReviewerFingerprint(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function winnerIdFromReviewerFingerprint(value: Readonly<{
  jobId: string;
  aggregateRole: DishReviewAggregateRole;
  dishId: string;
  reviewerFingerprint: string;
}>): string {
  const jobId = requireExactDocumentSegment(value.jobId, "Aggregate job ID");
  const aggregateRole = requireAggregateRole(
    value.aggregateRole,
    "Aggregate role",
  );
  const dishId = requireCanonicalOperationalId(value.dishId, "Aggregate dish ID");
  const reviewerFingerprint = requireReviewerFingerprint(
    value.reviewerFingerprint,
    "Aggregate reviewer fingerprint",
  );
  return canonicalHash([
    dishReviewAggregateWinnerVersion,
    ["winner", jobId, aggregateRole, dishId, reviewerFingerprint],
  ]);
}

export function createDishReviewAggregateWinnerId(value: Readonly<{
  jobId: string;
  aggregateRole: DishReviewAggregateRole;
  dishId: string;
  normalizedReviewerUid: string;
}>): string {
  const jobId = requireExactDocumentSegment(value.jobId, "Aggregate job ID");
  const aggregateRole = requireAggregateRole(
    value.aggregateRole,
    "Aggregate role",
  );
  const dishId = requireCanonicalOperationalId(value.dishId, "Aggregate dish ID");
  const reviewerFingerprint = createDishReviewAggregateReviewerFingerprint(
    value.normalizedReviewerUid,
  );
  return winnerIdFromReviewerFingerprint({
    jobId,
    aggregateRole,
    dishId,
    reviewerFingerprint,
  });
}

export function dishReviewAggregateWinnerCollectionPath(jobId: string): string {
  return `private_dish_edit_application_jobs/${
    requireExactDocumentSegment(jobId, "Aggregate job ID")
  }/aggregate_winners`;
}

export function dishReviewAggregateWinnerPath(value: Readonly<{
  jobId: string;
  aggregateRole: DishReviewAggregateRole;
  dishId: string;
  normalizedReviewerUid: string;
}>): string {
  return `${dishReviewAggregateWinnerCollectionPath(value.jobId)}/${
    createDishReviewAggregateWinnerId(value)
  }`;
}

function winnerFingerprint(
  winner: Omit<DishReviewAggregateWinnerDocument, "fingerprint" | "indexedAt">,
): string {
  return canonicalHash([
    dishReviewAggregateWinnerVersion,
    [
      winner.winnerId,
      winner.jobId,
      winner.aggregateRole,
      winner.dishId,
      winner.reviewerFingerprint,
      winner.sourceDocumentId,
      winner.overallImpression,
      winner.tastinessScore,
      winner.qualityScore,
      winner.valueScore,
      winner.overallBiteScore,
      winner.freshnessSeconds,
      winner.freshnessNanoseconds,
    ],
  ]);
}

export function buildDishReviewAggregateWinnerDocument(value: Readonly<{
  jobId: string;
  aggregateRole: DishReviewAggregateRole;
  candidate: DishReviewAggregateCandidate;
  indexedAt: Date;
}>): DishReviewAggregateWinnerDocument {
  const jobId = requireExactDocumentSegment(value.jobId, "Aggregate job ID");
  const aggregateRole = requireAggregateRole(
    value.aggregateRole,
    "Aggregate role",
  );
  const dishId = requireCanonicalOperationalId(
    value.candidate.dishId,
    "Aggregate dish ID",
  );
  const sourceDocumentId = requireExactDocumentSegment(
    value.candidate.sourceDocumentId,
    "Review source document ID",
  );
  const reviewerFingerprint = createDishReviewAggregateReviewerFingerprint(
    value.candidate.userId,
  );
  const winnerId = winnerIdFromReviewerFingerprint({
    jobId,
    aggregateRole,
    dishId,
    reviewerFingerprint,
  });
  if (
    !(value.indexedAt instanceof Date) ||
    !Number.isFinite(value.indexedAt.getTime())
  ) {
    throw new Error("Aggregate winner indexedAt is invalid.");
  }
  const core = {
    version: dishReviewAggregateWinnerVersion,
    winnerId,
    jobId,
    aggregateRole,
    dishId,
    reviewerFingerprint,
    sourceDocumentId,
    overallImpression: requireFiniteNumber(
      value.candidate.overallImpression,
      "Aggregate winner overallImpression",
    ),
    tastinessScore: requireNullableFiniteNumber(
      value.candidate.tastinessScore,
      "Aggregate winner tastinessScore",
    ),
    qualityScore: requireNullableFiniteNumber(
      value.candidate.qualityScore,
      "Aggregate winner qualityScore",
    ),
    valueScore: requireNullableFiniteNumber(
      value.candidate.valueScore,
      "Aggregate winner valueScore",
    ),
    overallBiteScore: requireFiniteNumber(
      value.candidate.overallBiteScore,
      "Aggregate winner overallBiteScore",
    ),
    freshnessSeconds: requireTimestampSeconds(
      value.candidate.freshnessSeconds,
      "Aggregate winner freshnessSeconds",
    ),
    freshnessNanoseconds: requireTimestampNanoseconds(
      value.candidate.freshnessNanoseconds,
      "Aggregate winner freshnessNanoseconds",
    ),
  } as const;
  return Object.freeze({
    ...core,
    fingerprint: winnerFingerprint(core),
    indexedAt: new Date(value.indexedAt.getTime()),
  });
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireNullableFiniteNumber(value: unknown, label: string): number | null {
  return value === null ? null : requireFiniteNumber(value, label);
}

function requireTimestampSeconds(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimumFirestoreTimestampSeconds ||
    (value as number) > maximumFirestoreTimestampSeconds
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function requireTimestampNanoseconds(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > maximumTimestampNanoseconds
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

export function parseDishReviewAggregateWinnerDocument(
  document: DishReviewAggregateSourceDocument | null,
): DishReviewAggregateWinnerDocument | null {
  if (document === null) {
    return null;
  }
  const data = document.data;
  if (data === null || !exactKeys(data as Record<string, unknown>, winnerKeys)) {
    throw new Error("Stored aggregate winner has an invalid schema.");
  }
  const aggregateRole = data.aggregateRole === "target" ||
      data.aggregateRole === "source"
    ? data.aggregateRole
    : null;
  let winnerId: string;
  let jobId: string;
  let dishId: string;
  let reviewerFingerprint: string;
  let sourceDocumentId: string;
  try {
    winnerId = requireExactDocumentSegment(data.winnerId, "Aggregate winner ID");
    jobId = requireExactDocumentSegment(data.jobId, "Aggregate job ID");
    dishId = requireCanonicalOperationalId(data.dishId, "Aggregate dish ID");
    reviewerFingerprint = requireReviewerFingerprint(
      data.reviewerFingerprint,
      "Aggregate reviewer fingerprint",
    );
    sourceDocumentId = requireExactDocumentSegment(
      data.sourceDocumentId,
      "Review source document ID",
    );
  } catch {
    throw new Error("Stored aggregate winner has an invalid schema.");
  }
  if (
    data.version !== dishReviewAggregateWinnerVersion ||
    aggregateRole === null ||
    typeof data.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(data.fingerprint)
  ) {
    throw new Error("Stored aggregate winner has an invalid schema.");
  }
  const indexedAt = requireDate(data.indexedAt, "Aggregate winner indexedAt");
  const core = {
    version: dishReviewAggregateWinnerVersion,
    winnerId,
    jobId,
    aggregateRole,
    dishId,
    reviewerFingerprint,
    sourceDocumentId,
    overallImpression: requireFiniteNumber(
      data.overallImpression,
      "Aggregate winner overallImpression",
    ),
    tastinessScore: requireNullableFiniteNumber(
      data.tastinessScore,
      "Aggregate winner tastinessScore",
    ),
    qualityScore: requireNullableFiniteNumber(
      data.qualityScore,
      "Aggregate winner qualityScore",
    ),
    valueScore: requireNullableFiniteNumber(
      data.valueScore,
      "Aggregate winner valueScore",
    ),
    overallBiteScore: requireFiniteNumber(
      data.overallBiteScore,
      "Aggregate winner overallBiteScore",
    ),
    freshnessSeconds: requireTimestampSeconds(
      data.freshnessSeconds,
      "Aggregate winner freshnessSeconds",
    ),
    freshnessNanoseconds: requireTimestampNanoseconds(
      data.freshnessNanoseconds,
      "Aggregate winner freshnessNanoseconds",
    ),
  } as const;
  const expectedWinnerId = winnerIdFromReviewerFingerprint({
    jobId,
    aggregateRole,
    dishId,
    reviewerFingerprint,
  });
  if (
    document.id !== winnerId ||
    winnerId !== expectedWinnerId ||
    winnerFingerprint(core) !== data.fingerprint
  ) {
    throw new Error("Stored aggregate winner has an invalid identity.");
  }
  return Object.freeze({...core, fingerprint: data.fingerprint, indexedAt});
}

export function chooseDishReviewAggregateWinner(
  existing: DishReviewAggregateWinnerDocument | null,
  value: Readonly<{
    jobId: string;
    aggregateRole: DishReviewAggregateRole;
    candidate: DishReviewAggregateCandidate;
    indexedAt: Date;
  }>,
): DishReviewAggregateWinnerDocument {
  const candidateWinner = buildDishReviewAggregateWinnerDocument(value);
  if (existing === null) {
    return candidateWinner;
  }
  if (
    existing.winnerId !== candidateWinner.winnerId ||
    existing.jobId !== candidateWinner.jobId ||
    existing.aggregateRole !== candidateWinner.aggregateRole ||
    existing.dishId !== candidateWinner.dishId ||
    existing.reviewerFingerprint !== candidateWinner.reviewerFingerprint
  ) {
    throw new Error("Aggregate winner identity does not match its candidate.");
  }
  return compareFreshness(value.candidate, existing) > 0
    ? candidateWinner
    : existing;
}

export function chooseDishReviewAggregateWinnerDocument(
  existing: DishReviewAggregateWinnerDocument,
  candidate: DishReviewAggregateWinnerDocument,
): DishReviewAggregateWinnerDocument {
  if (
    existing.winnerId !== candidate.winnerId ||
    existing.jobId !== candidate.jobId ||
    existing.aggregateRole !== candidate.aggregateRole ||
    existing.dishId !== candidate.dishId ||
    existing.reviewerFingerprint !== candidate.reviewerFingerprint
  ) {
    throw new Error("Aggregate winner documents have different identities.");
  }
  return compareFreshness(candidate, existing) > 0 ? candidate : existing;
}

export function createDishReviewAggregateAccumulator(
  dishId: string,
): DishReviewAggregateAccumulator {
  return Object.freeze({
    accumulatorVersion: dishReviewAggregateAccumulatorVersion,
    dishId: requireCanonicalOperationalId(dishId, "Aggregate dish ID"),
    committedRatingCount: 0,
    overallBiteScoreSum: 0,
    overallImpressionSum: 0,
    tastinessScoreSum: 0,
    tastinessScoreCount: 0,
    qualityScoreSum: 0,
    qualityScoreCount: 0,
    valueScoreSum: 0,
    valueScoreCount: 0,
  });
}

function requireCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Dish review aggregate ${field} is invalid.`);
  }
  return value as number;
}

export function restoreDishReviewAggregateAccumulator(
  value: unknown,
): DishReviewAggregateAccumulator {
  const data = record(value);
  if (
    data === null ||
    !exactKeys(data, accumulatorKeys) ||
    data.accumulatorVersion !== dishReviewAggregateAccumulatorVersion
  ) {
    throw new Error("Dish review aggregate accumulator is invalid.");
  }
  const dishId = requireCanonicalOperationalId(data.dishId, "Aggregate dish ID");
  const committedRatingCount = requireCount(
    data.committedRatingCount,
    "rating count",
  );
  const tastinessScoreCount = requireCount(
    data.tastinessScoreCount,
    "tastiness count",
  );
  const qualityScoreCount = requireCount(
    data.qualityScoreCount,
    "quality count",
  );
  const valueScoreCount = requireCount(data.valueScoreCount, "value count");
  if (
    tastinessScoreCount > committedRatingCount ||
    qualityScoreCount > committedRatingCount ||
    valueScoreCount > committedRatingCount
  ) {
    throw new Error("Dish review aggregate score counts are invalid.");
  }
  return Object.freeze({
    accumulatorVersion: dishReviewAggregateAccumulatorVersion,
    dishId,
    committedRatingCount,
    overallBiteScoreSum: requireFiniteNumber(
      data.overallBiteScoreSum,
      "Dish review aggregate overallBiteScoreSum",
    ),
    overallImpressionSum: requireFiniteNumber(
      data.overallImpressionSum,
      "Dish review aggregate overallImpressionSum",
    ),
    tastinessScoreSum: requireFiniteNumber(
      data.tastinessScoreSum,
      "Dish review aggregate tastinessScoreSum",
    ),
    tastinessScoreCount,
    qualityScoreSum: requireFiniteNumber(
      data.qualityScoreSum,
      "Dish review aggregate qualityScoreSum",
    ),
    qualityScoreCount,
    valueScoreSum: requireFiniteNumber(
      data.valueScoreSum,
      "Dish review aggregate valueScoreSum",
    ),
    valueScoreCount,
  });
}

export function accumulateDishReviewAggregateWinnerPage(
  initialState: DishReviewAggregateAccumulator,
  winners: Iterable<DishReviewAggregateWinnerDocument>,
): DishReviewAggregateAccumulator {
  let state = restoreDishReviewAggregateAccumulator(initialState);
  for (const winner of winners) {
    if (winner.dishId !== state.dishId) {
      throw new Error("Aggregate winner belongs to a different dish.");
    }
    state = {
      ...state,
      committedRatingCount: state.committedRatingCount + 1,
      overallBiteScoreSum:
        state.overallBiteScoreSum + winner.overallBiteScore,
      overallImpressionSum:
        state.overallImpressionSum + winner.overallImpression,
      tastinessScoreSum:
        state.tastinessScoreSum + (winner.tastinessScore ?? 0),
      tastinessScoreCount:
        state.tastinessScoreCount + (winner.tastinessScore === null ? 0 : 1),
      qualityScoreSum: state.qualityScoreSum + (winner.qualityScore ?? 0),
      qualityScoreCount:
        state.qualityScoreCount + (winner.qualityScore === null ? 0 : 1),
      valueScoreSum: state.valueScoreSum + (winner.valueScore ?? 0),
      valueScoreCount:
        state.valueScoreCount + (winner.valueScore === null ? 0 : 1),
    };
  }
  return restoreDishReviewAggregateAccumulator(state);
}

export function finalizeDishReviewAggregate(
  initialState: DishReviewAggregateAccumulator,
  restaurantIdValue: string,
): DishReviewAggregate {
  const state = restoreDishReviewAggregateAccumulator(initialState);
  const restaurantId = readString(restaurantIdValue);
  if (restaurantId === null) {
    throw new Error("Dish review aggregate restaurant ID is required.");
  }
  if (state.committedRatingCount === 0) {
    return Object.freeze({
      dishId: state.dishId,
      restaurantId,
      overallBiteScore: 0,
      ratingCount: 0,
      overallImpressionAverage: null,
      tastinessScoreAverage: null,
      qualityScoreAverage: null,
      valueScoreAverage: null,
    });
  }
  return Object.freeze({
    dishId: state.dishId,
    restaurantId,
    overallBiteScore:
      state.overallBiteScoreSum / state.committedRatingCount,
    ratingCount: state.committedRatingCount,
    overallImpressionAverage:
      state.overallImpressionSum / state.committedRatingCount,
    tastinessScoreAverage: state.tastinessScoreCount === 0
      ? null
      : state.tastinessScoreSum / state.tastinessScoreCount,
    qualityScoreAverage: state.qualityScoreCount === 0
      ? null
      : state.qualityScoreSum / state.qualityScoreCount,
    valueScoreAverage: state.valueScoreCount === 0
      ? null
      : state.valueScoreSum / state.valueScoreCount,
  });
}
