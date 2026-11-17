// scripts/check-dashboard-jobs.ts
// The dashboard's job list takes jobs entered straight into the booking calendar alongside
// website bookings, never counts a booking's own event twice, and skips other calendars and
// all-day blocks.
// Run with: npm test -- dashboard-jobs

import {
  bookingJob,
  calendarOnlyJobs,
  mergeJobs,
  type JobBooking,
  type JobCalendarEvent,
} from "@/features/admin/lib/dashboard-jobs";
import { expectEqual, finish } from "./lib/harness.js";

const BOOKING_CAL = "booking@group.calendar.google.com";
const CAR_CAL = "car@group.calendar.google.com";
const PERSONAL_CAL = "me@gmail.com";

/**
 * Builds a timed or all-day calendar event.
 * @param id - Event id.
 * @param start - ISO start.
 * @param calendarEmail - Calendar it sits on.
 * @param extra - Overrides.
 * @returns The event.
 */
function event(
  id: string,
  start: string,
  calendarEmail: string,
  extra: Partial<JobCalendarEvent> = {},
): JobCalendarEvent {
  const end = new Date(new Date(start).getTime() + 60 * 60_000).toISOString();
  return { id, start, end, calendarEmail, allDay: false, summary: `Job ${id}`, ...extra };
}

/**
 * Builds a confirmed booking.
 * @param id - Booking id.
 * @param start - ISO start.
 * @param extra - Overrides.
 * @returns The booking.
 */
function booking(id: string, start: string, extra: Partial<JobBooking> = {}): JobBooking {
  return {
    id,
    name: `Customer ${id}`,
    email: `${id}@example.com`,
    phone: null,
    startAt: new Date(start),
    endAt: new Date(new Date(start).getTime() + 60 * 60_000),
    address: "1 Queen Street, Auckland",
    meetingType: "in_person",
    notes: null,
    ...extra,
  };
}

/**
 * Runs every fixture and exits non-zero when any fail.
 */
function main(): void {
  const events = [
    event("cal-only", "2026-11-18T22:00:00Z", BOOKING_CAL, {
      location: "Home\n12 Main Street, Pt Chevalier",
    }),
    event("booked", "2026-11-19T01:00:00Z", BOOKING_CAL),
    event("family", "2026-11-18T23:00:00Z", CAR_CAL),
    event("personal", "2026-11-19T02:00:00Z", PERSONAL_CAL),
    event("blocked-day", "2026-11-19T11:00:00Z", BOOKING_CAL, { allDay: true }),
    event("untitled", "2026-11-20T03:00:00Z", BOOKING_CAL, { summary: "  " }),
  ];
  const calJobs = calendarOnlyJobs(events, BOOKING_CAL, new Set(["booked"]));

  expectEqual(
    "only unbooked timed booking-calendar events are jobs",
    calJobs.map((j) => j.key),
    ["cal-only", "untitled"],
  );
  expectEqual(
    "calendar job shape",
    calJobs.map((j) => ({ name: j.name, address: j.address, remote: j.remote, href: j.href })),
    [
      {
        name: "Job cal-only",
        address: "Home, 12 Main Street, Pt Chevalier",
        remote: false,
        // 22:00Z on the 18th is the 19th in NZ.
        href: "/admin/schedule?day=2026-11-19",
      },
      { name: "(no title)", address: null, remote: false, href: "/admin/schedule?day=2026-11-20" },
    ],
  );

  const remote = bookingJob(booking("r", "2026-11-19T01:00:00Z", { meetingType: "remote" }));
  expectEqual("remote booking drops its address", [remote.address, remote.remote], [null, true]);
  const legacy = bookingJob(
    booking("l", "2026-11-19T01:00:00Z", {
      meetingType: null,
      notes: "Fix my email\n\n[Meeting type: Remote]",
    }),
  );
  expectEqual("remote read from legacy notes", legacy.remote, true);
  expectEqual(
    "booking links to its record",
    bookingJob(booking("b1", "2026-11-19T01:00:00Z")).href,
    "/admin/bookings/b1",
  );

  const now = new Date("2026-11-18T20:00:00Z");
  const merged = mergeJobs(
    [[bookingJob(booking("b1", "2026-11-19T01:00:00Z"))], calJobs],
    now,
    null,
  );
  expectEqual(
    "merged soonest first",
    merged.map((j) => `${j.source}:${j.key}`),
    ["calendar:cal-only", "booking:b1", "calendar:untitled"],
  );
  expectEqual(
    "window drops jobs outside [from, to)",
    mergeJobs([calJobs], now, new Date("2026-11-19T11:00:00Z")).map((j) => j.key),
    ["cal-only"],
  );
  expectEqual(
    "a started job is not upcoming",
    mergeJobs([calJobs], new Date("2026-11-18T22:30:00Z"), null).map((j) => j.key),
    ["untitled"],
  );

  finish();
}

main();
