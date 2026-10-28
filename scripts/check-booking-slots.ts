// scripts/check-booking-slots.ts
// Submit-time slot rules: the calendar window reaches the end of the last bookable NZ day,
// date keys must be real dates, the last hour offered is the latest a 2hr job fits, unticked
// evening starts are left out of a weekday, the overlap re-check judges from the new booking's
// side, and only a 404 or 410 reads as a Google event already gone.
// Run with: npm test -- booking-slots

import {
  bookingWindowEnd,
  buildAvailableDays,
  isSlotFree,
  validateBookingRequest,
  withoutAfterHoursStarts,
  type AvailabilityConfig,
  type BookableDay,
  type ExistingBooking,
} from "@/features/booking/lib/booking";
import { isEventGone } from "@/features/calendar/lib/google-calendar";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import { NZ_TZ } from "@/shared/lib/timezone-utils";
import { expectEqual, finish } from "./lib/harness.js";

const CONFIG: AvailabilityConfig = {
  ...DEFAULT_SETTINGS.availability,
  morningGuards: [],
  timeZone: NZ_TZ,
};

/**
 * A booking at the given UTC times, with optional buffers.
 * @param start - ISO start.
 * @param end - ISO end.
 * @param before - Buffer before, in minutes.
 * @param after - Buffer after, in minutes.
 * @returns The booking in the shape the slot engine reads.
 */
function booking(start: string, end: string, before = 0, after = 0): ExistingBooking {
  return {
    id: start,
    startAt: new Date(start),
    endAt: new Date(end),
    bufferBeforeMin: before,
    bufferAfterMin: after,
  };
}

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("booking slot fixtures\n");

  // NZDT (+13): 14:00 on 26 Oct, so the 14th day out is 9 Nov and the window ends at its midnight.
  expectEqual(
    "window ends at NZ midnight after the last day",
    bookingWindowEnd(new Date("2026-10-26T01:00:00Z"), CONFIG).toISOString(),
    "2026-11-09T11:00:00.000Z",
  );
  // 00:30 on 27 Oct NZ is still the 26th in UTC; the NZ date decides the last day.
  expectEqual(
    "just after NZ midnight moves the window a day",
    bookingWindowEnd(new Date("2026-10-26T11:30:00Z"), CONFIG).toISOString(),
    "2026-11-10T11:00:00.000Z",
  );
  // Daylight saving ends 4 Apr 2027, so the last midnight is NZST (+12).
  expectEqual(
    "window end crosses the April changeover",
    bookingWindowEnd(new Date("2027-03-25T01:00:00Z"), CONFIG).toISOString(),
    "2027-04-08T12:00:00.000Z",
  );

  // 09:00 Tue 27 Oct NZ.
  const now = new Date("2026-10-26T20:00:00Z");
  /**
   * Validates an 11am short job on a date.
   * @param dateKey - The date key to try.
   * @returns "ok", or the refusal message.
   */
  const check = (dateKey: string): string => {
    const result = validateBookingRequest(dateKey, "11am", 0, "short", [], [], now, CONFIG);
    return result.valid ? "ok" : result.error;
  };
  expectEqual("a real date passes", check("2026-10-28"), "ok");
  expectEqual("the last bookable day passes", check("2026-11-10"), "ok");
  expectEqual(
    "the day after is refused",
    check("2026-11-11"),
    "Cannot book more than 14 days in advance",
  );
  expectEqual("31 February is refused", check("2026-02-31"), "Invalid date format");
  expectEqual("an unpadded key is refused", check("2026-10-8"), "Invalid date format");
  expectEqual("a trailing time is refused", check("2026-10-28T00"), "Invalid date format");

  // Close at 8pm: the last hour offered is 6pm, the latest a 2hr job fits, so no 7pm hour with
  // a single start in it.
  const { days } = buildAvailableDays([], [], now, CONFIG);
  const wednesday = days.find((d) => d.dateKey === "2026-10-28");
  /**
   * The open starts on Wednesday's grid for a duration.
   * @param day - The day to read.
   * @param long - True for the 2hr job.
   * @returns Minutes from NZ midnight of every open start.
   */
  const startsOf = (day: BookableDay | undefined, long = false): number[] =>
    (day?.timeWindows ?? []).flatMap((w) =>
      w.subSlots
        .filter((s) => (long ? s.availableLong : s.availableShort))
        .map((s) => w.startHour * 60 + s.minute),
    );
  expectEqual("a 1hr job's last start is 6:45pm", Math.max(...startsOf(wednesday)), 18 * 60 + 45);
  expectEqual(
    "there's no 7pm hour",
    wednesday?.timeWindows.some((w) => w.startHour === 19),
    false,
  );
  expectEqual("a 2hr job's last start is 6pm", Math.max(...startsOf(wednesday, true)), 18 * 60);

  // Show evening times unticked: starts from 6pm on are left out, not crossed out.
  const after6 = {
    fromHour: 18,
    surcharge: { reason: "After hours", label: "After-hours surcharge", uplift: 0.1 },
  };
  const wedEvenings = wednesday && { ...wednesday, afterHours: after6 };
  const hidden = wedEvenings && withoutAfterHoursStarts(wedEvenings);
  expectEqual("unticked, the last start is 5:45pm", Math.max(...startsOf(hidden)), 17 * 60 + 45);
  expectEqual(
    "unticked, the 6pm and 7pm hours are gone",
    hidden?.timeWindows.some((w) => w.startHour >= 18),
    false,
  );
  const saturday = days.find((d) => d.dateKey === "2026-10-31");
  expectEqual(
    "a weekend day, with no after-hours, is left alone",
    saturday && withoutAfterHoursStarts(saturday) === saturday,
    true,
  );

  // 10:00-11:00 NZ on 28 Oct.
  const start = new Date("2026-10-27T21:00:00Z");
  const end = new Date("2026-10-27T22:00:00Z");
  /**
   * Whether 10-11am is free of the given bookings.
   * @param others - Bookings already in.
   * @returns True when nothing clashes.
   */
  const free = (others: ExistingBooking[]): boolean => isSlotFree(start, end, others, [], 0);
  expectEqual(
    "an overlapping booking clashes",
    free([booking("2026-10-27T21:30:00Z", "2026-10-27T22:30:00Z")]),
    false,
  );
  expectEqual(
    "back to back is free",
    free([booking("2026-10-27T22:00:00Z", "2026-10-27T23:00:00Z")]),
    true,
  );
  // The new booking's own after-buffer isn't tested against what follows, as on the grid.
  expectEqual(
    "a later booking inside the new one's buffer is free",
    free([booking("2026-10-27T22:15:00Z", "2026-10-27T23:15:00Z")]),
    true,
  );
  expectEqual(
    "an earlier booking's after-buffer clashes",
    free([booking("2026-10-27T20:00:00Z", "2026-10-27T20:45:00Z", 0, 30)]),
    false,
  );

  // Travel rows are padding already; a real event gets the buffer.
  const travel = [
    { id: "travel-before:x", start: "2026-10-27T22:00:00Z", end: "2026-10-27T22:30:00Z" },
  ];
  const event = [{ id: "x", start: "2026-10-27T22:10:00Z", end: "2026-10-27T23:00:00Z" }];
  expectEqual("travel right after takes no buffer", isSlotFree(start, end, [], travel, 15), true);
  expectEqual(
    "an event 10 min after is inside the buffer",
    isSlotFree(start, end, [], event, 15),
    false,
  );

  // A failed delete only counts as done when Google says the event no longer exists.
  expectEqual("404 is gone", isEventGone({ code: 404 }), true);
  expectEqual("410 on the response is gone", isEventGone({ response: { status: 410 } }), true);
  expectEqual("403 is not gone", isEventGone({ status: 403 }), false);
  expectEqual("a network error is not gone", isEventGone({ code: "ECONNRESET" }), false);
  expectEqual("null is not gone", isEventGone(null), false);

  finish();
}

main();
