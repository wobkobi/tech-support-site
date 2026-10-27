// scripts/check-subscription-due.ts
// A subscription due on the 29th-31st returns to its day after a short month instead of
// drifting to the 28th for good, and a blank amount is refused rather than read as $0.
// Run with: npm test -- subscription-due

import { advanceNextDue } from "@/features/business/lib/invoice-maths";
import { parseAmount } from "@/features/business/lib/validation";
import { expectEqual, finish } from "./lib/harness.js";

/**
 * Steps a due date `times` times and returns each date key.
 * @param start - First due date key (YYYY-MM-DD).
 * @param frequency - Billing frequency.
 * @param times - Number of steps.
 * @param dueDay - Stored due day, or null for a row saved before it existed.
 * @returns The date keys after each step.
 */
function steps(start: string, frequency: string, times: number, dueDay: number | null): string[] {
  const out: string[] = [];
  let d = new Date(`${start}T00:00:00.000Z`);
  for (let i = 0; i < times; i++) {
    d = advanceNextDue(d, frequency, dueDay);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Runs every fixture and exits non-zero when any fail.
 */
function main(): void {
  expectEqual("monthly on the 31st returns after February", steps("2027-01-31", "monthly", 4, 31), [
    "2027-02-28",
    "2027-03-31",
    "2027-04-30",
    "2027-05-31",
  ]);
  expectEqual("leap-year February clamps to the 29th", steps("2028-01-30", "monthly", 2, 30), [
    "2028-02-29",
    "2028-03-30",
  ]);
  expectEqual("quarterly on the 31st", steps("2026-11-30", "quarterly", 2, 31), [
    "2027-02-28",
    "2027-05-31",
  ]);
  expectEqual("annually on 29 Feb", steps("2028-02-29", "annually", 4, 29), [
    "2029-02-28",
    "2030-02-28",
    "2031-02-28",
    "2032-02-29",
  ]);
  expectEqual("an ordinary day stays put", steps("2026-11-02", "monthly", 3, 2), [
    "2026-12-02",
    "2027-01-02",
    "2027-02-02",
  ]);
  expectEqual("a row with no due day keeps its own day", steps("2026-11-08", "monthly", 2, null), [
    "2026-12-08",
    "2027-01-08",
  ]);
  expectEqual("weekly ignores the due day", steps("2026-12-29", "weekly", 1, 29), ["2027-01-05"]);

  expectEqual("blank amount", parseAmount(""), null);
  expectEqual("spaces only", parseAmount("  "), null);
  expectEqual("null amount", parseAmount(null), null);
  expectEqual("boolean amount", parseAmount(false), null);
  expectEqual("zero is still allowed", parseAmount(0), 0);
  expectEqual("numeric string", parseAmount("12.50"), 12.5);
  expectEqual("negative refused", parseAmount(-1), null);

  finish();
}

main();
