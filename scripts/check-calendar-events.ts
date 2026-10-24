// scripts/check-calendar-events.ts
// Google event > CalendarEvent mapping: an all-day block keeps its full NZ-day span for the
// booking engine and is flagged allDay, so job lists (Today's jobs, the event picker,
// travel) can skip it.
// Run with: npm test -- calendar-events

import { toCalendarEvent } from "@/features/calendar/lib/google-calendar";
import { expectEqual, finish } from "./lib/harness.js";

const CAL = "booking@group.calendar.google.com";

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  console.log("All-day blocks:");
  const busy = toCalendarEvent(
    { id: "busy1", summary: "Busy", start: { date: "2026-10-24" }, end: { date: "2026-10-25" } },
    CAL,
    false,
  );
  expectEqual("a Busy block is all-day", busy?.allDay, true);
  // NZDT (+13): NZ midnight Sat 24 Oct is 11:00Z on the 23rd.
  expectEqual(
    "it spans the whole NZ day",
    [busy?.start, busy?.end],
    ["2026-10-23T11:00:00.000Z", "2026-10-24T11:00:00.000Z"],
  );
  // NZ daylight saving starts Sun 27 Sep 2026, so the two midnights have different offsets.
  const acrossDst = toCalendarEvent(
    { id: "b2", summary: "Busy", start: { date: "2026-09-26" }, end: { date: "2026-09-28" } },
    CAL,
    false,
  );
  expectEqual(
    "a block across the DST change keeps both midnights",
    [acrossDst?.start, acrossDst?.end],
    ["2026-09-25T12:00:00.000Z", "2026-09-27T11:00:00.000Z"],
  );
  expectEqual(
    "a personal all-day event is skipped",
    toCalendarEvent(
      { id: "p1", summary: "Birthday", start: { date: "2026-10-24" }, end: { date: "2026-10-25" } },
      CAL,
      true,
    ),
    null,
  );

  console.log("\nTimed events:");
  const murray = toCalendarEvent(
    {
      id: "m1",
      summary: "Murray",
      location: "12 Example St",
      start: { dateTime: "2026-10-24T15:20:00+13:00" },
      end: { dateTime: "2026-10-24T16:20:00+13:00" },
    },
    CAL,
    false,
  );
  expectEqual("a job is not all-day", murray?.allDay, false);
  expectEqual(
    "its times pass through",
    [murray?.start, murray?.end],
    ["2026-10-24T15:20:00+13:00", "2026-10-24T16:20:00+13:00"],
  );
  expectEqual(
    "a personal timed event still blocks",
    toCalendarEvent(
      {
        id: "p2",
        start: { dateTime: "2026-10-24T18:00:00+13:00" },
        end: { dateTime: "2026-10-24T21:00:00+13:00" },
      },
      CAL,
      true,
    )?.allDay,
    false,
  );

  console.log("\nSkipped events:");
  const timed = {
    id: "x",
    start: { dateTime: "2026-10-24T10:00:00+13:00" },
    end: { dateTime: "2026-10-24T11:00:00+13:00" },
  };
  expectEqual("cancelled", toCalendarEvent({ ...timed, status: "cancelled" }, CAL, false), null);
  expectEqual(
    "declined",
    toCalendarEvent(
      { ...timed, attendees: [{ self: true, responseStatus: "declined" }] },
      CAL,
      false,
    ),
    null,
  );

  finish();
}

main();
