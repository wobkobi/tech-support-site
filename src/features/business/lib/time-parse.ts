// src/features/business/lib/time-parse.ts
// Canonical time-range parser shared by the admin parse-job route and the eval
// auditor, so both compute stated-session minutes from ONE implementation.
// Lines are normalised first (noon/midnight, dotted meridiems, dot minutes),
// then paired times are resolved: an assumed meridiem retries a non-positive
// span as an am/pm pair (+12h) before rolling overnight, while explicitly
// stated meridiems roll straight overnight. Overlapping and duplicate ranges
// merge so the same minute never bills twice. Pure and dependency-free so the
// tsx eval harness can import it.

/** am/pm marker, or null when a time fragment carries none. */
type Meridiem = "am" | "pm" | null;

/** One parsed start/end range plus its resolved duration in minutes. */
export interface ParsedTimeRange {
  startTime: string;
  endTime: string;
  durationMins: number;
}

// One range: two time fragments - colon form ("11:30"), compact form ("0900",
// "130"), or bare hours, each with an optional meridiem - split by a dash,
// "to", or plain whitespace. Bare-space pairs involving a compact fragment
// are rejected in extractRanges so phone numbers cannot pair up as times.
const TIME_RANGE_RE =
  /(\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\s*(am|pm)?(\s*[-–—]\s*|\s+to\s+|\s+)(\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\s*(am|pm)?/gi;

/** Weekday-led lines also count as time lines ("Tue 4 Aug, 9-11am"). */
const WEEKDAY_LEAD_RE = /^(?:mon|tue|wed|thu|fri|sat|sun)/i;

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
 * Parses a time fragment into minutes since midnight. Compact fragments split
 * as H(H)MM ("0900" > 9:00, "130" > 1:30). Rejects impossible clock values -
 * minutes over 59, hours over 12 with a meridiem, hours over 23 without.
 * @param fragment - Digits-only time fragment ("7", "11:30", "0900").
 * @param meridiem - Stated or assumed meridiem, or null for 24-hour reading.
 * @returns Minutes since midnight, or null if not a plausible clock time.
 */
function parseTimeMins(fragment: string, meridiem: Meridiem): number | null {
  let h: number;
  let m: number;
  if (fragment.includes(":")) {
    const [hStr, mStr] = fragment.split(":");
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
 * Extracts every start/end time segment found on digit-led or weekday-led
 * lines, then merges overlapping or duplicate segments so a pasted duplicate
 * or overlapping pair cannot double-bill. Zero-length ranges ("9am-9am")
 * state no duration and are dropped. Used to compute the worked-minutes hint
 * passed to the AI as a "pre-computed session total" annotation, and by the
 * auditor to derive the canonical expected duration.
 * @param input - Raw job description text.
 * @returns Array of parsed time ranges (may be empty when nothing detected).
 */
export function extractRanges(input: string): ParsedTimeRange[] {
  const intervals: { start: number; end: number }[] = [];
  for (const rawLine of input.split("\n")) {
    const line = normaliseTimeLine(rawLine.trim());
    if (!/^\d/.test(line) && !WEEKDAY_LEAD_RE.test(line)) continue;
    for (const match of line.matchAll(TIME_RANGE_RE)) {
      const [, startRaw, startMerRaw, sep, endRaw, endMerRaw] = match;
      // Bare-space compact pairs are phone numbers or IDs, never a range.
      if (!/[-–—]|to/.test(sep) && (isCompact(startRaw) || isCompact(endRaw))) continue;
      const startMer = (startMerRaw?.toLowerCase() ?? null) as Meridiem;
      const endMer = (endMerRaw?.toLowerCase() ?? null) as Meridiem;
      const start = parseTimeMins(startRaw, startMer ?? endMer);
      const end = parseTimeMins(endRaw, endMer ?? startMer);
      if (start === null || end === null) continue;
      // Zero-length states no duration - never invent a 12h or 24h roll.
      let dur = end - start;
      if (dur === 0) continue;
      if (dur < 0) {
        const withNoon = dur + 12 * 60;
        if (startMer !== null && endMer !== null) {
          // Both meridiems stated ("2pm-9am"): genuinely overnight.
          dur += 24 * 60;
        } else if (withNoon > 0 && withNoon <= 16 * 60) {
          // Assumed meridiem: retry as an am/pm pair ("11-1pm" > 11am-1pm).
          dur = withNoon;
        } else {
          dur += 24 * 60;
        }
      }
      intervals.push({ start, end: start + dur });
    }
  }
  // Merge overlaps and duplicates - the same minute can only be worked once.
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start < last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ ...iv });
  }
  return merged.map((iv) => ({
    startTime: minsToHHMM(iv.start),
    endTime: minsToHHMM(iv.end),
    durationMins: iv.end - iv.start,
  }));
}

/**
 * Sums all merged time segments found by {@link extractRanges}. Feeds the AI
 * pre-compute hint so the model uses the operator-stated minutes verbatim.
 * @param input - Raw job description text.
 * @returns Total worked minutes, or null if no time ranges detected.
 */
export function calcSessionMins(input: string): number | null {
  const ranges = extractRanges(input);
  if (ranges.length === 0) return null;
  return ranges.reduce((s, x) => s + x.durationMins, 0);
}
