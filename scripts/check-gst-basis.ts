// scripts/check-gst-basis.ts
// GST basis in the profit readers: what an expense costs and what income counts for profit
// depend on whether the business was GST registered on the row's NZ day. Covers the
// settings > status mapping, the rate a new expense defaults to, the chart rows the
// business page and the dashboard build, FY totals across a mid-year registration, and the
// series labels.
// Run with: npm run check:gst-basis

import { incomeExpenseSeries } from "@/features/admin/components/charts/series";
import { listFinancialYears } from "@/features/business/lib/financial-year";
import {
  basisExpenseRows,
  basisIncomeRows,
  fyMonthGroups,
  fyTotalGroups,
} from "@/features/business/lib/ledger-chart";
import { expenseGstRateOn, gstStatusFromPricing } from "@/features/business/lib/tax/gst-basis";
import type { GstStatus } from "@/features/business/lib/tax/types";

let failures = 0;

/**
 * Compares a value against its expectation, recording rather than throwing so
 * every fixture runs even after one fails.
 * @param label - Human-readable case name.
 * @param actual - What the call produced.
 * @param expected - What it should have produced.
 */
function expectEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS  ${label} > ${a}`);
  } else {
    console.error(`  FAIL  ${label} > expected ${e}, got ${a}`);
    failures++;
  }
}

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  const unregistered: GstStatus = { registered: false, registeredFrom: null };
  const fromStart: GstStatus = { registered: true, registeredFrom: null };
  const fromNov: GstStatus = { registered: true, registeredFrom: "2026-11-01" };

  console.log("Status from the pricing settings:");
  expectEqual(
    "unregistered keeps the date but is not registered",
    gstStatusFromPricing({ gstRegistered: false, gstRegisteredFrom: "2026-11-01" }),
    { registered: false, registeredFrom: "2026-11-01" },
  );
  expectEqual(
    "blank date = from the business start",
    gstStatusFromPricing({ gstRegistered: true, gstRegisteredFrom: "" }),
    fromStart,
  );
  expectEqual(
    "date is trimmed",
    gstStatusFromPricing({ gstRegistered: true, gstRegisteredFrom: " 2026-11-01 " }),
    fromNov,
  );

  console.log("\nRate a new expense defaults to:");
  expectEqual("unregistered > 0", expenseGstRateOn("2026-10-15", unregistered, 0.15), 0);
  expectEqual("day before registration > 0", expenseGstRateOn("2026-10-31", fromNov, 0.15), 0);
  expectEqual("registration day > 15%", expenseGstRateOn("2026-11-01", fromNov, 0.15), 0.15);
  expectEqual(
    "registered from the start > 15%",
    expenseGstRateOn("2025-10-01", fromStart, 0.15),
    0.15,
  );
  // 12:30 UTC on 31 Oct is 1:30am NZDT on 1 Nov: the NZ day decides, not the UTC one.
  expectEqual(
    "real instant just after NZ midnight on registration day > 15%",
    expenseGstRateOn(new Date("2026-10-31T12:30:00.000Z"), fromNov, 0.15),
    0.15,
  );

  console.log("\nChart rows on the GST basis:");
  const rows = [
    { date: "2026-10-20T00:00:00.000Z", amountIncl: 115, amountExcl: 100 },
    { date: "2026-11-05T00:00:00.000Z", amountIncl: 230, amountExcl: 200 },
  ];
  expectEqual(
    "mid-year registration: incl. before, excl. from the date",
    basisExpenseRows(rows, fromNov).map((r) => r.amount),
    [115, 200],
  );
  expectEqual(
    "unregistered: every row incl. GST",
    basisExpenseRows(rows, unregistered).map((r) => r.amount),
    [115, 230],
  );

  // Income stores only the GST-inclusive amount; from registration its GST (3/23 at 15%)
  // is backed out, to the cent.
  const incomeRows = [
    { date: "2026-10-20T00:00:00.000Z", amount: 115 },
    { date: new Date("2026-11-05T00:00:00.000Z"), amount: 230 },
    { date: "2026-11-06T00:00:00.000Z", amount: 100 },
  ];
  expectEqual(
    "income: incl. before registration, excl. from the date (Date and ISO rows)",
    basisIncomeRows(incomeRows, fromNov).map((r) => r.amount),
    [115, 200, 86.96],
  );
  expectEqual(
    "income: unregistered counts every row as received",
    basisIncomeRows(incomeRows, unregistered).map((r) => r.amount),
    [115, 230, 100],
  );
  expectEqual(
    "income: each row keeps its own date value (Date stays a Date)",
    basisIncomeRows(incomeRows, fromNov).map((r, i) => r.date === incomeRows[i]?.date),
    [true, true, true],
  );
  expectEqual(
    "income: real instant just after NZ midnight on registration day counts excl.",
    basisIncomeRows([{ date: new Date("2026-10-31T12:30:00.000Z"), amount: 115 }], fromNov).map(
      (r) => r.amount,
    ),
    [100],
  );

  const businessStart = new Date("2025-10-01T00:00:00.000Z");
  const now = new Date("2027-01-10T00:00:00.000Z");
  const income = [{ date: "2026-10-01T00:00:00.000Z", amount: 500 }];
  const fys = listFinancialYears(now, businessStart);
  expectEqual(
    "FY totals across a mid-year registration",
    fyTotalGroups(
      { income, expenses: basisExpenseRows(rows, fromNov) },
      fys,
      businessStart,
      now,
    ).map((g) => [g.key, g.values]),
    [
      ["2025-26", [0, 0]],
      ["2026-27", [500, 315]],
    ],
  );
  expectEqual(
    "FY totals while unregistered",
    fyTotalGroups(
      { income, expenses: basisExpenseRows(rows, unregistered) },
      fys,
      businessStart,
      now,
    ).map((g) => g.values[1]),
    [0, 345],
  );
  expectEqual(
    "FY income totals across a mid-year registration",
    fyTotalGroups(
      { income: basisIncomeRows(incomeRows, fromNov), expenses: [] },
      fys,
      businessStart,
      now,
    ).map((g) => [g.key, g.values[0]]),
    [
      ["2025-26", 0],
      ["2026-27", 401.96],
    ],
  );
  const fy2627 = { startISO: "2026-04-01T00:00:00.000Z", endISO: "2027-04-01T00:00:00.000Z" };
  expectEqual(
    "month groups split at the registration date",
    fyMonthGroups({ income, expenses: basisExpenseRows(rows, fromNov) }, fy2627, businessStart, now)
      .filter((g) => g.key === "2026-10" || g.key === "2026-11")
      .map((g) => [g.key, g.values[1]]),
    [
      ["2026-10", 115],
      ["2026-11", 200],
    ],
  );
  expectEqual(
    "income month groups split at the registration date",
    fyMonthGroups(
      { income: basisIncomeRows(incomeRows, fromNov), expenses: [] },
      fy2627,
      businessStart,
      now,
    )
      .filter((g) => g.key === "2026-10" || g.key === "2026-11")
      .map((g) => [g.key, g.values[0]]),
    [
      ["2026-10", 115],
      ["2026-11", 286.96],
    ],
  );

  console.log("\nSeries labels:");
  expectEqual(
    "unregistered",
    incomeExpenseSeries(false).map((s) => s.label),
    ["Income", "Expenses"],
  );
  expectEqual(
    "registered",
    incomeExpenseSeries(true).map((s) => s.label),
    ["Income (excl. GST)", "Expenses (excl. GST)"],
  );
  expectEqual(
    "keys and colours stay put",
    incomeExpenseSeries(true).map((s) => [s.key, s.fillClass]),
    [
      ["income", "bg-rich-black-700"],
      ["expenses", "bg-russian-violet-400"],
    ],
  );

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
