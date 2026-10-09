// scripts/check-monthly-buckets.ts
// NZ month bucketing behind the admin charts, and the chart axis maths. The point of the
// bucketing cases: a row must land in the same month the dashboard's and business page's
// `>= nzMidnightUtc(y, m, 1)` filters put it in, either side of NZDT and NZST month ends,
// for real instants and for ledger dates (stored as UTC midnight of the NZ day).
// Run with: npm run check:monthly

import { formatAxisDollars, niceScale } from "@/features/admin/components/charts/chart-scale";
import { listFinancialYears } from "@/features/business/lib/financial-year";
import {
  fyMonthGroups,
  fyTotalGroups,
  type LedgerRows,
} from "@/features/business/lib/ledger-chart";
import {
  bucketByNzMonth,
  nzMonth,
  nzMonthLongLabel,
  nzMonthOf,
  nzMonthShortLabel,
  nzMonthSpan,
  nzMonthsEnding,
} from "@/features/business/lib/monthly";
import { nzMidnightUtc } from "@/shared/lib/timezone-utils";

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

/**
 * Month key a dashboard-style filter puts an instant in: the month whose
 * [nzMidnightUtc(1st), nzMidnightUtc(next 1st)) window contains it.
 * @param date - The instant.
 * @param candidates - Months to try.
 * @returns The matching key, or null.
 */
function filterMonthKey(date: Date, candidates: ReturnType<typeof nzMonth>[]): string | null {
  const hit = candidates.find(
    (m) =>
      date >= nzMidnightUtc(m.year, m.month, 1) && date < nzMidnightUtc(m.year, m.month + 1, 1),
  );
  return hit?.key ?? null;
}

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  console.log("Month boundaries in NZ time (the UTC instants are pinned):");
  const cases: Array<[string, number, number, string]> = [
    // NZDT (+13) runs until the first Sunday of April, so 1 April is still +13.
    ["1 Apr 2026, NZDT", 2026, 4, "2026-03-31T11:00:00.000Z"],
    // NZST (+12) mid-year.
    ["1 Jul 2026, NZST", 2026, 7, "2026-06-30T12:00:00.000Z"],
    // NZDT starts the last Sunday of September (27 Sep 2026), so 1 October is +13.
    ["1 Oct 2026, NZDT", 2026, 10, "2026-09-30T11:00:00.000Z"],
    ["1 Jan 2027, NZDT", 2027, 1, "2026-12-31T11:00:00.000Z"],
  ];
  for (const [label, y, m, iso] of cases) {
    const start = nzMidnightUtc(y, m, 1);
    expectEqual(`${label}: NZ midnight`, start.toISOString(), iso);
    expectEqual(`${label}: first instant`, nzMonthOf(start).key, nzMonth(y, m).key);
    expectEqual(
      `${label}: 1ms before`,
      nzMonthOf(new Date(start.getTime() - 1)).key,
      nzMonth(y, m - 1).key,
    );
  }

  console.log("\nLedger dates (UTC midnight of the NZ day):");
  expectEqual("31 Mar", nzMonthOf("2026-03-31T00:00:00.000Z").key, "2026-03");
  expectEqual("1 Apr", nzMonthOf("2026-04-01T00:00:00.000Z").key, "2026-04");
  expectEqual("30 Sep", nzMonthOf("2026-09-30T00:00:00.000Z").key, "2026-09");
  expectEqual("1 Oct", nzMonthOf("2026-10-01T00:00:00.000Z").key, "2026-10");
  expectEqual("31 Dec", nzMonthOf("2025-12-31T00:00:00.000Z").key, "2025-12");
  expectEqual("1 Jan", nzMonthOf("2026-01-01T00:00:00.000Z").key, "2026-01");
  expectEqual("Date object", nzMonthOf(new Date("2026-04-01T00:00:00.000Z")).key, "2026-04");

  console.log("\nBuckets agree with the pages' month filters:");
  const months = nzMonthSpan(nzMonth(2026, 3), nzMonth(2026, 10));
  const probes: Date[] = [];
  // Ledger dates across both DST month ends.
  for (const day of ["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-09-29"]) {
    probes.push(new Date(`${day}T00:00:00.000Z`));
  }
  for (const day of ["2026-09-30", "2026-10-01", "2026-10-02", "2026-06-30", "2026-07-01"]) {
    probes.push(new Date(`${day}T00:00:00.000Z`));
  }
  // Real instants every 30 minutes for a day either side of each month start.
  for (const m of [nzMonth(2026, 4), nzMonth(2026, 7), nzMonth(2026, 10)]) {
    const start = nzMidnightUtc(m.year, m.month, 1).getTime();
    for (let t = start - 86_400_000; t <= start + 86_400_000; t += 1_800_000) {
      probes.push(new Date(t));
    }
  }
  const mismatches = probes.filter((d) => nzMonthOf(d).key !== filterMonthKey(d, months));
  expectEqual(
    `${probes.length} probes, mismatches`,
    mismatches.map((d) => d.toISOString()),
    [],
  );

  console.log("\nbucketByNzMonth:");
  const rows = [
    { date: "2026-03-31T00:00:00.000Z", amount: 0.1 },
    { date: "2026-03-01T00:00:00.000Z", amount: 0.2 },
    { date: "2026-04-01T00:00:00.000Z", amount: 50 },
    { date: new Date("2026-03-31T11:00:00.000Z"), amount: 7 },
    { date: "2025-12-15T00:00:00.000Z", amount: 999 },
  ];
  const window = nzMonthSpan(nzMonth(2026, 3), nzMonth(2026, 5));
  expectEqual(
    "Mar/Apr/May totals (0.1 + 0.2 rounds, NZ-midnight instant lands in April, Dec ignored)",
    bucketByNzMonth(rows, { date: "date", amount: "amount" }, window),
    [0.3, 57, 0],
  );
  expectEqual(
    "empty month list",
    bucketByNzMonth(rows, { date: "date", amount: "amount" }, []),
    [],
  );

  console.log("\nMonth ranges and labels:");
  expectEqual("month 13 wraps", nzMonth(2026, 13).key, "2027-01");
  expectEqual("month 0 wraps", nzMonth(2026, 0).key, "2025-12");
  expectEqual("month -11 wraps", nzMonth(2026, -11).key, "2025-01");
  const ending = nzMonthsEnding(nzMonth(2026, 2), 12);
  expectEqual(
    "12 ending Feb 2026",
    [ending.length, ending[0]?.key, ending[11]?.key],
    [12, "2025-03", "2026-02"],
  );
  expectEqual(
    "span Oct 2025 > Oct 2026",
    nzMonthSpan(nzMonth(2025, 10), nzMonth(2026, 10)).length,
    13,
  );
  expectEqual("span backwards", nzMonthSpan(nzMonth(2026, 5), nzMonth(2026, 4)), []);
  expectEqual("short label", nzMonthShortLabel(nzMonth(2026, 10)), "Oct");
  expectEqual("long label", nzMonthLongLabel(nzMonth(2026, 10)), "October 2026");

  console.log("\nBusiness chart groups (every row in scope lands in a group):");
  const businessStart = new Date("2025-10-01T00:00:00.000Z");
  const now = new Date("2026-10-07T20:00:00.000Z"); // 8 Oct 2026, 9am NZDT
  const fy2526 = { startISO: "2025-04-01T00:00:00.000Z", endISO: "2026-04-01T00:00:00.000Z" };
  const fy2627 = { startISO: "2026-04-01T00:00:00.000Z", endISO: "2027-04-01T00:00:00.000Z" };
  const past: LedgerRows = {
    income: [
      { date: "2025-10-06T00:00:00.000Z", amount: 100 },
      { date: "2026-03-31T00:00:00.000Z", amount: 50 },
    ],
    expenses: [{ date: "2025-11-12T00:00:00.000Z", amount: 10 }],
  };
  const pastGroups = fyMonthGroups(past, fy2526, businessStart, now);
  expectEqual(
    "partial FY starts at the business start month",
    pastGroups.map((g) => g.key),
    ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"],
  );
  expectEqual(
    "partial FY totals",
    [0, 1].map((si) => pastGroups.reduce((s, g) => s + (g.values[si] ?? 0), 0)),
    [150, 10],
  );
  const early: LedgerRows = {
    ...past,
    income: [...past.income, { date: "2025-09-20T00:00:00.000Z", amount: 1 }],
  };
  expectEqual(
    "a row before the business start pulls the first month back",
    fyMonthGroups(early, fy2526, businessStart, now)[0]?.key,
    "2025-09",
  );
  // 9am NZDT on 1 April: inside FY 2025-26's ISO window (before UTC midnight), April in NZ.
  const aprilFirstInstant: LedgerRows = {
    ...past,
    income: [...past.income, { date: "2026-03-31T20:00:00.000Z", amount: 100 }],
  };
  const aprilGroups = fyMonthGroups(aprilFirstInstant, fy2526, businessStart, now);
  expectEqual(
    "real instant early on 1 April counts in the closing FY's March",
    [aprilGroups.length, aprilGroups[aprilGroups.length - 1]?.values[0]],
    [6, 150],
  );
  const running: LedgerRows = {
    income: [
      { date: "2026-04-02T00:00:00.000Z", amount: 20 },
      { date: "2026-10-01T00:00:00.000Z", amount: 5 },
    ],
    expenses: [],
  };
  const runningGroups = fyMonthGroups(running, fy2627, businessStart, now);
  expectEqual(
    "current FY stops at this month, labelled to date",
    [runningGroups.length, runningGroups[runningGroups.length - 1]?.label],
    [7, "October 2026 (to date)"],
  );
  const ahead: LedgerRows = {
    ...running,
    expenses: [{ date: "2026-12-05T00:00:00.000Z", amount: 9 }],
  };
  expectEqual(
    "a future-dated row extends the current FY to its month",
    fyMonthGroups(ahead, fy2627, businessStart, now)
      .map((g) => g.key)
      .slice(-1),
    ["2026-12"],
  );
  const allRows: LedgerRows = {
    income: [...past.income, ...running.income, { date: "2025-02-10T00:00:00.000Z", amount: 3 }],
    expenses: [...past.expenses, ...ahead.expenses],
  };
  const fyGroups = fyTotalGroups(
    allRows,
    listFinancialYears(now, businessStart),
    businessStart,
    now,
  );
  expectEqual(
    "all-time FY groups oldest first, outside row adds its FY",
    fyGroups.map((g) => [g.key, g.values]),
    [
      ["2024-25", [3, 0]],
      ["2025-26", [150, 10]],
      ["2026-27", [25, 9]],
    ],
  );
  expectEqual("current FY labelled to date", fyGroups[2]?.label, "FY 2026-27 (to date)");
  const earlyInstant: LedgerRows = {
    income: [{ date: "2025-03-31T20:00:00.000Z", amount: 4 }],
    expenses: [],
  };
  expectEqual(
    "all-time: a 1 April instant before the listed FYs adds the FY its ISO window names",
    fyTotalGroups(earlyInstant, listFinancialYears(now, businessStart), businessStart, now).map(
      (g) => [g.key, g.values],
    ),
    [
      ["2024-25", [4, 0]],
      ["2025-26", [0, 0]],
      ["2026-27", [0, 0]],
    ],
  );

  console.log("\nAxis scale:");
  expectEqual("max 4147.98", niceScale(4147.98), {
    top: 5000,
    step: 1000,
    ticks: [0, 1000, 2000, 3000, 4000, 5000],
  });
  expectEqual("max 3087.79", niceScale(3087.79).top, 4000);
  expectEqual("max 412.84", niceScale(412.84), {
    top: 500,
    step: 100,
    ticks: [0, 100, 200, 300, 400, 500],
  });
  expectEqual("max 7.23", niceScale(7.23).ticks, [0, 2, 4, 6, 8]);
  expectEqual("max exactly on a step", niceScale(2000).top, 2000);
  expectEqual("max 0", niceScale(0), { top: 1, step: 1, ticks: [0, 1] });
  expectEqual("max 0.01 keeps distinct ticks", niceScale(0.01).ticks, [0, 0.01]);
  expectEqual("max 0.12 skips the 2.5c step", niceScale(0.12).ticks, [0, 0.05, 0.1, 0.15]);
  expectEqual("axis label thousands", formatAxisDollars(2500), "$2,500");
  expectEqual("axis label cents", formatAxisDollars(2.5), "$2.50");
  expectEqual("axis label zero", formatAxisDollars(0), "$0");

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
