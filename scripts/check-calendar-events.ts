// scripts/check-calendar-events.ts
// Google event > CalendarEvent mapping: an all-day block keeps its full NZ-day span for the
// booking engine and is flagged allDay, so job lists (Today's jobs, the event picker,
// travel) can skip it. Also which next event a job's trip home chains into.
// Run with: npm test -- calendar-events

import { findNextChainedEvent } from "@/features/calendar/lib/calendar-cache";
import { toCalendarEvent, type CalendarEvent } from "@/features/calendar/lib/google-calendar";
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

  console.log("\nTrip home chaining:");
  /**
   * A located event from NZ hours on 20 Nov 2026 (NZDT, UTC+13).
   * @param id - Event id.
   * @param from - Start hour (fractional for minutes).
   * @param to - End hour.
   * @returns The event.
   */
  const ev = (id: string, from: number, to: number): CalendarEvent => {
    /**
     * ISO instant for an NZ hour that day.
     * @param h - NZ hour (fractional for minutes).
     * @returns The ISO string.
     */
    const at = (h: number): string =>
      new Date(Date.UTC(2026, 10, 20, 0, (h - 13) * 60)).toISOString();
    return {
      id,
      start: at(from),
      end: at(to),
      location: `${id} Road`,
      calendarEmail: CAL,
      allDay: false,
    };
  };
  const job = ev("a", 9, 10);
  const end = new Date(job.end);
  /**
   * Id of the event the job's trip home chains into, with a 30 min departure buffer.
   * @param next - The candidate events after the job.
   * @returns The chained event's id, or null.
   */
  const chainedId = (...next: CalendarEvent[]): string | null =>
    findNextChainedEvent([job, ...next], job, end, 30)?.event.id ?? null;
  expectEqual("a job 2h after the end chains", chainedId(ev("b", 12, 13)), "b");
  expectEqual("2h 30m chains with the departure buffer", chainedId(ev("b", 12.5, 13)), "b");
  expectEqual("2h 45m doesn't", chainedId(ev("b", 12.75, 14)), null);
  expectEqual("an overlapping job chains", chainedId(ev("b", 9.75, 11)), "b");
  expectEqual("the overlap beats a later one", chainedId(ev("c", 11, 12), ev("b", 9.75, 11)), "b");
  expectEqual("one that started earlier doesn't", chainedId(ev("b", 8.5, 9.5)), null);

  finish();
}

main();
