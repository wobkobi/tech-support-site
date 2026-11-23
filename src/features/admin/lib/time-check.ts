// src/features/admin/lib/time-check.ts
// "Did you mean...?" for times that look like an am/pm slip: a job ending before it starts,
// running over 10 hours, or starting in the small hours. Works on the time pickers' zero-padded
// "HH:mm". Pure, so the rules are testable offline.

/** Earliest start that reads as a real job (6 am). */
const EARLIEST_START = 6 * 60;
/** A single time from here on (10 pm) reads as a slip too. */
const LATE_TIME = 22 * 60;
/** Longest job that still reads as one sitting. */
const MAX_JOB_MINS = 10 * 60;
const HALF_DAY = 12 * 60;
const DAY = 24 * 60;

/** A start and end that read wrong, with the likely fix when there is one. */
export interface RangeCheck {
  /** What looks wrong, or the "Did you mean" question when there's a fix. */
  text: string;
  /** Corrected times, or null when there's nothing to offer. */
  fix: { start: string; end: string } | null;
  /** Button wording when it isn't the default "Use that". */
  fixLabel?: string;
}

/** A single time that reads wrong, with the likely fix. */
export interface TimeCheck {
  text: string;
  fix: string;
}

/**
 * "HH:mm" as minutes after midnight.
 * @param hhmm - Zero-padded 24-hour clock string.
 * @returns Minutes, or null when it doesn't parse.
 */
function toMins(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Minutes after midnight as "HH:mm".
 * @param mins - Minutes after midnight.
 * @returns The clock string.
 */
function toClock(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * Minutes after midnight as "3:00 pm", the picker's own wording.
 * @param mins - Minutes after midnight.
 * @returns The 12-hour label.
 */
export function clockWords(mins: number): string {
  const h = Math.floor(mins / 60);
  return `${((h + 11) % 12) + 1}:${String(mins % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/**
 * The same clock time on the other side of noon.
 * @param mins - Minutes after midnight.
 * @returns Minutes after midnight, 12 hours on or back.
 */
function swapHalf(mins: number): number {
  return (mins + HALF_DAY) % DAY;
}

/**
 * Whether a start and end read as one ordinary job.
 * @param s - Start (minutes after midnight).
 * @param e - End (minutes after midnight).
 * @returns True when the end is after the start, within 10 hours, and the start is 6 am or later.
 */
function plausible(s: number, e: number): boolean {
  return e > s && e - s <= MAX_JOB_MINS && s >= EARLIEST_START;
}

/**
 * Checks a job's start and end. Tries swapping am/pm on the end, then the start, then both,
 * and offers the first that reads as an ordinary job.
 * @param start - Start "HH:mm".
 * @param end - End "HH:mm".
 * @returns The problem and its fix, or null when the times read fine or aren't both set.
 */
export function checkRange(start: string, end: string): RangeCheck | null {
  const s = toMins(start);
  const e = toMins(end);
  if (s === null || e === null || plausible(s, e)) return null;
  const tries: Array<[number, number]> = [
    [s, swapHalf(e)],
    [swapHalf(s), e],
    [swapHalf(s), swapHalf(e)],
  ];
  // A fix finishing by 10 pm wins over one running late: 9 pm to 11 am reads as 9 to 11 am.
  const hit =
    tries.find(([ts, te]) => plausible(ts, te) && te <= LATE_TIME) ??
    tries.find(([ts, te]) => plausible(ts, te));
  if (hit) {
    const [fs, fe] = hit;
    return {
      text: `Did you mean ${clockWords(fs)} to ${clockWords(fe)}?`,
      fix: { start: toClock(fs), end: toClock(fe) },
    };
  }
  if (e === s) return { text: "Start and end are the same.", fix: null };
  // No am/pm swap fits, so the fix swaps the two times round instead.
  if (e < s) {
    return {
      text: "The end is before the start.",
      fix: { start: end, end: start },
      fixLabel: "Swap them",
    };
  }
  if (e - s > MAX_JOB_MINS) return { text: "That's over 10 hours. Check the times.", fix: null };
  return null;
}

/**
 * Checks one appointment time: before 6 am or from 10 pm reads as an am/pm slip when the
 * other half of the day lands in working hours.
 * @param time - "HH:mm".
 * @returns The question and the fix, or null when the time reads fine.
 */
export function checkTime(time: string): TimeCheck | null {
  const t = toMins(time);
  if (t === null || (t >= EARLIEST_START && t < LATE_TIME)) return null;
  const swapped = swapHalf(t);
  if (swapped < EARLIEST_START || swapped >= LATE_TIME) return null;
  return { text: `Did you mean ${clockWords(swapped)}?`, fix: toClock(swapped) };
}
