// src/features/business/lib/time-parse.ts
// Canonical time-range parser shared by the parse-job route and the eval auditor, so both
// compute stated-session minutes from ONE implementation. Lines are normalised first
// (noon/midnight, dotted meridiems, dot minutes), a wholly bare fragment takes the
// meridiem a support job actually runs at, then a non-positive span retries as an am/pm
// pair (+12h) if the meridiem was assumed, or rolls overnight if it was stated.
// Overlapping ranges merge so a minute never bills twice, but only inside ONE day: a date
// or weekday header, or a prose line naming a weekday next to its range, opens a new
// bucket, so the same clock time worked on two days bills twice instead of collapsing into
// one. Pure, so tsx can import it.

/** am/pm marker, or null when a time fragment carries none. */
type Meridiem = "am" | "pm" | null;

/** One parsed start/end range plus its resolved duration in minutes. */
export interface ParsedTimeRange {
  startTime: string;
  endTime: string;
  durationMins: number;
  /** 0-based day bucket; only ranges sharing one can merge. */
  day: number;
}

/** Merge outcome for one description, so callers can warn on swallowed minutes. */
export interface RangeStats {
  ranges: ParsedTimeRange[];
  /** Sum of every range as written, before overlaps merge. */
  statedMins: number;
  /** Sum after merging within each day - what actually bills. */
  billableMins: number;
  /** Minutes the merge removed. Above zero means ranges genuinely overlapped. */
  discardedMins: number;
  /**
   * Each day's first-start-to-last-end span, summed. Gaps within a day count, so this
   * sits at or above billableMins; a caller ceiling built on it cannot cap a multi-day
   * job at one day's clock times.
   */
  spanMins: number;
  /**
   * Ranges read off a prose line naming a weekday ("MacBook printer set up Friday, 1:46 pm
   * to 2:05 pm"), as written before merging. Each belongs to the work named on its line.
   */
  taskLineRanges: { startTime: string; endTime: string; durationMins: number }[];
}

// One range: two time fragments - colon ("11:30"), compact ("0900", "130") or bare hours,
// each with an optional meridiem - split by a dash, "to", or whitespace. Bare-space pairs
// with a compact fragment are rejected in extractRangeStats so phone numbers can't pair up.
const TIME_RANGE_RE =
  /(\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\s*(am|pm)?(\s*[-–—]\s*|\s+to\s+|\s+)(\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\s*(am|pm)?/gi;

/** Weekday-led lines also count as time lines ("Tue 4 Aug, 9-11am"). */
const WEEKDAY_LEAD_RE = /^(?:mon|tue|wed|thu|fri|sat|sun)/i;

const MONTH_ALT = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

// A line naming a day opens the next bucket. The weekday branch demands a date, closing
// punctuation or the line end after the name so prose ("Sat down with the client") is not
// read as a Saturday, and the slashed-date branch demands the same so "1/2 hour on the
// phone" is not read as the 1st of February.
const DAY_HEADER_RE = new RegExp(
  "^(?:" +
    `(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\s*(?:$|[,:;-]|\\d|(?:${MONTH_ALT}))` +
    "|day\\s*\\d" +
    "|\\d{4}-\\d{2}-\\d{2}" +
    "|\\d{1,2}\\s*/\\s*\\d{1,2}(?:\\s*/\\s*\\d{2,4})?\\s*(?:$|[,:;-])" +
    `|\\d{1,2}\\s*(?:${MONTH_ALT})` +
    `|(?:${MONTH_ALT})[a-z]*\\s*\\d{1,2}` +
    ")",
  "i",
);

/** Weekday abbreviations, Sunday first so the index matches Date.getUTCDay(). */
const WEEKDAY_ABBREVS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// A full weekday name anywhere in a prose line ("printer set up Friday, 1:46-2:05pm"). Full
// names only: "sat", "sun" and "mon" are ordinary words mid-sentence.
const PROSE_WEEKDAY_RE = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

/**
 * Weekday of a YYYY-MM-DD date key.
 * @param dateKey - Date key such as "2026-10-07".
 * @returns 0 (Sunday) to 6, or null when the key is not a real date.
 */
export function weekdayOfDateKey(dateKey: string): number | null {
  const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return Number.isNaN(day) ? null : day;
}

/**
 * Weekday a day header names: a leading weekday ("Fri 9 Oct") or an ISO date line.
 * @param line - A line {@link DAY_HEADER_RE} matched.
 * @returns 0 (Sunday) to 6, or null for headers that name no weekday ("Day 2", "9 Oct").
 */
function headerWeekday(line: string): number | null {
  if (WEEKDAY_LEAD_RE.test(line)) return WEEKDAY_ABBREVS.indexOf(line.slice(0, 3).toLowerCase());
  return weekdayOfDateKey(line);
}

/**
 * Detects the compact no-colon form ("0900", "130").
 * @param fragment - Digits-only time fragment.
 * @returns True when the fragment is 3-4 bare digits.
 */
function isCompact(fragment: string): boolean {
  return /^\d{3,4}$/.test(fragment);
}

/**
 * Normalises one line's time notation so {@link TIME_RANGE_RE} only has to
 * match the canonical shapes: word times to 12am/12pm, dotted meridiems
 * ("9 A.M.") to plain am/pm, and dot minutes ("9.30") to colon form.
 * @param line - Raw input line.
 * @returns Normalised line.
 */
function normaliseTimeLine(line: string): string {
  return line
    .replace(/\bnoon\b/gi, "12pm")
    .replace(/\bmidnight\b/gi, "12am")
    .replace(/([ap])\.\s?m\.?/gi, "$1m")
    .replace(/(\d)\.(\d{2})(?!\d)/g, "$1:$2");
}

/**
 * Picks the meridiem for a bare fragment from the hours a support job actually
 * runs: 1-6 is afternoon, 7-11 is morning, 12 is noon. Compact fragments are
 * left alone because writing "0415" is a deliberate 24-hour reading, and so is
 * a zero-padded hour ("06:00", "00:30" - the form the calculator itself sends
 * its windows in) and anything from 13 up - handing {@link parseTimeMins} a "pm"
 * above 12 would make it reject the fragment outright.
 * @param fragment - Digits-only time fragment ("4", "4:15", "0415").
 * @returns Inferred meridiem, or null to keep the fragment's literal reading.
 */
function inferBareMeridiem(fragment: string): Meridiem {
  if (isCompact(fragment) || fragment.startsWith("0")) return null;
  const h = parseInt(fragment.includes(":") ? (fragment.split(":")[0] ?? "") : fragment, 10);
  if (Number.isNaN(h) || h < 1 || h > 12) return null;
  return h <= 6 || h === 12 ? "pm" : "am";
}

/**
 * Parses a time fragment into minutes since midnight. Compact fragments split
 * as H(H)MM ("0900" > 9:00, "130" > 1:30). Rejects impossible clock values -
 * minutes over 59, hours over 12 with a meridiem, hours over 23 without.
 * @param fragment - Digits-only time fragment ("7", "11:30", "0900").
 * @param meridiem - Stated, assumed or inferred meridiem, or null for 24-hour reading.
 * @returns Minutes since midnight, or null if not a plausible clock time.
 */
function parseTimeMins(fragment: string, meridiem: Meridiem): number | null {
  let h: number;
  let m: number;
  if (fragment.includes(":")) {
    const [hStr = "", mStr = ""] = fragment.split(":");
    h = parseInt(hStr, 10);
    m = parseInt(mStr, 10);
  } else if (isCompact(fragment)) {
    h = parseInt(fragment.slice(0, -2), 10);
    m = parseInt(fragment.slice(-2), 10);
  } else {
    h = parseInt(fragment, 10);
    m = 0;
  }
  if (Number.isNaN(h) || Number.isNaN(m) || m > 59) return null;
  if (meridiem !== null && h > 12) return null;
  if (meridiem === null && h > 23) return null;
  if (meridiem === "pm") return (h === 12 ? 12 : h + 12) * 60 + m;
  if (meridiem === "am") return (h === 12 ? 0 : h) * 60 + m;
  return h * 60 + m;
}

/**
 * Formats minutes-since-midnight as a HH:MM string. Wraps at 24h boundaries
 * so a "11pm-1am" overnight range still serialises cleanly.
 * @param mins - Minutes since midnight (may exceed 1440 for cross-midnight ends).
 * @returns HH:MM string.
 */
function minsToHHMM(mins: number): string {
  const wrapped = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Reads one TIME_RANGE_RE match into a clock interval, resolving the meridiem and any
 * overnight or am/pm roll.
 * @param line - The normalised line the match came from.
 * @param match - The range match.
 * @returns Start and end in minutes since midnight (end may pass 1440), or null when the
 * match is a phone number, a dashed date, an impossible time or a zero-length range.
 */
function readRange(line: string, match: RegExpMatchArray): { start: number; end: number } | null {
  const [, startRaw = "", startMerRaw, sep = "", endRaw = "", endMerRaw] = match;
  // Bare-space compact pairs are phone numbers or IDs, never a range.
  if (!/[-–—]|to/.test(sep) && (isCompact(startRaw) || isCompact(endRaw))) return null;
  // A dashed date reads as a range at face value: "2026-08-25" pairs 2026 with 08 as
  // 20:26-08:00, a near-15-hour overnight. A third dash-joined number on either side
  // means it is a date, not a time - no real range carries one.
  const matchEnd = (match.index ?? 0) + match[0].length;
  if (/^\s*[-–—]\s*\d/.test(line.slice(matchEnd))) return null;
  if (/\d\s*[-–—]\s*$/.test(line.slice(0, match.index ?? 0))) return null;
  const startMer = (startMerRaw?.toLowerCase() ?? null) as Meridiem;
  const endMer = (endMerRaw?.toLowerCase() ?? null) as Meridiem;
  // A meridiem stated on either end covers both; only a wholly bare pair is inferred.
  let start = parseTimeMins(startRaw, startMer ?? endMer ?? inferBareMeridiem(startRaw));
  const end = parseTimeMins(endRaw, endMer ?? startMer ?? inferBareMeridiem(endRaw));
  if (start === null || end === null) return null;
  // Zero-length states no duration - never invent a 12h or 24h roll.
  let dur = end - start;
  if (dur === 0) return null;
  if (dur < 0) {
    const withNoon = dur + 12 * 60;
    if (startMer !== null && endMer !== null) {
      // Both meridiems stated ("2pm-9am"): genuinely overnight.
      dur += 24 * 60;
    } else if (withNoon > 0 && withNoon <= 16 * 60) {
      // Assumed meridiem: retry as an am/pm pair. When the start borrowed the end's,
      // the start is the half that flips: "11-1pm" (read 23:00-13:00) is 11:00-13:00,
      // and "11-1am" (read 11:00-01:00) is 23:00-01:00.
      if (startMer === null && endMer !== null) start += endMer === "pm" ? -12 * 60 : 12 * 60;
      dur = withNoon;
    } else {
      dur += 24 * 60;
    }
  }
  return { start, end: start + dur };
}

/**
 * Whether a range match in prose is clearly clock times: a dashed or "to" pair with a
 * colon, a meridiem or four digits on one side, and no price or date run-on. Mid-sentence
 * a bare pair is too often a count ("2-3 hours") or a price ("$50-60") to trust.
 * @param line - The normalised line the match came from.
 * @param match - The range match.
 * @returns True when the match can only be a time range.
 */
function isProseRange(line: string, match: RegExpMatchArray): boolean {
  const [, startRaw = "", startMer, sep = "", endRaw = "", endMer] = match;
  if (!/[-–—]|to/.test(sep)) return false;
  if (!startMer && !endMer && !isClockShaped(startRaw) && !isClockShaped(endRaw)) return false;
  const before = line.slice(0, match.index ?? 0);
  const after = line.slice((match.index ?? 0) + match[0].length);
  return !/[$\d]\s*[-–—]?\s*$/.test(before) && !/^\s*[-–—]\s*\d/.test(after);
}

/** One pass over a description's lines: the ranges to bill, and the day of every stated one. */
interface RangeWalk {
  /** Readable ranges, each in its 0-based day bucket. */
  intervals: { day: number; start: number; end: number }[];
  /** Weekday (0 = Sunday) of every range the text states, or null when no day is named for it. */
  statedWeekdays: (number | null)[];
  /** The subset of intervals read off a prose line naming a weekday. */
  taskLine: { start: number; end: number }[];
}

/**
 * Walks a description line by line. Ranges are read on digit-led and weekday-led lines,
 * and on a prose line that names a weekday in full ("MacBook printer set up Friday, 1:46
 * pm to 2:05 pm"), which also opens that day's bucket. An undated mid-sentence range is
 * only recorded as stated, never billed from here: without a day it could be the booked
 * visit restated, or a future appointment.
 * @param input - Raw job description text.
 * @returns The billable intervals and the weekday of every stated range.
 */
function walkRanges(input: string): RangeWalk {
  const intervals: RangeWalk["intervals"] = [];
  const statedWeekdays: (number | null)[] = [];
  const taskLine: RangeWalk["taskLine"] = [];
  // `buckets` counts every day opened; `headerDay`/`weekday` are the day the last header
  // opened, which carries onto the lines under it.
  let buckets = 0;
  let headerDay = 0;
  let weekday: number | null = null;
  for (const rawLine of input.split("\n")) {
    const line = normaliseTimeLine(rawLine.trim());
    // A header opens the next day before its own ranges are read, so
    // "Tue 4 Aug, 9-11am" lands on the day it names rather than the one before.
    if (DAY_HEADER_RE.test(line)) {
      buckets += 1;
      headerDay = buckets;
      weekday = headerWeekday(line);
    }
    const timeLine = /^\d/.test(line) || WEEKDAY_LEAD_RE.test(line);
    const matches = [...line.matchAll(TIME_RANGE_RE)];
    const prose = timeLine ? [] : matches.filter((m) => isProseRange(line, m));
    const named = prose.length > 0 ? line.match(PROSE_WEEKDAY_RE)?.[1] : undefined;
    const namedDay = named ? WEEKDAY_ABBREVS.indexOf(named.slice(0, 3).toLowerCase()) : null;
    // Naming the day already open stays in it; any other day is a separate visit. That
    // visit is this line only: a digit-led line after it belongs to the header above
    // again, not to the day the prose named.
    let day = headerDay;
    let lineWeekday = weekday;
    if (namedDay !== null && namedDay !== weekday) {
      buckets += 1;
      day = buckets;
      lineWeekday = namedDay;
    }
    for (const match of matches) {
      const billable = timeLine || (namedDay !== null && prose.includes(match));
      const read = billable ? readRange(line, match) : null;
      if (read) intervals.push({ day, ...read });
      if (read && !timeLine) taskLine.push(read);
      if (read || isProseRange(line, match)) statedWeekdays.push(lineWeekday);
    }
  }
  return { intervals, statedWeekdays, taskLine };
}

/**
 * Extracts every start/end time segment {@link walkRanges} reads, then merges
 * overlapping or duplicate segments WITHIN each day so a pasted duplicate cannot
 * double-bill while a genuine second day cannot be swallowed. Zero-length ranges
 * ("9am-9am") state no duration and are dropped. Used to compute the worked-minutes
 * hint passed to the AI as a "pre-computed session total" annotation, and by the
 * auditor to derive the canonical expected duration.
 * @param input - Raw job description text.
 * @returns Ranges plus the stated, billable and discarded minute totals.
 */
export function extractRangeStats(input: string): RangeStats {
  const { intervals, taskLine } = walkRanges(input);
  const statedMins = intervals.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
  // Merge overlaps and duplicates - the same minute of the same DAY can only be worked
  // once. Sorting by day first keeps each day's run contiguous for the sweep.
  intervals.sort((a, b) => a.day - b.day || a.start - b.start || a.end - b.end);
  const merged: { day: number; start: number; end: number }[] = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && last.day === iv.day && iv.start < last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ ...iv });
  }
  const ranges = merged.map((iv) => ({
    startTime: minsToHHMM(iv.start),
    endTime: minsToHHMM(iv.end),
    durationMins: iv.end - iv.start,
    day: iv.day,
  }));
  const billableMins = ranges.reduce((sum, r) => sum + r.durationMins, 0);
  // merged is sorted by day then start, so the first entry of a day carries its earliest
  // start and every later one can only push the end out.
  const spanByDay = new Map<number, { start: number; end: number }>();
  for (const iv of merged) {
    const seen = spanByDay.get(iv.day);
    if (seen) seen.end = Math.max(seen.end, iv.end);
    else spanByDay.set(iv.day, { start: iv.start, end: iv.end });
  }
  const spanMins = [...spanByDay.values()].reduce((sum, d) => sum + (d.end - d.start), 0);
  const taskLineRanges = taskLine.map((iv) => ({
    startTime: minsToHHMM(iv.start),
    endTime: minsToHHMM(iv.end),
    durationMins: iv.end - iv.start,
  }));
  return {
    ranges,
    statedMins,
    billableMins,
    discardedMins: statedMins - billableMins,
    spanMins,
    taskLineRanges,
  };
}

/**
 * Whether a bare fragment can only be a clock time: "4:30" or "0900", not "2" or "50".
 * @param fragment - Digits-only time fragment.
 * @returns True for a colon or four-digit fragment.
 */
function isClockShaped(fragment: string): boolean {
  return fragment.includes(":") || fragment.length === 4;
}

/**
 * Whether the description states a time range anywhere, including mid-sentence ("TV setup
 * 4:30-5:40") where {@link extractRangeStats} doesn't bill from. Mid-sentence, only a
 * dashed or "to" pair counts, and one side must be clock-shaped (a colon, a meridiem, or
 * four digits), so a count ("2-3 hours"), a price ("$50-60") or a dashed date is not read
 * as times.
 * @param input - Raw job description text.
 * @returns True when the text names a time range of its own.
 */
export function statesTimeRange(input: string): boolean {
  return walkRanges(input).statedWeekdays.length > 0;
}

/**
 * The day each stated range falls on, so a caller can tell a later visit ("Friday,
 * 1:46-2:05pm") from times that restate the booked one.
 * @param input - Raw job description text.
 * @returns One weekday (0 = Sunday) per range {@link statesTimeRange} counts, or null for
 * a range with no day named on its line or in a header above it.
 */
export function statedRangeWeekdays(input: string): (number | null)[] {
  return walkRanges(input).statedWeekdays;
}

/**
 * Extracts the merged time segments for a description - a thin wrapper over
 * {@link extractRangeStats} for callers that need only the ranges.
 * @param input - Raw job description text.
 * @returns Array of parsed time ranges (may be empty when nothing detected).
 */
export function extractRanges(input: string): ParsedTimeRange[] {
  return extractRangeStats(input).ranges;
}

/**
 * Sums all merged time segments found by {@link extractRanges}. Feeds the AI
 * pre-compute hint so the model uses the operator-stated minutes verbatim.
 * @param input - Raw job description text.
 * @returns Total worked minutes, or null if no time ranges detected.
 */
export function calcSessionMins(input: string): number | null {
  const stats = extractRangeStats(input);
  if (stats.ranges.length === 0) return null;
  return stats.billableMins;
}
