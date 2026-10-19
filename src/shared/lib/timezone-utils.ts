// src/shared/lib/timezone-utils.ts
// Timezone utility functions for Pacific/Auckland timezone calculations.

/** The one NZ timezone name. Exported so nothing has to hardcode the literal. */
export const NZ_TZ = "Pacific/Auckland";

// Built once and reused: constructing an Intl.DateTimeFormat is the expensive
// part, .format() is cheap, and the schedule views call this per event.
// en-CA reliably yields YYYY-MM-DD on every Node.js platform.
const nzDateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Weekday and time-of-day in NZ. Separate formatters rather than deriving both
// from one, because a single formatter cannot yield a numeric weekday and
// zero-padded 24-hour parts at once.
const nzWeekdayFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TZ,
  weekday: "short",
});
const nzTimeFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Intl gives a name, not an index, and the index is what a weekday filter
// stores. 0 = Sunday, matching JS getDay() and the schema's activeWeekdays.
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Same deal, with the time parts a datetime-local input needs.
const nzInputFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * The NZ weekday of an instant. Never UTC: that moves the day boundary to 11am or noon NZ.
 * @param date - The instant to read.
 * @returns Weekday index, 0 = Sunday through 6 = Saturday.
 */
export function nzWeekday(date: Date): number {
  // en-NZ short weekdays can arrive as "Tue" or "Tue." depending on the ICU
  // build, so match on the first three letters rather than the whole string.
  const name = nzWeekdayFormat.format(date).slice(0, 3);
  return WEEKDAY_INDEX[name] ?? 0;
}

/**
 * Minutes since NZ midnight for an instant, for a time-of-day comparison.
 * @param date - The instant to read.
 * @returns Minutes from 0 (midnight) to 1439 (23:59).
 */
export function nzMinuteOfDay(date: Date): number {
  // "24" appears for midnight on some ICU builds; fold it back to 0 so the
  // result never lands outside the day.
  const [h = NaN, m = NaN] = nzTimeFormat.format(date).split(":").map(Number);
  return (h % 24) * 60 + m;
}

/**
 * Current NZ wall-clock time, whatever timezone the browser or server runs in.
 * @returns HH:MM (24-hour).
 */
export function nzNowTime(): string {
  const mins = nzMinuteOfDay(new Date());
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * An instant's NZ calendar date; the server runs in UTC, which would shift evenings a day.
 * @param date - The instant to read.
 * @returns NZ calendar date as YYYY-MM-DD.
 */
export function nzDateKey(date: Date): string {
  return nzDateKeyFormat.format(date);
}

/**
 * Today's NZ calendar date.
 * @returns NZ calendar date as YYYY-MM-DD.
 */
export function nzTodayKey(): string {
  return nzDateKey(new Date());
}

/**
 * Splits a YYYY-MM-DD key into numbers; a malformed key gives NaN parts for Number.isNaN guards.
 * @param key - Date key, e.g. "2026-09-07".
 * @returns Tuple of [year, month (1-12), day].
 */
export function dateKeyParts(key: string): [number, number, number] {
  const [y = NaN, m = NaN, d = NaN] = key.split("-").map(Number);
  return [y, m, d];
}

/**
 * Splits HH:MM into numbers; a fragment with no colon gives NaN, as in {@link dateKeyParts}.
 * @param hhmm - Time string, e.g. "09:30".
 * @returns Tuple of [hours, minutes].
 */
export function timeParts(hhmm: string): [number, number] {
  const [h = NaN, m = NaN] = hhmm.split(":").map(Number);
  return [h, m];
}

/** A weekday index as `getUTCDay()` numbers them: 0 = Sunday .. 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Every weekday in `getUTCDay()` order, so {@link Weekday}-keyed maps index without widening to `number`. */
export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Weekday names in `getUTCDay()` order, for labels and schema.org output. */
export const DAY_NAMES: Record<Weekday, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

/**
 * An instant's UTC weekday as a {@link Weekday}; `getUTCDay()` is typed `number`, so assert once here.
 * @param date - The instant to read.
 * @returns The weekday, 0 = Sunday .. 6 = Saturday.
 */
export function weekdayOf(date: Date): Weekday {
  return date.getUTCDay() as Weekday;
}

/**
 * Splits an instant into its NZ calendar year, month and day.
 * @param date - The instant to read.
 * @returns Tuple of [year, month (1-12), day].
 */
export function nzDateParts(date: Date): [number, number, number] {
  const [y = NaN, m = NaN, d = NaN] = nzDateKey(date).split("-").map(Number);
  return [y, m, d];
}

/**
 * Collapses an instant to UTC midnight of its NZ day, the scale ledger dates are stored on
 * ("2026-04-01" parses as UTC midnight). Unlike {@link nzMidnightUtc}, which is the real NZ midnight.
 * @param instant - The instant to collapse.
 * @returns UTC midnight of that instant's NZ calendar day.
 */
export function nzDayStartUtc(instant: Date): Date {
  const [y, m, d] = nzDateParts(instant);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Formats an instant as NZ-local "YYYY-MM-DDTHH:mm" for datetime-local inputs, whatever the
 * browser or server timezone.
 * @param input - The instant to format.
 * @returns NZ-local datetime string.
 */
export function toNzInputValue(input: Date | string): string {
  const parts = nzInputFormat.formatToParts(typeof input === "string" ? new Date(input) : input);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}T${map.get("hour")}:${map.get("minute")}`;
}

/**
 * Parses an NZ-local datetime-local value to UTC with the offset in force then. Reject empty
 * input first.
 * @param local - Input value from a datetime-local field, read as NZ time.
 * @returns The equivalent UTC Date.
 */
export function fromNzInputValue(local: string): Date {
  const [datePart, timePart] = local.split("T");
  // Without both halves the next .split throws an unnamed TypeError on
  // undefined; say which value was wrong instead.
  if (datePart === undefined || timePart === undefined) {
    throw new Error(`fromNzInputValue expects "YYYY-MM-DDTHH:MM", received "${local}"`);
  }
  const [y = NaN, m = NaN, d = NaN] = datePart.split("-").map(Number);
  const [hh = NaN, mm = NaN] = timePart.split(":").map(Number);
  return nzWallClockUtc(y, m, d, hh, mm);
}

/**
 * NZ midnight of a date as a UTC instant (NZDT/NZST via {@link getPacificAucklandOffset}), not
 * UTC midnight, which is 12-13h off.
 * @param year - Full year.
 * @param month - Month 1-12 (overflow wraps, e.g. month 13 > January next year).
 * @param day - Day of month (overflow wraps, e.g. day 32 > next month).
 * @returns UTC Date at NZ midnight of that date.
 */
export function nzMidnightUtc(year: number, month: number, day: number): Date {
  return nzWallClockUtc(year, month, day, 0, 0);
}

/**
 * An NZ wall-clock time on a date as a UTC instant. Two passes, because
 * {@link getPacificAucklandOffset} reads NZ midday: on changeover days a single pass put midnight
 * an hour out. A skipped September time (2:30am) lands an hour later; April's repeated hour
 * resolves to NZST.
 * @param year - Full year.
 * @param month - Month 1-12 (overflow wraps).
 * @param day - Day of month (overflow wraps).
 * @param hour - NZ wall-clock hour, 0-23.
 * @param minute - NZ wall-clock minute (defaults to 0).
 * @returns UTC Date for that NZ wall-clock moment.
 */
export function nzWallClockUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const middayOffset = getPacificAucklandOffset(year, month, day);
  const guess = new Date(Date.UTC(year, month - 1, day, hour - middayOffset, minute, 0));
  // Bad parts give an Invalid Date, which callers test for; formatting one throws.
  if (Number.isNaN(guess.getTime())) return guess;
  const offset = nzOffsetHoursAt(guess);
  return offset === middayOffset
    ? guess
    : new Date(Date.UTC(year, month - 1, day, hour - offset, minute, 0));
}

/**
 * The NZ offset in force at an exact instant, in hours: the NZ wall clock read
 * as if it were UTC, minus the instant itself.
 * @param instant - The instant to read.
 * @returns 12 (NZST) or 13 (NZDT).
 */
function nzOffsetHoursAt(instant: Date): number {
  const parts = new Map(nzInputFormat.formatToParts(instant).map((p) => [p.type, p.value]));
  const wallAsUtc = Date.UTC(
    Number(parts.get("year")),
    Number(parts.get("month")) - 1,
    Number(parts.get("day")),
    // Some ICU builds write midnight as "24" under hour12: false.
    Number(parts.get("hour")) % 24,
    Number(parts.get("minute")),
  );
  // The wall clock drops the seconds, so round off the difference.
  return Math.round((wallAsUtc - instant.getTime()) / 3_600_000);
}

/**
 * Adds `n` days to a YYYY-MM-DD key, via UTC noon so DST can't roll the date back.
 * @param dateKey - The base day (YYYY-MM-DD).
 * @param n - Days to add (may be negative).
 * @returns The shifted YYYY-MM-DD key.
 */
export function addDaysToDateKey(dateKey: string, n: number): string {
  const [y = NaN, m = NaN, d = NaN] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12, 0, 0)).toISOString().slice(0, 10);
}

/**
 * The next future instant at an NZ time on the job date's weekday, since Google only quotes
 * traffic for future departures. The offset is read on the target date, so DST keeps the hour.
 * @param hour - NZ hour, 0-23.
 * @param minute - NZ minute, 0-59.
 * @param anchorDate - YYYY-MM-DD whose weekday to match; missing or malformed means today.
 * @param now - The current instant.
 * @returns Today while the time is ahead, else the next matching day (a week on with an anchor).
 */
export function nextNzWallClockOnWeekday(
  hour: number,
  minute: number,
  anchorDate?: string,
  now: Date = new Date(),
): Date {
  const todayKey = nzDateKey(now);
  const hasAnchor = !!anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate);
  let daysAhead = 0;
  if (hasAnchor) {
    /**
     * Weekday of a date key. Timezone-independent when computed in UTC.
     * @param key - YYYY-MM-DD.
     * @returns 0 = Sunday .. 6 = Saturday.
     */
    const dow = (key: string): number => {
      const [y, m, d] = dateKeyParts(key);
      return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    };
    daysAhead = (dow(anchorDate) - dow(todayKey) + 7) % 7;
  }
  /**
   * The requested wall-clock time on a given NZ date.
   * @param key - YYYY-MM-DD.
   * @returns That instant, with the offset in force on that date.
   */
  const at = (key: string): Date => {
    const [y, m, d] = dateKeyParts(key);
    return nzWallClockUtc(y, m, d, hour, minute);
  };
  const targetKey = addDaysToDateKey(todayKey, daysAhead);
  const first = at(targetKey);
  if (first.getTime() >= now.getTime()) return first;
  return at(addDaysToDateKey(targetKey, hasAnchor ? 7 : 1));
}

/**
 * UTC offset for Pacific/Auckland on a date: 13 NZDT (Sep-Apr), 12 NZST (Apr-Sep).
 * @param year - Full year.
 * @param month - Month 1-12 (not 0-indexed).
 * @param day - Day of month.
 * @returns Offset in hours (12 or 13).
 */
export function getPacificAucklandOffset(year: number, month: number, day: number): number {
  // Take the NZ wall-clock hour at UTC midnight; since UTC is at hour 0,
  // that hour equals the offset directly. This sidesteps Intl DST APIs.
  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const nzHour = parseInt(
    utcMidnight.toLocaleString("en-US", {
      timeZone: NZ_TZ,
      hour: "numeric",
      hour12: false,
    }),
    10,
  );
  return nzHour;
}
