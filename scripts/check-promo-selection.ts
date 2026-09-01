// scripts/check-promo-selection.ts
// Which promo wins when several windows overlap, and how a customer-entered
// code is normalised before it is compared. Pure logic, no database: the window
// filter itself is Prisma's job.
// Run with: npm run check:promos

import {
  normalisePromoCode,
  pickWinningPromo,
  type PromoCandidate,
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

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
