// scripts/check-promo-selection.ts
// Which promo wins when several windows overlap, and how a customer-entered
// code is normalised before it is compared. Pure logic, no database: the window
// filter itself is Prisma's job.
// Run with: npm test -- promo-selection

import {
  describeRecurringWindow,
  hasRecurringWindow,
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
 * @param d - The instant, or null.
 * @returns Its ISO string, or null.
 */
function iso(d: Date | null): string | null {
  return d?.toISOString() ?? null;
}

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("promo selection fixtures\n");

  expectEqual("no candidates", pickWinningPromo([])?.id ?? null, null);

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

  // Existing promos all sit at 0, so the old behaviour must survive untouched.
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
  //
  // Stored codes are uppercase, so comparing anything else silently fails to
  // match and the customer is told a real code is invalid.

  expectEqual("trims and uppercases", normalisePromoCode("  spring25 "), "SPRING25");
  expectEqual("blank becomes null", normalisePromoCode("   "), null);
  expectEqual("undefined becomes null", normalisePromoCode(undefined), null);
  expectEqual("null stays null", normalisePromoCode(null), null);
  expectEqual("already uppercase is unchanged", normalisePromoCode("SPRING25"), "SPRING25");
  // Public routes hand over whatever JSON arrived. A throw here took the
  // automatic promo down with the code in booking/request.
  expectEqual("a number is not a code", normalisePromoCode(25), null);
  expectEqual("an object is not a code", normalisePromoCode({ $ne: "" }), null);

  // ---- Booking date vs appointment ----
  //
  // A promo's start and end dates bound when the booking was made; its weekday
  // restriction is judged at the appointment. Booking on the last day of a promo
  // for a visit the week after keeps it.

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

  // ---- Recurring windows, in NZ time ----
  //
  // The whole point of these cases. NZ runs +13 (NZDT) in March and +12 (NZST)
  // in June, so a UTC weekday read puts the day boundary at 11am or noon NZ and
  // a Tuesday promo half-applies on Monday. Each pair below is the same NZ wall
  // clock either side of a daylight saving change, and both must agree.

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
    "the closing minute is included",
    matchesRecurringWindow(OFFICE, new Date("2026-06-02T05:00:00Z")),
    true,
  );

  // A range that ends before it starts wraps midnight. Read the other way it
  // would admit nothing, which looks like a broken promo rather than a
  // misconfigured one.
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

  // Half a range is not a range: treating one end as open would silently widen
  // a restriction the operator thought they had set.
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
  //
  // The banner shows a recurring promo whenever its outer window is open, so
  // this wording is what stops "20% off" reading as an offer that applies right
  // now. Hiding it until the day itself would keep it from exactly the person
  // deciding whether to book one.

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
