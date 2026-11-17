// scripts/check-expense-recurrence.ts
// Recurring-expense detection: only a steady amount on a steady schedule counts as a
// subscription candidate. Repeat fuel fills or parts runs to one supplier must not.
// Run with: npm test -- expense-recurrence

import { findRecurring } from "@/features/business/components/expenses-recurrence";
import type { ExpenseEntry } from "@/features/business/types/business";
import { expectEqual, finish } from "./lib/harness.js";

let nextId = 0;

/**
 * Builds a ledger row with only the fields recurrence looks at.
 * @param date - YYYY-MM-DD.
 * @param supplier - Supplier.
 * @param description - Description.
 * @param amountIncl - GST-inclusive amount.
 * @param category - Category (defaults to Subscriptions).
 * @returns The fixture row.
 */
function row(
  date: string,
  supplier: string,
  description: string,
  amountIncl: number,
  category = "Subscriptions",
): ExpenseEntry {
  nextId += 1;
  return {
    id: `e${nextId}`,
    date: `${date}T00:00:00.000Z`,
    supplier,
    description,
    category,
    amountIncl,
    gstAmount: 0,
    amountExcl: amountIncl,
    method: "Personal then Reimburse",
    receipt: false,
    notes: null,
    createdAt: `${date}T00:00:00.000Z`,
  };
}

/**
 * Run dates for a row, or null when it isn't recurring.
 * @param runs - Output of {@link findRecurring}.
 * @param e - The row.
 * @returns The run's dates (YYYY-MM-DD), or null.
 */
function runDates(runs: Map<string, ExpenseEntry[]>, e: ExpenseEntry): string[] | null {
  return runs.get(e.id)?.map((m) => m.date.slice(0, 10)) ?? null;
}

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  console.log("fuel fills at varying amounts and gaps are not recurring");
  {
    const fuel = [
      ["2026-07-11", 84.88],
      ["2026-07-16", 57.62],
      ["2026-08-05", 50],
      ["2026-09-25", 100],
      ["2026-10-04", 180.61],
      ["2026-10-20", 100],
      ["2026-11-01", 67],
    ].map(([d, a]) => row(d as string, "Tasman Epsom", "Fuel fill up", a as number, "Fuel"));
    const runs = findRecurring(fuel);
    expectEqual("no fuel row flagged", runs.size, 0);
  }

  console.log("a fixed monthly fuel amount still isn't a subscription");
  {
    const fuel = ["2026-08-01", "2026-09-01", "2026-10-01"].map((d) =>
      row(d, "Tasman Epsom", "Fuel fill up", 100, "Fuel"),
    );
    expectEqual("Fuel category never flagged", findRecurring(fuel).size, 0);
  }

  console.log("a steady monthly charge is recurring, with FX drift tolerated");
  {
    const max = [
      row("2026-06-08", "Anthropic", "Claude Max", 200),
      row("2026-07-08", "Anthropic", "Claude Max", 198.79),
      row("2026-08-08", "Anthropic", "Claude Max", 200),
      row("2026-09-08", "Anthropic", "Claude Max", 200),
      // Usage-priced months: amount off by more than the drift allowance.
      row("2026-10-10", "Anthropic", "Claude Max", 161.21),
      row("2026-11-17", "Anthropic", "Claude Max", 170.65),
    ];
    const runs = findRecurring(max);
    expectEqual("200 run found", runDates(runs, max[0]!), [
      "2026-06-08",
      "2026-07-08",
      "2026-08-08",
      "2026-09-08",
    ]);
    expectEqual("off-amount month not in the run", runDates(runs, max[4]!), null);
  }

  console.log("two monthly charges after a long gap are not yet a run");
  {
    const pro = [
      row("2026-04-09", "Anthropic", "Claude Pro", 40),
      row("2026-10-08", "Anthropic", "Claude Pro", 40),
      row("2026-11-09", "Anthropic", "Claude Pro", 40),
    ];
    expectEqual("Claude Pro not flagged", findRecurring(pro).size, 0);
    const third = [...pro, row("2026-12-08", "Anthropic", "Claude Pro", 40)];
    expectEqual("third month in a row flags it", runDates(findRecurring(third), third[3]!), [
      "2026-10-08",
      "2026-11-09",
      "2026-12-08",
    ]);
  }

  console.log("a price change splits the run, each side judged on its own");
  {
    const ws = [
      row("2026-01-01", "Google", "Google Workspace", 12.6),
      row("2026-02-01", "Google", "Google Workspace", 12.6),
      row("2026-03-01", "Google", "Google Workspace", 12.6),
      row("2026-04-02", "Google", "Google Workspace", 14.49),
      row("2026-05-02", "Google", "Google Workspace", 14.49),
      row("2026-06-02", "Google", "Google Workspace", 14.49),
    ];
    const runs = findRecurring(ws);
    expectEqual("old price run", runDates(runs, ws[0]!)?.length, 3);
    expectEqual("new price run", runDates(runs, ws[5]!)?.length, 3);
  }

  console.log("same-day duplicates are not a schedule");
  {
    const dup = ["2026-08-01", "2026-08-01", "2026-08-01"].map((d) =>
      row(d, "PB Tech", "USB sticks", 29.54, "Tools"),
    );
    expectEqual("not flagged", findRecurring(dup).size, 0);
  }

  console.log("supplier and description match loosely on case and spacing");
  {
    const yearly = [
      row("2024-06-17", "GoDaddy", "Domain", 45.99, "Software"),
      row("2025-06-17", "godaddy ", "domain", 45.99, "Software"),
      row("2026-06-17", "GoDaddy", "Domain ", 45.99, "Software"),
    ];
    expectEqual("annual run found", runDates(findRecurring(yearly), yearly[2]!)?.length, 3);
  }

  finish();
}

main();
