// scripts/check-promo-selection.ts
// Which promo wins when windows overlap, and how a typed code is normalised. Pure logic, no DB.
// Run with: npm test -- promo-selection

import {
  describeRecurringWindow,
  hasRecurringWindow,
  jobBookedAt,
  matchesRecurringWindow,
  normalisePromoCode,
  pickWinningPromo,
  resolutionInstants,
  type PromoCandidate,
  type RecurringWindow,
} from "@/features/business/lib/promos";
import { expectEqual, finish } from "./lib/harness.js";

/**
 * Builds a candidate row.
 * @param id - Promo id.
 * @param priority - Priority value.
 * @param createdAt - ISO creation timestamp.
 * @returns A candidate for {@link pickWinningPromo}.
 */
function promo(id: string, priority: number, createdAt: string): PromoCandidate {
  return { id, priority, createdAt: new Date(createdAt) };
}

/**
 * Builds a recurring restriction.
 * @param weekdays - NZ weekdays, 0 = Sunday; empty for every day.
 * @param from - Start minute past NZ midnight, or null.
 * @param to - End minute past NZ midnight, or null.
 * @returns The restriction.
 */
function window(
  weekdays: number[],
  from: number | null = null,
  to: number | null = null,
): RecurringWindow {
  return { activeWeekdays: weekdays, activeFromMinute: from, activeToMinute: to };
}

/**
 * An instant as comparable text, so a case reports the time it got.
 * @param d - The instant, or null/undefined when unset.
 * @returns Its ISO string, or null.
 */
function iso(d: Date | null | undefined): string | null {
  return d?.toISOString() ?? null;
}

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("promo selection fixtures\n");

  expectEqual("no candidates", pickWinningPromo<PromoCandidate>([])?.id ?? null, null);

  expectEqual(
    "single candidate wins",
    pickWinningPromo([promo("a", 0, "2026-01-01")])?.id ?? null,
    "a",
  );

  // The whole point of the priority column.
  expectEqual(
    "higher priority beats newer",
    pickWinningPromo([
      promo("old-important", 10, "2026-01-01"),
      promo("new-ordinary", 0, "2026-06-01"),
    ])?.id ?? null,
    "old-important",
  );

  // Existing promos all sit at 0.
  expectEqual(
    "equal priority falls back to newest",
    pickWinningPromo([promo("older", 0, "2026-01-01"), promo("newer", 0, "2026-06-01")])?.id ??
      null,
    "newer",
  );

  expectEqual(
    "negative priority loses to default",
    pickWinningPromo([promo("suppressed", -5, "2026-06-01"), promo("normal", 0, "2026-01-01")])
      ?.id ?? null,
    "normal",
  );

  // Order in must not matter.
  expectEqual(
    "input order is irrelevant",
    pickWinningPromo([
      promo("new-ordinary", 0, "2026-06-01"),
      promo("old-important", 10, "2026-01-01"),
    ])?.id ?? null,
    "old-important",
  );

  // ---- Code normalisation ----
  // Stored codes are uppercase; anything else fails to match.

  expectEqual("trims and uppercases", normalisePromoCode("  spring25 "), "SPRING25");
  expectEqual("blank becomes null", normalisePromoCode("   "), null);
  expectEqual("undefined becomes null", normalisePromoCode(undefined), null);
  expectEqual("null stays null", normalisePromoCode(null), null);
  expectEqual("already uppercase is unchanged", normalisePromoCode("SPRING25"), "SPRING25");
  // Public routes pass raw JSON; a throw here would drop the automatic promo too.
  expectEqual("a number is not a code", normalisePromoCode(25), null);
  expectEqual("an object is not a code", normalisePromoCode({ $ne: "" }), null);

  // ---- Booking date vs appointment ----
  // Promo dates are judged at booking time, the weekday restriction at the appointment.

  const NOW = new Date("2026-09-18T01:00:00Z");
  const SLOT = new Date("2026-09-29T21:00:00Z");
  const BOOKED = new Date("2026-09-10T02:00:00Z");

  expectEqual(
    "a booking judges dates at booking time",
    iso(resolutionInstants({ at: SLOT, bookedAt: BOOKED }, NOW).datesAt),
    iso(BOOKED),
  );
  expectEqual(
    "and its weekday restriction at the slot",
    iso(resolutionInstants({ at: SLOT, bookedAt: BOOKED }, NOW).windowAt),
    iso(SLOT),
  );
  expectEqual(
    "a walk-up job with no booking time judges dates at the job",
    iso(resolutionInstants({ at: SLOT }, NOW).datesAt),
    iso(SLOT),
  );
  expectEqual(
    "no slot chosen yet skips the weekday restriction",
    iso(resolutionInstants({ at: null, bookedAt: NOW }, NOW).windowAt),
    null,
  );
  expectEqual(
    "but still judges dates at booking time",
    iso(resolutionInstants({ at: null, bookedAt: NOW }, NOW).datesAt),
    iso(NOW),
  );
  expectEqual(
    "nothing given judges both at now",
    iso(resolutionInstants({}, NOW).windowAt),
    iso(NOW),
  );

  // ---- When a job was booked ----
  // A job put straight into the calendar counts as booked when its event was made, so a
  // promo running then still applies to the job done after it ends.

  const BOOKING_MADE = new Date("2026-10-20T03:38:35Z");
  const EVENT_MADE = "2026-10-21T22:15:00.000Z";
  const NOV_JOB = new Date("2026-11-03T01:00:00Z");

  expectEqual(
    "a booking counts from its creation",
    iso(jobBookedAt(BOOKING_MADE, EVENT_MADE)),
    iso(BOOKING_MADE),
  );
  expectEqual(
    "a calendar-only job counts from when its event was made",
    iso(jobBookedAt(null, EVENT_MADE)),
    EVENT_MADE,
  );
  expectEqual("neither known leaves it unset", jobBookedAt(null, null), undefined);
  expectEqual("a garbled stamp leaves it unset", jobBookedAt(undefined, "not a date"), undefined);
  expectEqual(
    "an October phone job done in November judges dates in October",
    iso(resolutionInstants({ at: NOV_JOB, bookedAt: jobBookedAt(null, EVENT_MADE) }, NOW).datesAt),
    EVENT_MADE,
  );

  // ---- Recurring windows, in NZ time ----
  // NZ is +13 in March, +12 in June. Each pair is the same NZ wall clock at both offsets.

  const TUESDAY = [2];

  // Tuesday 00:30 NZ. Still Monday in UTC in both offsets.
  expectEqual(
    "NZDT: just after NZ midnight is already Tuesday",
    matchesRecurringWindow(window(TUESDAY), new Date("2026-03-30T11:30:00Z")),
    true,
  );
  expectEqual(
    "NZST: same NZ wall clock, different offset, same answer",
    matchesRecurringWindow(window(TUESDAY), new Date("2026-06-01T12:30:00Z")),
    true,
  );

  // Monday 23:59 NZ - one minute earlier, and it must not qualify.
  expectEqual(
    "NZDT: the minute before is still Monday",
    matchesRecurringWindow(window(TUESDAY), new Date("2026-03-30T10:59:00Z")),
    false,
  );
  expectEqual(
    "NZST: the minute before is still Monday",
    matchesRecurringWindow(window(TUESDAY), new Date("2026-06-01T11:59:00Z")),
    false,
  );

  expectEqual(
    "no weekday restriction admits every day",
    matchesRecurringWindow(window([]), new Date("2026-06-03T21:00:00Z")),
    true,
  );

  // Time of day: 09:00-17:00 NZ.
  const OFFICE = window([], 9 * 60, 17 * 60);

  expectEqual(
    "NZST: 09:00 NZ is inside an office-hours window",
    matchesRecurringWindow(OFFICE, new Date("2026-06-01T21:00:00Z")),
    true,
  );
  expectEqual(
    "NZDT: 09:00 NZ is inside it too, at the other offset",
    matchesRecurringWindow(OFFICE, new Date("2026-03-30T20:00:00Z")),
    true,
  );
  expectEqual(
    "NZST: 08:59 NZ is outside it",
    matchesRecurringWindow(OFFICE, new Date("2026-06-01T20:59:00Z")),
    false,
  );
  expectEqual(
    "16:59 NZ is the last minute inside it",
    matchesRecurringWindow(OFFICE, new Date("2026-06-02T04:59:00Z")),
    true,
  );
  // The end is when the offer stops: "9am to 5pm" doesn't cover a 5pm start.
  expectEqual(
    "the closing minute is excluded",
    matchesRecurringWindow(OFFICE, new Date("2026-06-02T05:00:00Z")),
    false,
  );

  // A range that ends before it starts wraps midnight.
  const OVERNIGHT = window([], 20 * 60, 2 * 60);
  expectEqual(
    "an overnight range admits the late evening",
    matchesRecurringWindow(OVERNIGHT, new Date("2026-06-01T09:00:00Z")),
    true,
  );
  expectEqual(
    "and the small hours",
    matchesRecurringWindow(OVERNIGHT, new Date("2026-06-01T13:00:00Z")),
    true,
  );
  expectEqual(
    "but not the afternoon between them",
    matchesRecurringWindow(OVERNIGHT, new Date("2026-06-01T03:00:00Z")),
    false,
  );
  expectEqual(
    "an overnight range stops at its end minute",
    matchesRecurringWindow(OVERNIGHT, new Date("2026-06-01T14:00:00Z")),
    false,
  );

  // Past midnight belongs to the night it started, so its day is judged as the day before.
  const FRIDAY_NIGHT = window([5], 20 * 60, 2 * 60);
  expectEqual(
    "Friday night: 21:00 Friday is in",
    matchesRecurringWindow(FRIDAY_NIGHT, new Date("2026-06-05T09:00:00Z")),
    true,
  );
  expectEqual(
    "Friday night: 01:00 Saturday is in",
    matchesRecurringWindow(FRIDAY_NIGHT, new Date("2026-06-05T13:00:00Z")),
    true,
  );
  expectEqual(
    "Friday night: 01:00 Friday is Thursday's night, so out",
    matchesRecurringWindow(FRIDAY_NIGHT, new Date("2026-06-04T13:00:00Z")),
    false,
  );
  expectEqual(
    "Friday night: 21:00 Saturday is out",
    matchesRecurringWindow(FRIDAY_NIGHT, new Date("2026-06-06T09:00:00Z")),
    false,
  );
  expectEqual(
    "Sunday night reaches 01:00 Monday across the week boundary",
    matchesRecurringWindow(window([0], 20 * 60, 2 * 60), new Date("2026-06-07T13:00:00Z")),
    true,
  );

  // Half a range is no restriction, never an open-ended one.
  expectEqual(
    "a start with no end is not a restriction",
    matchesRecurringWindow(window([], 9 * 60, null), new Date("2026-06-01T20:00:00Z")),
    true,
  );

  expectEqual("no restriction at all", hasRecurringWindow(window([])), false);
  expectEqual("a weekday list is a restriction", hasRecurringWindow(window(TUESDAY)), true);
  expectEqual("a complete time range is one", hasRecurringWindow(OFFICE), true);
  expectEqual("half a time range is not", hasRecurringWindow(window([], 9 * 60, null)), false);

  // ---- Naming the restriction ----
  // The banner shows a recurring promo whenever its outer window is open; this wording says when it applies.

  expectEqual("no restriction has nothing to say", describeRecurringWindow(window([])), null);
  expectEqual("one day", describeRecurringWindow(window(TUESDAY)), "Tuesdays");
  expectEqual("two days", describeRecurringWindow(window([2, 4])), "Tuesdays and Thursdays");
  expectEqual(
    "three read as a list",
    describeRecurringWindow(window([1, 2, 3])),
    "Mondays, Tuesdays and Wednesdays",
  );
  expectEqual(
    "the full working week has its own word",
    describeRecurringWindow(window([1, 2, 3, 4, 5])),
    "weekdays",
  );
  expectEqual("and so does the weekend", describeRecurringWindow(window([0, 6])), "weekends");
  expectEqual(
    "out-of-order days still read in order",
    describeRecurringWindow(window([4, 2])),
    "Tuesdays and Thursdays",
  );
  expectEqual("a time range alone", describeRecurringWindow(OFFICE), "9am to 5pm");
  expectEqual(
    "days and a time range together",
    describeRecurringWindow(window(TUESDAY, 9 * 60, 17 * 60)),
    "Tuesdays 9am to 5pm",
  );
  expectEqual(
    "a half hour keeps its minutes",
    describeRecurringWindow(window([], 9 * 60 + 30, 12 * 60)),
    "9:30am to 12pm",
  );
  expectEqual(
    "half a range says nothing, matching how it is enforced",
    describeRecurringWindow(window([], 9 * 60, null)),
    null,
  );

  finish();
}

main();
