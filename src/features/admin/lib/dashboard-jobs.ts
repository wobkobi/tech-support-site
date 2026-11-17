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
  /** A booking marked remote; a calendar-only job never is, since its type is unknown. */
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
 * Jobs that live only in the booking calendar: timed events on that calendar whose id no
 * Booking row holds. Other calendars (personal, the family "Car" one) are never jobs, and an
 * all-day event is a blocked day, not a job.
 * @param events - Events from every configured calendar.
 * @param bookingCalendarId - The booking calendar's id.
 * @param bookedEventIds - Event ids held by any Booking row, so a booking never counts twice.
 * @returns The calendar-only jobs, in event order.
 */
export function calendarOnlyJobs(
  events: readonly JobCalendarEvent[],
  bookingCalendarId: string,
  bookedEventIds: ReadonlySet<string>,
): DashboardJob[] {
  return events
    .filter((e) => e.calendarEmail === bookingCalendarId && !e.allDay && !bookedEventIds.has(e.id))
    .map((e) => {
      const startAt = new Date(e.start);
      return {
        key: e.id,
        source: "calendar" as const,
        name: e.summary?.trim() || "(no title)",
        email: null,
        phone: null,
        startAt,
        endAt: new Date(e.end),
        address: oneLine(e.location),
        remote: false,
        href: `/admin/schedule?day=${nzDateKey(startAt)}`,
      };
    });
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
