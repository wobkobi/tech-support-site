// src/features/admin/lib/dashboard-jobs.ts
// Dashboard job list: confirmed website bookings plus jobs entered straight into the booking
// calendar, which have no Booking row. Pure, so the merge rules are testable offline.

import { meetingTypeFromNotes } from "@/features/booking/lib/booking";
import type { CalendarEvent } from "@/features/calendar/lib/google-calendar";
import { nzDateKey } from "@/shared/lib/timezone-utils";
import type { Booking } from "@prisma/client";

/** One upcoming or same-day job as the dashboard shows it. */
export interface DashboardJob {
  /** Booking id, or the calendar event id for a calendar-only job. */
  key: string;
  source: "booking" | "calendar";
  /** Customer name, or the event title for a calendar-only job. */
  name: string;
  email: string | null;
  phone: string | null;
  startAt: Date;
  endAt: Date;
  /** One-line address for the Maps button; null when remote or none is known. */
  address: string | null;
  /** A booking marked remote, or a calendar-only job with no location or one at home. */
  remote: boolean;
  /** The booking record, or the schedule day for a calendar-only job (it has no record). */
  href: string;
}

/** Booking fields {@link bookingJob} reads. */
export type JobBooking = Pick<
  Booking,
  "id" | "name" | "email" | "phone" | "startAt" | "endAt" | "address" | "meetingType" | "notes"
>;

/** Calendar event fields {@link calendarOnlyJobs} reads. */
export type JobCalendarEvent = Pick<
  CalendarEvent,
  "id" | "start" | "end" | "summary" | "location" | "calendarEmail" | "allDay"
>;

/**
 * Flattens a multi-line event location to one line ("Home\n12 Main St" > "Home, 12 Main St").
 * @param raw - Location as Google returns it.
 * @returns Single-line location, or null when blank.
 */
function oneLine(raw: string | undefined): string | null {
  const flat = (raw ?? "").replace(/,?\s*[\r\n]+\s*/g, ", ").trim();
  return flat || null;
}

/**
 * Maps a confirmed booking to a job. An unknown meeting type with an address still gets Maps.
 * @param b - The booking.
 * @returns The job.
 */
export function bookingJob(b: JobBooking): DashboardJob {
  const remote = (b.meetingType ?? meetingTypeFromNotes(b.notes)) === "remote";
  return {
    key: b.id,
    source: "booking",
    name: b.name,
    email: b.email || null,
    phone: b.phone || null,
    startAt: b.startAt,
    endAt: b.endAt,
    address: remote ? null : b.address || null,
    remote,
    href: `/admin/bookings/${b.id}`,
  };
}

/**
 * Lowercase words of an address, punctuation and line breaks dropped.
 * @param s - Address text.
 * @returns The words.
 */
function addressWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Whether an event location is home: the home street line's number and street name appear in
 * order. Only those two words are matched, so "Rd" vs "Road" and a missing suburb still count.
 * A "Home" label isn't enough: Apple Calendar puts it on a customer's contact-card address too.
 * @param location - Event location as Google returns it.
 * @param homeLine - The base address's street line, e.g. "92 Walker Road".
 * @returns True when the location is home.
 */
export function isHomeLocation(location: string, homeLine: string): boolean {
  const key = addressWords(homeLine).slice(0, 2);
  if (key.length < 2) return false;
  const words = addressWords(location);
  return words.some((w, i) => w === key[0] && words[i + 1] === key[1]);
}

/**
 * Jobs that live only in the booking calendar: timed events on that calendar whose id no
 * Booking row holds. Other calendars (personal, the family "Car" one) are never jobs, and an
 * all-day event is a blocked day, not a job. One with no location, or at home, is remote.
 * @param events - Events from every configured calendar.
 * @param bookingCalendarId - The booking calendar's id.
 * @param bookedEventIds - Event ids held by any Booking row, so a booking never counts twice.
 * @param homeLine - The base address's street line, for spotting events at home.
 * @returns The calendar-only jobs, in event order.
 */
export function calendarOnlyJobs(
  events: readonly JobCalendarEvent[],
  bookingCalendarId: string,
  bookedEventIds: ReadonlySet<string>,
  homeLine: string,
): DashboardJob[] {
  return events
    .filter((e) => e.calendarEmail === bookingCalendarId && !e.allDay && !bookedEventIds.has(e.id))
    .map((e) => {
      const startAt = new Date(e.start);
      const location = oneLine(e.location);
      const remote = !location || isHomeLocation(e.location ?? "", homeLine);
      return {
        key: e.id,
        source: "calendar" as const,
        name: e.summary?.trim() || "(no title)",
        email: null,
        phone: null,
        startAt,
        endAt: new Date(e.end),
        // Remote ones keep no address, so no Maps button.
        address: remote ? null : location,
        remote,
        href: `/admin/schedule?day=${nzDateKey(startAt)}`,
      };
    });
}

/** A job stays "running" this long after its calendar end, so an overrun can still be logged. */
export const RUNNING_JOB_GRACE_MS = 60 * 60_000;

/**
 * The job you're at now: the latest-starting job (remote ones too, since they can run over as
 * well) that has started and hasn't passed its end by more than {@link RUNNING_JOB_GRACE_MS}.
 * @param jobs - Today's jobs.
 * @param nowMs - Current time (ms).
 * @returns The job, or null when none is running.
 */
export function runningJob(jobs: readonly DashboardJob[], nowMs: number): DashboardJob | null {
  let best: DashboardJob | null = null;
  for (const j of jobs) {
    if (j.startAt.getTime() > nowMs) continue;
    if (j.endAt.getTime() + RUNNING_JOB_GRACE_MS < nowMs) continue;
    if (!best || j.startAt > best.startAt) best = j;
  }
  return best;
}

const QUARTER_MS = 15 * 60_000;
/** The first choice is at least this far past the base, so it's never a near no-op. */
const MIN_FIRST_STEP_MS = 5 * 60_000;
/** Each choice's distance past the first, in minutes. */
const EXTEND_STEPS = [0, 15, 30, 60];

/**
 * New end times to offer for a job running over: quarter-hour marks counted from whichever is
 * later, the current end or now, so an overdue job never offers a time already gone. NZ offsets
 * are whole hours, so UTC quarter marks are NZ quarter marks too.
 * @param endMs - The job's current end (ms).
 * @param nowMs - Current time (ms).
 * @returns Four ascending end times (ms): the first quarter mark 5+ minutes past the base,
 *   then 15, 30 and 60 minutes after it.
 */
export function extendChoices(endMs: number, nowMs: number): number[] {
  const base = Math.max(endMs, nowMs) + MIN_FIRST_STEP_MS;
  const first = Math.ceil(base / QUARTER_MS) * QUARTER_MS;
  return EXTEND_STEPS.map((m) => first + m * 60_000);
}

/**
 * Merges job lists into one, soonest first, keeping those starting in [from, to).
 * @param lists - Job lists to merge.
 * @param from - Inclusive lower bound on the start.
 * @param to - Exclusive upper bound on the start, or null for none.
 * @returns The merged jobs.
 */
export function mergeJobs(
  lists: readonly (readonly DashboardJob[])[],
  from: Date,
  to: Date | null,
): DashboardJob[] {
  return lists
    .flat()
    .filter((j) => j.startAt >= from && (to === null || j.startAt < to))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
