// src/features/business/lib/time-parse.ts
// Canonical time-range parser shared by the admin parse-job route and the eval
// auditor, so both compute stated-session minutes from ONE implementation. A
// non-positive span first retries as an am/pm pair (+12h), then rolls
// overnight (+24h). Pure and dependency-free so the tsx eval harness can import it.

/** am/pm marker, or null when a time fragment carries none. */
type Meridiem = "am" | "pm" | null;

/** One parsed start/end range plus its resolved duration in minutes. */
export interface ParsedTimeRange {
  startTime: string;
  endTime: string;
  durationMins: number;
}

// Two times on one line, captured as start/end. The separator is forgiving so
// the operator does not have to type a dash: a dash (-/–/—), the word "to", or
// just whitespace all split the pair. Regex backtracking lets the bare-space
// case work even though each time captures an optional trailing meridiem.
const TIME_RANGE_RE =
  /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s*[-–—]\s*|\s+to\s+|\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi;

/**
 * Extracts the am/pm marker from a time fragment.
 * @param s - Time fragment like "7", "9pm", "10:30am".
 * @returns "am" / "pm" / null.
 */
function meridiemOf(s: string): Meridiem {
  const t = s.toLowerCase();
  if (/pm/.test(t)) return "pm";
  if (/am/.test(t)) return "am";
  return null;
}

/**
 * Parses a time string into minutes since midnight.
 * @param s - Time string (e.g. "7pm", "7:10", "10:22am").
 * @param assume - Meridiem to apply when the string has none (e.g. trailing "pm" in "7-9pm").
 * @returns Minutes since midnight, or null if unparseable.
 */
function parseTimeMins(s: string, assume: Meridiem = null): number | null {
  const t = s.trim().toLowerCase();
  const meridiem: Meridiem = meridiemOf(t) ?? assume;
  const clean = t.replace(/[apm\s]/g, "");
  const [hStr, mStr = "0"] = clean.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return null;
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
 * Extracts every start/end time segment found on digit-led lines, accepting a
 * dash, "to", or plain whitespace between the two times. Used to compute the
 * worked-minutes hint passed to the AI as a "pre-computed session total"
 * annotation, and by the auditor to derive the canonical expected duration.
 * @param input - Raw job description text.
 * @returns Array of parsed time ranges (may be empty when nothing detected).
 */
export function extractRanges(input: string): ParsedTimeRange[] {
  const ranges: ParsedTimeRange[] = [];
  for (const line of input.split("\n")) {
    if (!/^\d/.test(line.trim())) continue;
    TIME_RANGE_RE.lastIndex = 0;
    const m = TIME_RANGE_RE.exec(line);
    if (!m) continue;
    const startMeridiem = meridiemOf(m[1]);
    const endMeridiem = meridiemOf(m[2]);
    const start = parseTimeMins(m[1], startMeridiem ?? endMeridiem);
    const end = parseTimeMins(m[2], endMeridiem ?? startMeridiem);
    if (start === null || end === null) continue;
    let endResolved = end;
    let dur = end - start;
    if (dur <= 0) {
      const withNoon = dur + 12 * 60;
      if (withNoon > 0 && withNoon <= 16 * 60) {
        endResolved = end + 12 * 60;
        dur = withNoon;
      } else {
        endResolved = end + 24 * 60;
        dur = dur + 24 * 60;
      }
    }
    ranges.push({
      startTime: minsToHHMM(start),
      endTime: minsToHHMM(endResolved),
      durationMins: dur,
    });
  }
  return ranges;
}

/**
 * Sums all HH:MM-HH:MM segments on lines that start with a digit. Feeds the
 * AI pre-compute hint so the model uses the operator-stated minutes verbatim.
 * @param input - Raw job description text.
 * @returns Total worked minutes, or null if no time ranges detected.
 */
export function calcSessionMins(input: string): number | null {
  const ranges = extractRanges(input);
  if (ranges.length === 0) return null;
  return ranges.reduce((s, x) => s + x.durationMins, 0);
}
