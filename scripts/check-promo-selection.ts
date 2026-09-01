// scripts/check-promo-selection.ts
// Which promo wins when several windows overlap, and how a customer-entered
// code is normalised before it is compared. Pure logic, no database: the window
// filter itself is Prisma's job.
// Run with: npm run check:promos

import {
  describeRecurringWindow,
  hasRecurringWindow,
  matchesRecurringWindow,
  normalisePromoCode,
  pickWinningPromo,
  type PromoCandidate,
  type RecurringWindow,
} from "@/features/business/lib/promos";

let failures = 0;

/**
 * Compares the winning promo id against its expectation, recording rather than
 * throwing so every fixture runs even after one fails.
 * @param label - Human-readable case name.
 * @param actual - Winning promo id, or null.
 * @param expected - Id the case should produce.
 */
function expectWinner(label: string, actual: string | null, expected: string | null): void {
  if (actual === expected) {
    console.log(`  PASS  ${label} > ${actual ?? "null"}`);
  } else {
    console.error(`  FAIL  ${label} > expected ${expected ?? "null"}, got ${actual ?? "null"}`);
    failures++;
  }
}

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
 * Compares a boolean against its expectation.
 * @param label - Human-readable case name.
 * @param actual - What the function returned.
 * @param expected - What it should have returned.
 */
function expectBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) {
    console.log(`  PASS  ${label} > ${actual}`);
  } else {
    console.error(`  FAIL  ${label} > expected ${expected}, got ${actual}`);
    failures++;
  }
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

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("promo selection fixtures\n");

  expectWinner("no candidates", pickWinningPromo([])?.id ?? null, null);

  expectWinner(
    "single candidate wins",
    pickWinningPromo([promo("a", 0, "2026-01-01")])?.id ?? null,
    "a",
  );

  // The whole point of the priority column.
  expectWinner(
    "higher priority beats newer",
    pickWinningPromo([
      promo("old-important", 10, "2026-01-01"),
      promo("new-ordinary", 0, "2026-06-01"),
    ])?.id ?? null,
    "old-important",
  );

  // Existing promos all sit at 0, so the old behaviour must survive untouched.
  expectWinner(
    "equal priority falls back to newest",
    pickWinningPromo([promo("older", 0, "2026-01-01"), promo("newer", 0, "2026-06-01")])?.id ??
      null,
    "newer",
  );

  expectWinner(
    "negative priority loses to default",
    pickWinningPromo([promo("suppressed", -5, "2026-06-01"), promo("normal", 0, "2026-01-01")])
      ?.id ?? null,
    "normal",
  );

  // Order in must not matter.
  expectWinner(
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

  expectWinner("trims and uppercases", normalisePromoCode("  spring25 "), "SPRING25");
  expectWinner("blank becomes null", normalisePromoCode("   "), null);
  expectWinner("undefined becomes null", normalisePromoCode(undefined), null);
  expectWinner("null stays null", normalisePromoCode(null), null);
  expectWinner("already uppercase is unchanged", normalisePromoCode("SPRING25"), "SPRING25");

  // ---- Recurring windows, in NZ time ----
  //
  // The whole point of these cases. NZ runs +13 (NZDT) in March and +12 (NZST)
  // in June, so a UTC weekday read puts the day boundary at 11am or noon NZ and
  // a Tuesday promo half-applies on Monday. Each pair below is the same NZ wall
  // clock either side of a daylight saving change, and both must agree.

  const TUESDAY = [2];

  // Tuesday 00:30 NZ. Still Monday in UTC in both offsets.
  expectBool(
    "NZDT: just after NZ midnight is already Tuesday",
    matchesRecurringWindow(window(TUESDAY), new Date("2026-03-30T11:30:00Z")),
    true,
  );
  expectBool(
    "NZST: same NZ wall clock, different offset, same answer",
    matchesRecurringWindow(window(TUESDAY), new Date("2026-06-01T12:30:00Z")),
    true,
  );

  // Monday 23:59 NZ - one minute earlier, and it must not qualify.
  expectBool(
    "NZDT: the minute before is still Monday",
    matchesRecurringWindow(window(TUESDAY), new Date("2026-03-30T10:59:00Z")),
    false,
  );
  expectBool(
    "NZST: the minute before is still Monday",
    matchesRecurringWindow(window(TUESDAY), new Date("2026-06-01T11:59:00Z")),
    false,
  );

  expectBool(
    "no weekday restriction admits every day",
    matchesRecurringWindow(window([]), new Date("2026-06-03T21:00:00Z")),
    true,
  );

  // Time of day: 09:00-17:00 NZ.
  const OFFICE = window([], 9 * 60, 17 * 60);

  expectBool(
    "NZST: 09:00 NZ is inside an office-hours window",
    matchesRecurringWindow(OFFICE, new Date("2026-06-01T21:00:00Z")),
    true,
  );
  expectBool(
    "NZDT: 09:00 NZ is inside it too, at the other offset",
    matchesRecurringWindow(OFFICE, new Date("2026-03-30T20:00:00Z")),
    true,
  );
  expectBool(
    "NZST: 08:59 NZ is outside it",
    matchesRecurringWindow(OFFICE, new Date("2026-06-01T20:59:00Z")),
    false,
  );
  expectBool(
    "the closing minute is included",
    matchesRecurringWindow(OFFICE, new Date("2026-06-02T05:00:00Z")),
    true,
  );

  // A range that ends before it starts wraps midnight. Read the other way it
  // would admit nothing, which looks like a broken promo rather than a
  // misconfigured one.
  const OVERNIGHT = window([], 20 * 60, 2 * 60);
  expectBool(
    "an overnight range admits the late evening",
    matchesRecurringWindow(OVERNIGHT, new Date("2026-06-01T09:00:00Z")),
    true,
  );
  expectBool(
    "and the small hours",
    matchesRecurringWindow(OVERNIGHT, new Date("2026-06-01T13:00:00Z")),
    true,
  );
  expectBool(
    "but not the afternoon between them",
    matchesRecurringWindow(OVERNIGHT, new Date("2026-06-01T03:00:00Z")),
    false,
  );

  // Half a range is not a range: treating one end as open would silently widen
  // a restriction the operator thought they had set.
  expectBool(
    "a start with no end is not a restriction",
    matchesRecurringWindow(window([], 9 * 60, null), new Date("2026-06-01T20:00:00Z")),
    true,
  );

  expectBool("no restriction at all", hasRecurringWindow(window([])), false);
  expectBool("a weekday list is a restriction", hasRecurringWindow(window(TUESDAY)), true);
  expectBool("a complete time range is one", hasRecurringWindow(OFFICE), true);
  expectBool("half a time range is not", hasRecurringWindow(window([], 9 * 60, null)), false);

  // ---- Naming the restriction ----
  //
  // The banner shows a recurring promo whenever its outer window is open, so
  // this wording is what stops "20% off" reading as an offer that applies right
  // now. Hiding it until the day itself would keep it from exactly the person
  // deciding whether to book one.

  expectWinner("no restriction has nothing to say", describeRecurringWindow(window([])), null);
  expectWinner("one day", describeRecurringWindow(window(TUESDAY)), "Tuesdays");
  expectWinner("two days", describeRecurringWindow(window([2, 4])), "Tuesdays and Thursdays");
  expectWinner(
    "three read as a list",
    describeRecurringWindow(window([1, 2, 3])),
    "Mondays, Tuesdays and Wednesdays",
  );
  expectWinner(
    "the full working week has its own word",
    describeRecurringWindow(window([1, 2, 3, 4, 5])),
    "weekdays",
  );
  expectWinner("and so does the weekend", describeRecurringWindow(window([0, 6])), "weekends");
  expectWinner(
    "out-of-order days still read in order",
    describeRecurringWindow(window([4, 2])),
    "Tuesdays and Thursdays",
  );
  expectWinner("a time range alone", describeRecurringWindow(OFFICE), "9am to 5pm");
  expectWinner(
    "days and a time range together",
    describeRecurringWindow(window(TUESDAY, 9 * 60, 17 * 60)),
    "Tuesdays 9am to 5pm",
  );
  expectWinner(
    "a half hour keeps its minutes",
    describeRecurringWindow(window([], 9 * 60 + 30, 12 * 60)),
    "9:30am to 12pm",
  );
  expectWinner(
    "half a range says nothing, matching how it is enforced",
    describeRecurringWindow(window([], 9 * 60, null)),
    null,
  );

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
