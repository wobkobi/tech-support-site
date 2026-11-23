// scripts/check-dashboard-jobs.ts
// The dashboard's job list takes jobs entered straight into the booking calendar alongside
// website bookings, never counts a booking's own event twice, and skips other calendars and
// all-day blocks; the Running now card picks the job under way.
// Run with: npm test -- dashboard-jobs

import {
  bookingJob,
  calendarOnlyJobs,
  extendChoices,
  isHomeLocation,
  mergeJobs,
  runningJob,
  type JobBooking,
  type JobCalendarEvent,
} from "@/features/admin/lib/dashboard-jobs";
import { expectEqual, finish } from "./lib/harness.js";

const BOOKING_CAL = "booking@group.calendar.google.com";
const CAR_CAL = "car@group.calendar.google.com";
const PERSONAL_CAL = "me@gmail.com";
const HOME_LINE = "92 Walker Road";

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
  const calJobs = calendarOnlyJobs(events, BOOKING_CAL, new Set(["booked"]), HOME_LINE);

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
      { name: "(no title)", address: null, remote: true, href: "/admin/schedule?day=2026-11-20" },
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

  // Running now: started, and not more than an hour past its end; the later start wins.
  const morning = bookingJob(booking("am", "2026-11-19T21:00:00Z"));
  const midday = bookingJob(booking("noon", "2026-11-19T23:00:00Z"));
  const zoom = bookingJob(booking("zoom", "2026-11-19T23:30:00Z", { meetingType: "remote" }));
  const jobs = [morning, midday, zoom];
  /**
   * Epoch ms for an ISO time.
   * @param iso - ISO time.
   * @returns Milliseconds.
   */
  const at = (iso: string): number => new Date(iso).getTime();
  expectEqual("before any job, none running", runningJob(jobs, at("2026-11-19T20:00:00Z")), null);
  expectEqual("during the first job", runningJob(jobs, at("2026-11-19T21:30:00Z"))?.key, "am");
  expectEqual(
    "an hour past the end still counts",
    runningJob(jobs, at("2026-11-19T23:00:00Z") - 1)?.key,
    "am",
  );
  expectEqual(
    "the later start wins, remote included",
    runningJob(jobs, at("2026-11-19T23:45:00Z"))?.key,
    "zoom",
  );
  expectEqual(
    "over an hour past the end, none",
    runningJob(jobs, at("2026-11-20T01:31:00Z")),
    null,
  );

  // Home: number and street name match, whatever the suffix, suburb or label.
  expectEqual(
    "home address variants",
    [
      "92 Walker Rd, Point Chevalier",
      "Home\n92 Walker Road\nPoint Chevalier, Auckland 1022",
      "192 Walker Road",
      "Home\n12 Main Street",
      "",
    ].map((loc) => isHomeLocation(loc, HOME_LINE)),
    [true, true, false, false, false],
  );
  const atHome = calendarOnlyJobs(
    [event("home-call", "2026-11-19T03:00:00Z", BOOKING_CAL, { location: "92 Walker Rd" })],
    BOOKING_CAL,
    new Set(),
    HOME_LINE,
  )[0];
  expectEqual("a job at home is remote", [atHome?.remote, atHome?.address], [true, null]);

  // Running over: quarter-hour end times from the later of the end and now.
  /**
   * Formats the extend choices as UTC HH:MM.
   * @param endIso - The job's current end.
   * @param nowIso - The moment the choices are offered.
   * @returns The choices as UTC HH:MM strings.
   */
  const times = (endIso: string, nowIso: string): string[] =>
    extendChoices(at(endIso), at(nowIso)).map((ms) => new Date(ms).toISOString().slice(11, 16));
  expectEqual("before an on-the-hour end", times("2026-11-20T02:00:00Z", "2026-11-20T01:50:00Z"), [
    "02:15",
    "02:30",
    "02:45",
    "03:15",
  ]);
  expectEqual(
    "an odd end rounds up to a quarter mark",
    times("2026-11-20T02:07:00Z", "2026-11-20T01:50:00Z"),
    ["02:15", "02:30", "02:45", "03:15"],
  );
  expectEqual(
    "under 5 minutes to the next mark skips it",
    times("2026-11-20T02:12:00Z", "2026-11-20T01:50:00Z"),
    ["02:30", "02:45", "03:00", "03:30"],
  );
  expectEqual(
    "past the end, counts from now",
    times("2026-11-20T02:00:00Z", "2026-11-20T02:38:00Z"),
    ["02:45", "03:00", "03:15", "03:45"],
  );

  finish();
}

main();
