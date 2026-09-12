import {
  exactCustomerBiteSaverDistanceMiles,
  validRestaurantCoordinates,
  type RestaurantCoordinates,
} from "./restaurant_geo_helpers.js";

export const customerBiteSaverAvailabilityVersion =
  "bitestar.bitesaver-offer-availability.v1" as const;
export const customerBiteSaverRedemptionTimerMilliseconds = 5 * 60_000;
export const customerBiteSaverFreshLocationMaximumAgeMilliseconds = 2 * 60_000;

/** Mirrors Coupon._readBool: malformed and missing values remain nullable. */
export function readCustomerBiteSaverCouponBoolean(
  value: unknown,
): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return null;
}

/** Mirrors DailySpecial._readBool, including legacy numeric booleans. */
export function readCustomerBiteSaverDailySpecialBoolean(
  value: unknown,
): boolean | null {
  if (typeof value === "number") {
    return value !== 0;
  }
  return readCustomerBiteSaverCouponBoolean(value);
}

/**
 * Mirrors the finite portion of Coupon._readDouble. Firestore can represent
 * non-finite doubles, but accepting one as a distance radius is never safe.
 */
export function readCustomerBiteSaverFiniteDouble(
  value: unknown,
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text)) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function customerBiteSaverDailySpecialAvailabilityMode(
  value: unknown,
): "todayOnly" | "specificDays" {
  return typeof value === "string" && value.trim() === "specificDays"
    ? "specificDays"
    : "todayOnly";
}

export type CustomerBiteSaverOfferType = "coupon" | "dailySpecial";
export type CustomerBiteSaverUsageState = Readonly<{
  known: boolean;
  lastRedeemedAt: Date | null;
  timerStartedAt: Date | null;
  generation: string;
}>;

export type CustomerBiteSaverAvailabilityDecision = Readonly<{
  visible: boolean;
  redeemable: boolean;
  reason:
    | "available"
    | "parentUnavailable"
    | "inactive"
    | "notStarted"
    | "expired"
    | "wrongDay"
    | "outsideTimeWindow"
    | "invalidSchedule"
    | "typedLocation"
    | "outsideProximity"
    | "missingFreshLocation"
    | "used"
    | "usageUnknown";
  usageState: "available" | "unavailable" | "unknown";
  activeTimerExpiresAtMs: number | null;
  nextAvailableAtMs: number | null;
  proximityDistanceMiles: number | null;
  /** Earliest known instant at which an allowed decision must be re-evaluated. */
  eligibilityExpiresAtMs: number | null;
}>;

type LocalDateTimeParts = Readonly<{
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}>;

export type CustomerBiteSaverLegacyDateTimeStringResult =
  | Readonly<{kind: "invalid"; date: null}>
  | Readonly<{kind: "timeZoneRequired"; date: null}>
  | Readonly<{kind: "parsed"; date: Date}>;

const invalidLegacyDateTimeString = Object.freeze({
  kind: "invalid" as const,
  date: null,
});
const timeZoneRequiredLegacyDateTimeString = Object.freeze({
  kind: "timeZoneRequired" as const,
  date: null,
});

// This is the exact grammar used by Dart DateTime.tryParse. Keep this parser
// deliberately narrower than JavaScript Date.parse: legacy display strings
// such as 12/31/2026 must not acquire schedule meaning only on the server.
const dartDateTimeParseFormat =
  /^([+-]?\d{4,6})-?(\d\d)-?(\d\d)(?:[ T](\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,](\d+))?)?)?( ?[zZ]| ?([-+])(\d\d)(?::?(\d\d))?)?)?$/u;

type LegacyCivilDateTime = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}>;

function civilUtcMillis(value: LegacyCivilDateTime): number | null {
  // Date.UTC rewrites years 0...99 to 1900...1999. Mutating an epoch Date
  // preserves Dart's signed/four-to-six-digit year behavior instead.
  const date = new Date(0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  date.setUTCHours(
    value.hour,
    value.minute,
    value.second,
    value.millisecond,
  );
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function normalizedCivilDateTime(
  value: LegacyCivilDateTime,
): LegacyCivilDateTime | null {
  const millis = civilUtcMillis(value);
  if (millis === null) {
    return null;
  }
  const date = new Date(millis);
  return Object.freeze({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  });
}

function localCivilDateTimeAt(
  instantMs: number,
  timeZone: string,
): LegacyCivilDateTime | null {
  try {
    const parts = new Map(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        calendar: "gregory",
        numberingSystem: "latn",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(instantMs))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const result = Object.freeze({
      year: Number(parts.get("year")),
      month: Number(parts.get("month")),
      day: Number(parts.get("day")),
      hour: Number(parts.get("hour")),
      minute: Number(parts.get("minute")),
      second: Number(parts.get("second")),
      millisecond: new Date(instantMs).getUTCMilliseconds(),
    });
    return Object.values(result).every(Number.isInteger) ? result : null;
  } catch {
    return null;
  }
}

function sameCivilDateTime(
  left: LegacyCivilDateTime,
  right: LegacyCivilDateTime,
): boolean {
  return left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second &&
    left.millisecond === right.millisecond;
}

type LocalCivilInstantResolution = Readonly<{
  targetCivilMs: number;
  exact: readonly number[];
  afterGap: readonly Readonly<{instantMs: number; civilMs: number}>[];
}>;

function resolveLocalCivilInstants(
  value: LegacyCivilDateTime,
  timeZone: string,
): LocalCivilInstantResolution | null {
  const targetCivilMs = civilUtcMillis(value);
  if (targetCivilMs === null) {
    return null;
  }
  const offsets = new Set<number>();
  for (const deltaHours of [-36, -24, -12, 0, 12, 24, 36]) {
    const probe = targetCivilMs + deltaHours * 60 * 60_000;
    const local = localCivilDateTimeAt(probe, timeZone);
    const localAsUtc = local === null ? null : civilUtcMillis(local);
    if (localAsUtc !== null) {
      const offsetMs = localAsUtc - probe;
      offsets.add(offsetMs);
    }
  }
  const exact: number[] = [];
  const afterGap: Readonly<{instantMs: number; civilMs: number}>[] = [];
  for (const offset of offsets) {
    const candidate = targetCivilMs - offset;
    const local = localCivilDateTimeAt(candidate, timeZone);
    const localAsUtc = local === null ? null : civilUtcMillis(local);
    if (local === null || localAsUtc === null) {
      continue;
    }
    if (sameCivilDateTime(local, value)) {
      exact.push(candidate);
    } else if (localAsUtc > targetCivilMs) {
      afterGap.push(Object.freeze({instantMs: candidate, civilMs: localAsUtc}));
    }
  }
  exact.sort((left, right) => left - right);
  afterGap.sort((left, right) =>
    left.civilMs - right.civilMs || left.instantMs - right.instantMs);
  return Object.freeze({
    targetCivilMs,
    exact: Object.freeze(exact),
    afterGap: Object.freeze(afterGap),
  });
}

function localCivilToInstantMillis(
  value: LegacyCivilDateTime,
  timeZone: string,
): number | null {
  const resolution = resolveLocalCivilInstants(value, timeZone);
  if (resolution === null) {
    return null;
  }
  const {exact, afterGap} = resolution;
  if (exact.length > 0) {
    // Dart/native local constructors select one occurrence of a repeated wall
    // time. The earlier occurrence is deterministic across Functions hosts.
    return exact[0];
  }
  if (afterGap.length === 0) {
    return null;
  }
  // Match local DateTime construction through a daylight-saving gap by moving
  // forward by the gap. This also avoids depending on the Functions host TZ.
  return afterGap[0].instantMs;
}

const maximumLocalBoundarySearchMilliseconds = 27 * 60 * 60_000;
// An exhaustive transition-table audit of the authoritative Node 24.19
// tzdata 2026b runtime and its installed IANA 2026c successor found minimum
// adjacent transition separations of 167 and 166 hours respectively. Keep the
// safety horizon strictly below that supported-data invariant, so it contains
// at most one offset transition and offset equality is monotone for bisection.
const minimumAuditedIanaTransitionSeparationMilliseconds =
  166 * 60 * 60_000;
const maximumLocalOffsetTransitionRefinements = 27;

function localOffsetMillisecondsAt(
  instantMs: number,
  timeZone: string,
): number | null {
  const local = localCivilDateTimeAt(instantMs, timeZone);
  const localAsUtc = local === null ? null : civilUtcMillis(local);
  if (localAsUtc === null) {
    return null;
  }
  const offset = localAsUtc - instantMs;
  return Number.isSafeInteger(offset) ? offset : null;
}

/**
 * Finds the exact first millisecond carrying a new UTC offset. Callers keep
 * the bracket inside the 27-hour local-boundary horizon, so 27 bisections are
 * sufficient independently of the configured IANA transition size.
 */
function firstLocalOffsetChangeMillis(value: {
  unchangedAtMs: number;
  changedAtMs: number;
  unchangedOffsetMs: number;
  timeZone: string;
}): number | null {
  let unchangedAtMs = value.unchangedAtMs;
  let changedAtMs = value.changedAtMs;
  for (
    let iteration = 0;
    changedAtMs - unchangedAtMs > 1;
    iteration += 1
  ) {
    if (iteration >= maximumLocalOffsetTransitionRefinements) {
      return null;
    }
    const candidate = unchangedAtMs +
      Math.floor((changedAtMs - unchangedAtMs) / 2);
    const offset = localOffsetMillisecondsAt(candidate, value.timeZone);
    if (offset === null) {
      return null;
    }
    if (offset === value.unchangedOffsetMs) {
      unchangedAtMs = candidate;
    } else {
      changedAtMs = candidate;
    }
  }
  return changedAtMs;
}

/**
 * A resolved wall-clock end can lie beyond an offset transition that briefly
 * makes an otherwise-positive predicate false. The audited horizon contains
 * at most one transition: equal endpoint offsets retain the fast path, while
 * differing offsets are bisected and the actual predicate is checked there.
 */
function capLocalBoundaryAtPredicateTransition(value: {
  afterMs: number;
  boundaryMs: number;
  timeZone: string;
  remainsEligible: (local: LegacyCivilDateTime) => boolean;
}): number | null {
  if (
    value.boundaryMs <= value.afterMs ||
    value.boundaryMs - value.afterMs > maximumLocalBoundarySearchMilliseconds ||
    maximumLocalBoundarySearchMilliseconds >=
      minimumAuditedIanaTransitionSeparationMilliseconds
  ) {
    return null;
  }
  const afterOffsetMs = localOffsetMillisecondsAt(
    value.afterMs,
    value.timeZone,
  );
  const boundaryOffsetMs = localOffsetMillisecondsAt(
    value.boundaryMs,
    value.timeZone,
  );
  if (afterOffsetMs === null || boundaryOffsetMs === null) {
    return null;
  }
  if (afterOffsetMs === boundaryOffsetMs) {
    return value.boundaryMs;
  }
  const transitionAtMs = firstLocalOffsetChangeMillis({
    unchangedAtMs: value.afterMs,
    changedAtMs: value.boundaryMs,
    unchangedOffsetMs: afterOffsetMs,
    timeZone: value.timeZone,
  });
  if (transitionAtMs === null) {
    return null;
  }
  const transitionLocal = localCivilDateTimeAt(
    transitionAtMs,
    value.timeZone,
  );
  if (transitionLocal === null) {
    return null;
  }
  return value.remainsEligible(transitionLocal)
    ? value.boundaryMs
    : transitionAtMs;
}

/**
 * Resolves a minute-based local schedule boundary strictly after `afterMs`.
 * Repeated wall minutes retain both real instants, while a nonexistent wall
 * minute resolves to the first real minute at or beyond the requested civil
 * boundary instead of extending eligibility by the daylight-saving gap.
 */
function localCivilMinuteBoundaryAfter(
  value: LegacyCivilDateTime,
  timeZone: string,
  afterMs: number,
  remainsEligible?: (local: LegacyCivilDateTime) => boolean,
): number | null {
  const resolution = resolveLocalCivilInstants(value, timeZone);
  if (resolution === null) {
    return null;
  }
  const exact = resolution.exact.find((candidate) => candidate > afterMs);
  let boundaryMs: number;
  if (exact !== undefined) {
    boundaryMs = exact;
  } else {
    const afterGap = resolution.afterGap.find((candidate) =>
      candidate.instantMs > afterMs);
    if (
      afterGap === undefined ||
      afterGap.instantMs - afterMs > maximumLocalBoundarySearchMilliseconds
    ) {
      return null;
    }
    boundaryMs = afterGap.instantMs;
    const firstAbsoluteMinute =
      Math.floor(afterMs / 60_000) * 60_000 + 60_000;
    for (
      let candidate = firstAbsoluteMinute;
      candidate <= afterGap.instantMs;
      candidate += 60_000
    ) {
      const local = localCivilDateTimeAt(candidate, timeZone);
      const localAsUtc = local === null ? null : civilUtcMillis(local);
      if (localAsUtc !== null && localAsUtc >= resolution.targetCivilMs) {
        boundaryMs = candidate;
        break;
      }
    }
  }
  return remainsEligible === undefined
    ? boundaryMs
    : capLocalBoundaryAtPredicateTransition({
        afterMs,
        boundaryMs,
        timeZone,
        remainsEligible,
      });
}

export function parseCustomerBiteSaverLegacyDateTimeString(
  value: string,
  timeZone?: string,
  submillisecondRounding: "floor" | "ceil" = "floor",
): CustomerBiteSaverLegacyDateTimeStringResult {
  if (value.length > 100) {
    return invalidLegacyDateTimeString;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return invalidLegacyDateTimeString;
  }
  const match = dartDateTimeParseFormat.exec(trimmed);
  if (match === null) {
    return invalidLegacyDateTimeString;
  }
  const fraction = match[7] ?? "";
  const fractionalMicroseconds = Number(
    fraction.slice(0, 6).padEnd(6, "0") || 0,
  );
  const submillisecondAdjustment =
    submillisecondRounding === "ceil" && fractionalMicroseconds % 1_000 !== 0
      ? 1
      : 0;
  const civil = normalizedCivilDateTime(Object.freeze({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    millisecond: Math.floor(fractionalMicroseconds / 1_000),
  }));
  if (civil === null) {
    return invalidLegacyDateTimeString;
  }
  if (match[8] === undefined) {
    if (timeZone === undefined) {
      return timeZoneRequiredLegacyDateTimeString;
    }
    const millis = localCivilToInstantMillis(civil, timeZone);
    return millis === null
      ? invalidLegacyDateTimeString
      : Object.freeze({
          kind: "parsed" as const,
          date: new Date(millis + submillisecondAdjustment),
        });
  }
  const offsetMinutes = match[9] === undefined
    ? 0
    : (match[9] === "-" ? -1 : 1) *
      (Number(match[10]) * 60 + Number(match[11] ?? 0));
  const millis = civilUtcMillis(Object.freeze({
    ...civil,
    minute: civil.minute - offsetMinutes,
  }));
  return millis === null
    ? invalidLegacyDateTimeString
    : Object.freeze({
        kind: "parsed" as const,
        date: new Date(millis + submillisecondAdjustment),
      });
}

const weekdayByShortName = Object.freeze(new Map<string, number>([
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6],
  ["Sun", 7],
]));

const weekdayByLegacyName = Object.freeze(new Map<string, number>([
  ["monday", 1],
  ["mon", 1],
  ["tuesday", 2],
  ["tue", 2],
  ["wednesday", 3],
  ["wed", 3],
  ["thursday", 4],
  ["thu", 4],
  ["friday", 5],
  ["fri", 5],
  ["saturday", 6],
  ["sat", 6],
  ["sunday", 7],
  ["sun", 7],
]));

function timestampDate(
  value: unknown,
  timeZone: string,
  submillisecondRounding: "floor" | "ceil" = "floor",
): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    const result = new Date(value);
    return Number.isFinite(result.getTime()) ? result : null;
  }
  if (typeof value === "string" && value.length <= 100) {
    const parsed = parseCustomerBiteSaverLegacyDateTimeString(
      value,
      timeZone,
      submillisecondRounding,
    );
    return parsed.kind === "parsed" ? parsed.date : null;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as {
      seconds?: unknown;
      nanoseconds?: unknown;
      _seconds?: unknown;
      _nanoseconds?: unknown;
      toDate?: () => unknown;
      toMillis?: () => unknown;
    };
    try {
      const seconds = candidate.seconds ?? candidate._seconds;
      const nanoseconds = candidate.nanoseconds ?? candidate._nanoseconds;
      if (
        typeof candidate.toDate === "function" &&
        typeof seconds === "number" &&
        Number.isSafeInteger(seconds) &&
        typeof nanoseconds === "number" &&
        Number.isSafeInteger(nanoseconds) &&
        nanoseconds >= 0 &&
        nanoseconds < 1_000_000_000
      ) {
        // Dart Timestamp.toDate retains microseconds; JavaScript Date does not.
        // Round in the eligibility-safe direction after discarding only the
        // sub-microsecond precision Dart itself cannot represent.
        const microseconds = Math.floor(nanoseconds / 1_000);
        const millis = seconds * 1_000 + Math.floor(microseconds / 1_000) +
          (submillisecondRounding === "ceil" && microseconds % 1_000 !== 0
            ? 1
            : 0);
        const precise = new Date(millis);
        return Number.isFinite(precise.getTime()) ? precise : null;
      }
      const converted = typeof candidate.toDate === "function"
        ? candidate.toDate()
        : typeof candidate.toMillis === "function"
          ? candidate.toMillis()
          : null;
      return converted === value
        ? null
        : timestampDate(converted, timeZone, submillisecondRounding);
    } catch {
      return null;
    }
  }
  return null;
}

function localParts(date: Date, timeZone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const fields = new Map(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekday = weekdayByShortName.get(fields.get("weekday") ?? "");
  const result = {
    year: Number(fields.get("year")),
    month: Number(fields.get("month")),
    day: Number(fields.get("day")),
    weekday,
    hour: Number(fields.get("hour")),
    minute: Number(fields.get("minute")),
  };
  if (
    result.weekday === undefined ||
    Object.values(result).some((entry) =>
      typeof entry !== "number" || !Number.isInteger(entry))
  ) {
    throw new Error("Time-zone conversion failed.");
  }
  return result as LocalDateTimeParts;
}

function compareLocalDates(
  left: LocalDateTimeParts,
  right: LocalDateTimeParts,
): number {
  const leftDay = Date.UTC(left.year, left.month - 1, left.day) / 86_400_000;
  const rightDay = Date.UTC(right.year, right.month - 1, right.day) / 86_400_000;
  return leftDay - rightDay;
}

function localCivilMinuteAsUtc(parts: LocalDateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
}

function nextLocalDailyResetMillis(
  redeemed: LocalDateTimeParts,
  timeZone: string,
): number | null {
  const nextDay = new Date(
    Date.UTC(redeemed.year, redeemed.month - 1, redeemed.day) + 86_400_000,
  );
  const target: LocalDateTimeParts = Object.freeze({
    year: nextDay.getUTCFullYear(),
    month: nextDay.getUTCMonth() + 1,
    day: nextDay.getUTCDate(),
    weekday: ((nextDay.getUTCDay() + 6) % 7) + 1,
    hour: 0,
    minute: 1,
  });
  const targetCivilMillis = localCivilMinuteAsUtc(target);
  let candidate = targetCivilMillis;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidateParts = localParts(new Date(candidate), timeZone);
    const offsetMillis = localCivilMinuteAsUtc(candidateParts) - candidate;
    const adjusted = targetCivilMillis - offsetMillis;
    if (adjusted === candidate) {
      break;
    }
    candidate = adjusted;
  }
  const resolved = localParts(new Date(candidate), timeZone);
  return resolved.year === target.year &&
      resolved.month === target.month &&
      resolved.day === target.day &&
      resolved.hour === target.hour &&
      resolved.minute === target.minute
    ? candidate
    : null;
}

export function normalizeCustomerBiteSaverDailySpecialDays(
  value: unknown,
): readonly number[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  const result = new Set<number>();
  for (const entry of value) {
    const number = typeof entry === "number" && Number.isFinite(entry)
      ? Math.trunc(entry)
      : typeof entry === "string"
        ? /^[+-]?\d+$/u.test(entry.trim())
          ? Number(entry.trim())
          : weekdayByLegacyName.get(entry.trim().toLowerCase()) ?? Number.NaN
        : Number.NaN;
    if (Number.isInteger(number) && number >= 1 && number <= 7) {
      result.add(number);
      if (result.size === 7) {
        break;
      }
    }
  }
  return Object.freeze([...result].sort((left, right) => left - right));
}

function normalizeDays(value: unknown): ReadonlySet<number> {
  return new Set(normalizeCustomerBiteSaverDailySpecialDays(value));
}

function clockMinutes(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(\d{1,2}):(\d{2})$/u.exec(value.trim());
  if (match === null) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? hour * 60 + minute
    : null;
}

function localMinuteBoundaryMillis(value: {
  localDate: LocalDateTimeParts;
  minuteOfDay: number;
  timeZone: string;
  afterMs: number;
  remainsEligible?: (local: LegacyCivilDateTime) => boolean;
}): number | null {
  const target = normalizedCivilDateTime(Object.freeze({
    year: value.localDate.year,
    month: value.localDate.month,
    day: value.localDate.day,
    hour: Math.floor(value.minuteOfDay / 60),
    minute: value.minuteOfDay % 60,
    second: 0,
    millisecond: 0,
  }));
  return target === null
    ? null
    : localCivilMinuteBoundaryAfter(
        target,
        value.timeZone,
        value.afterMs,
        value.remainsEligible,
      );
}

function inactiveDecision(
  reason: CustomerBiteSaverAvailabilityDecision["reason"],
  usageState: CustomerBiteSaverAvailabilityDecision["usageState"] = "available",
): CustomerBiteSaverAvailabilityDecision {
  return Object.freeze({
    visible: false,
    redeemable: false,
    reason,
    usageState,
    activeTimerExpiresAtMs: null,
    nextAvailableAtMs: null,
    proximityDistanceMiles: null,
    eligibilityExpiresAtMs: null,
  });
}

function usageDecision(value: {
  usageRule: unknown;
  usage: CustomerBiteSaverUsageState | null;
  now: Date;
  timeZone: string;
}): Pick<
  CustomerBiteSaverAvailabilityDecision,
  "usageState" | "reason" | "activeTimerExpiresAtMs" | "nextAvailableAtMs"
> {
  const normalizedUsageRule = typeof value.usageRule === "string"
    ? value.usageRule.trim().toLowerCase()
    : "";
  // Coupon.tryFromFirestore treats a missing or blank usage label as the
  // canonical once-per-customer default. Only non-empty, unrecognized labels
  // retain the legacy reusable behavior below.
  const usageRule = normalizedUsageRule.length === 0
    ? "once per customer"
    : normalizedUsageRule;
  const timerStartedAt = value.usage?.timerStartedAt ?? null;
  const timerStartedAtMs = timerStartedAt?.getTime() ?? Number.NaN;
  const timerCompletedAtMs = Number.isFinite(timerStartedAtMs)
    ? timerStartedAtMs + customerBiteSaverRedemptionTimerMilliseconds
    : null;
  const activeTimerExpiresAtMs = timerCompletedAtMs !== null &&
      timerCompletedAtMs > value.now.getTime()
    ? timerCompletedAtMs
    : null;
  if (usageRule === "unlimited") {
    return {
      usageState: "available",
      reason: "available",
      activeTimerExpiresAtMs: null,
      nextAvailableAtMs: null,
    };
  }
  if (usageRule !== "once per customer" && usageRule !== "once per day") {
    // Preserve the current client compatibility contract: legacy/unknown
    // labels are reusable and do not become unavailable when a usage read is
    // absent or transiently unknown.
    return {
      usageState: "available",
      reason: "available",
      // The current client starts a timer for every non-Unlimited label, even
      // when the legacy label itself remains reusable after completion.
      activeTimerExpiresAtMs,
      nextAvailableAtMs: null,
    };
  }
  if (value.usage !== null && !value.usage.known) {
    return {
      usageState: "unknown",
      reason: "usageUnknown",
      activeTimerExpiresAtMs,
      nextAvailableAtMs: null,
    };
  }
  let lastRedeemedAt = value.usage?.lastRedeemedAt ?? null;
  if (
    timerCompletedAtMs !== null &&
    timerCompletedAtMs <= value.now.getTime() &&
    (lastRedeemedAt === null ||
      timerCompletedAtMs > lastRedeemedAt.getTime())
  ) {
    // DemoRedemptionStore finalizes an elapsed timer at this exact boundary,
    // using timerStartedAt + five minutes as the effective redemption time.
    lastRedeemedAt = new Date(timerCompletedAtMs);
  }
  if (lastRedeemedAt === null) {
    return {
      usageState: "available",
      reason: "available",
      activeTimerExpiresAtMs,
      nextAvailableAtMs: null,
    };
  }
  if (usageRule === "once per customer") {
    return {
      usageState: "unavailable",
      reason: "used",
      activeTimerExpiresAtMs,
      nextAvailableAtMs: null,
    };
  }
  if (usageRule === "once per day") {
    const redeemed = localParts(lastRedeemedAt, value.timeZone);
    const now = localParts(value.now, value.timeZone);
    const dayComparison = compareLocalDates(now, redeemed);
    const available = dayComparison > 1 ||
      (dayComparison === 1 && (now.hour > 0 || now.minute >= 1));
    return {
      usageState: available ? "available" : "unavailable",
      reason: available ? "available" : "used",
      activeTimerExpiresAtMs,
      nextAvailableAtMs: available
        ? null
        : nextLocalDailyResetMillis(redeemed, value.timeZone),
    };
  }
  throw new Error("Recognized coupon usage state was not evaluated.");
}

export function evaluateCustomerBiteSaverOfferAvailability(value: {
  offerType: CustomerBiteSaverOfferType;
  offer: Readonly<Record<string, unknown>>;
  parentEligible: boolean;
  now: Date;
  timeZone: string;
  locationMode: "current" | "typed";
  restaurantCoordinates: RestaurantCoordinates | null;
  currentCoordinates?: RestaurantCoordinates | null;
  currentCoordinatesCapturedAt?: Date | null;
  usage?: CustomerBiteSaverUsageState | null;
  requireFreshLocation?: boolean;
}): CustomerBiteSaverAvailabilityDecision {
  if (!value.parentEligible) {
    return inactiveDecision("parentUnavailable");
  }
  const explicitlyInactive = value.offerType === "dailySpecial"
    ? (readCustomerBiteSaverDailySpecialBoolean(value.offer.isActive) ?? true) ===
      false
    : value.offer.isActive === false || value.offer.active === false;
  if (explicitlyInactive) {
    return inactiveDecision("inactive");
  }
  const nowMs = value.now.getTime();
  if (!Number.isFinite(nowMs)) {
    return inactiveDecision("invalidSchedule");
  }
  let visible = true;
  let redeemable = true;
  let scheduleReason: CustomerBiteSaverAvailabilityDecision["reason"] =
    "available";
  let eligibilityExpiresAtMs: number | null = null;
  const capEligibilityAt = (boundaryMs: number): void => {
    if (
      Number.isSafeInteger(boundaryMs) &&
      boundaryMs > nowMs &&
      (eligibilityExpiresAtMs === null || boundaryMs < eligibilityExpiresAtMs)
    ) {
      eligibilityExpiresAtMs = boundaryMs;
    }
  };
  if (value.offerType === "coupon") {
    const start = timestampDate(value.offer.startTime, value.timeZone, "ceil");
    // Match Coupon.tryFromFirestore: a malformed structured endTime does not
    // mask a valid legacy expires timestamp.
    const end = timestampDate(value.offer.endTime, value.timeZone) ??
      timestampDate(value.offer.expires, value.timeZone);
    if (start !== null && nowMs < start.getTime()) {
      return inactiveDecision("notStarted");
    }
    if (end !== null && nowMs > end.getTime()) {
      return inactiveDecision("expired");
    }
    if (end !== null) {
      // Coupon end-times are inclusive in the compatibility contract, so the
      // first millisecond that needs a fresh decision is immediately after it.
      capEligibilityAt(end.getTime() + 1);
    }
  } else {
    const mode = customerBiteSaverDailySpecialAvailabilityMode(
      value.offer.availabilityMode,
    );
    const expiration = timestampDate(
      value.offer.expiresAt,
      value.timeZone,
      "ceil",
    );
    if (
      mode === "todayOnly" &&
      expiration !== null &&
      nowMs >= expiration.getTime()
    ) {
      return inactiveDecision("expired");
    }
    if (mode === "todayOnly" && expiration !== null) {
      capEligibilityAt(expiration.getTime());
    }
    const localNow = localParts(value.now, value.timeZone);
    const requiresLocalDayReevaluation = mode === "specificDays" ||
      (mode === "todayOnly" && expiration === null);
    const remainsWithinEvaluationDay = (local: LegacyCivilDateTime): boolean =>
      !requiresLocalDayReevaluation ||
      (local.year === localNow.year &&
        local.month === localNow.month &&
        local.day === localNow.day);
    if (mode === "todayOnly" && expiration === null) {
      const basis = timestampDate(value.offer.createdAt, value.timeZone) ??
        timestampDate(value.offer.updatedAt, value.timeZone);
      if (
        basis !== null &&
        compareLocalDates(localNow, localParts(basis, value.timeZone)) !== 0
      ) {
        return inactiveDecision("expired");
      }
      const dayBoundary = localMinuteBoundaryMillis({
        localDate: localNow,
        minuteOfDay: 24 * 60,
        timeZone: value.timeZone,
        afterMs: nowMs,
        remainsEligible: remainsWithinEvaluationDay,
      });
      if (dayBoundary === null) {
        return inactiveDecision("invalidSchedule");
      }
      capEligibilityAt(dayBoundary);
    }
    if (
      mode === "specificDays" &&
      !normalizeDays(value.offer.daysOfWeek).has(localNow.weekday)
    ) {
      return inactiveDecision("wrongDay");
    }
    if (mode === "specificDays") {
      // Day membership is deliberately revalidated at the local day boundary,
      // even when adjacent days happen to share the same configured status.
      const dayBoundary = localMinuteBoundaryMillis({
        localDate: localNow,
        minuteOfDay: 24 * 60,
        timeZone: value.timeZone,
        afterMs: nowMs,
        remainsEligible: remainsWithinEvaluationDay,
      });
      if (dayBoundary === null) {
        return inactiveDecision("invalidSchedule");
      }
      capEligibilityAt(dayBoundary);
    }
    const allDay =
      readCustomerBiteSaverDailySpecialBoolean(value.offer.allDay) ?? true;
    const hideWhenUnavailable =
      readCustomerBiteSaverDailySpecialBoolean(
        value.offer.hideWhenUnavailable,
      ) ?? true;
    if (!allDay) {
      const startMinutes = clockMinutes(value.offer.startTime);
      const endMinutes = clockMinutes(value.offer.endTime);
      if (
        startMinutes === null ||
        endMinutes === null ||
        endMinutes <= startMinutes
      ) {
        if (hideWhenUnavailable) {
          return inactiveDecision("invalidSchedule");
        }
        redeemable = false;
        scheduleReason = "invalidSchedule";
      } else {
        const nowMinutes = localNow.hour * 60 + localNow.minute;
        if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
          redeemable = false;
          scheduleReason = "outsideTimeWindow";
          visible = !hideWhenUnavailable;
          if (!visible) {
            return inactiveDecision("outsideTimeWindow");
          }
        } else {
          const windowBoundary = localMinuteBoundaryMillis({
            localDate: localNow,
            minuteOfDay: endMinutes + 1,
            timeZone: value.timeZone,
            afterMs: nowMs,
            remainsEligible: (local) => {
              const localMinutes = local.hour * 60 + local.minute;
              return remainsWithinEvaluationDay(local) &&
                localMinutes >= startMinutes &&
                localMinutes <= endMinutes;
            },
          });
          if (windowBoundary === null) {
            return inactiveDecision("invalidSchedule");
          }
          capEligibilityAt(windowBoundary);
        }
      }
    }
  }

  let proximityDistanceMiles: number | null = null;
  if (
    value.offerType === "coupon" &&
    readCustomerBiteSaverCouponBoolean(value.offer.isProximityOnly) === true
  ) {
    if (value.locationMode !== "current") {
      return inactiveDecision("typedLocation");
    }
    const restaurant = value.restaurantCoordinates;
    const current = value.currentCoordinates;
    if (
      restaurant === null ||
      current === undefined ||
      current === null ||
      validRestaurantCoordinates(current.latitude, current.longitude) === null
    ) {
      return inactiveDecision("missingFreshLocation");
    }
    if (value.requireFreshLocation === true) {
      const captured = value.currentCoordinatesCapturedAt?.getTime();
      if (
        captured === undefined ||
        !Number.isFinite(captured) ||
        captured > nowMs + 5_000 ||
        nowMs - captured > customerBiteSaverFreshLocationMaximumAgeMilliseconds
      ) {
        return inactiveDecision("missingFreshLocation");
      }
      capEligibilityAt(
        captured + customerBiteSaverFreshLocationMaximumAgeMilliseconds + 1,
      );
    }
    const radius = readCustomerBiteSaverFiniteDouble(
      value.offer.proximityRadiusMiles,
    );
    if (radius === null || radius < 0) {
      return inactiveDecision("outsideProximity");
    }
    proximityDistanceMiles = exactCustomerBiteSaverDistanceMiles(
      current,
      restaurant,
    );
    if (proximityDistanceMiles > radius) {
      return inactiveDecision("outsideProximity");
    }
  }

  const usage = value.offerType === "coupon"
    ? usageDecision({
        usageRule: value.offer.usageRule,
        usage: value.usage ?? null,
        now: value.now,
        timeZone: value.timeZone,
      })
    : {
        usageState: "available" as const,
        reason: "available" as const,
        activeTimerExpiresAtMs: null,
        nextAvailableAtMs: null,
      };
  if (
    usage.usageState === "available" &&
    usage.activeTimerExpiresAtMs !== null
  ) {
    capEligibilityAt(usage.activeTimerExpiresAtMs);
  }
  if (usage.usageState !== "available") {
    return Object.freeze({
      // A transient or malformed caller-usage read must remain explicit and
      // retriable. Keep the otherwise-current offer visible as disabled with
      // `usageUnknown`; a known consumed offer remains suppressed.
      visible: usage.usageState === "unknown",
      redeemable: false,
      reason: usage.reason,
      usageState: usage.usageState,
      activeTimerExpiresAtMs: usage.activeTimerExpiresAtMs,
      nextAvailableAtMs: usage.nextAvailableAtMs,
      proximityDistanceMiles,
      eligibilityExpiresAtMs,
    });
  }
  return Object.freeze({
    visible,
    redeemable,
    reason: scheduleReason,
    usageState: usage.usageState,
    activeTimerExpiresAtMs: usage.activeTimerExpiresAtMs,
    nextAvailableAtMs: usage.nextAvailableAtMs,
    proximityDistanceMiles,
    eligibilityExpiresAtMs,
  });
}

export function customerBiteSaverAvailabilityLocalPartsForTesting(
  date: Date,
  timeZone: string,
): LocalDateTimeParts {
  return localParts(date, timeZone);
}
