// scripts/check-gold-card.ts
// The Gold Card discount: a percent off labour (hourly lines plus the date surcharge),
// taken after the promo and before an unsuccessful visit is halved. Travel and parts stay
// full price, and the saved invoice must land on the same total as the calculator.
// Run with: npm test -- gold-card

import {
  calcInvoiceTotals,
  calcJobTotal,
  goldCardLineLabel,
  jobToLineItems,
  type JobPricing,
  type JobPromo,
  type LabourSurcharge,
} from "@/features/business/lib/business";
import { goldCardPercent } from "@/features/business/lib/gold-card";
import type { RateConfig } from "@/features/business/types/business";
import { expectEqual, finish } from "./lib/harness.js";

type Job = Parameters<typeof calcJobTotal>[0];

interface LineSpec {
  /** Billed minutes; hours are minutes / 60, unrounded like the calculator. */
  minutes: number;
  unitPrice: number;
  unsuccessful?: boolean;
  /** A rate-row flat charge (rateConfigId set, no base rate). */
  flatRate?: boolean;
  /** A no-row flat charge such as a cancellation fee. */
  flatFee?: boolean;
  /** Tagged with the Business modifier. */
  business?: boolean;
}

/**
 * Builds a job shaped like the calculator's.
 * @param lines - Task lines.
 * @param extras - Parts total, drive cost and the whole-job unsuccessful flag.
 * @param extras.part - One part's cost, or 0 for none.
 * @param extras.drive - The looked-up round trip's cost, or 0 for none.
 * @param extras.unsuccessful - Whether the whole job wasn't fixed.
 * @returns The job.
 */
function job(
  lines: LineSpec[],
  {
    part = 0,
    drive = 0,
    unsuccessful = false,
  }: { part?: number; drive?: number; unsuccessful?: boolean } = {},
): Job {
  return {
    durationMins: lines.reduce((s, l) => s + l.minutes, 0),
    unsuccessful,
    tasks: lines.map((l) => {
      const hourly = !l.flatRate && !l.flatFee;
      const qty = hourly ? l.minutes / 60 : 1;
      return {
        rateConfigId: l.flatRate ? "flat-row" : null,
        baseRateId: hourly ? "base" : null,
        modifierIds: l.business ? ["biz"] : [],
        description: "Task",
        qty,
        unitPrice: l.unitPrice,
        lineTotal: qty * l.unitPrice,
        ...(hourly && { minutes: l.minutes }),
        ...(l.unsuccessful && { unsuccessful: true }),
        ...(l.flatFee && { isFlatFee: true }),
      };
    }),
    parts: part > 0 ? [{ description: "Part", cost: part }] : [],
    travelEntries:
      drive > 0
        ? [
            {
              label: "Drive",
              cost: drive,
              isAuto: true,
              durationMinsOneWay: 20,
              durationMinsBack: 20,
            },
          ]
        : [],
    notes: "",
    clientName: "Test",
    clientEmail: "",
  };
}

/** No minimums, no GST, Standard $100/hr: the figures below are the plain maths. */
const BASE: JobPricing = {
  gstRegistered: false,
  minTravelCharge: 0,
  minBillableMins: 0,
  standardRate: 100,
  businessModifierId: "biz",
};

/**
 * Promo terms for the fixtures.
 * @param terms - The discount fields that differ from none.
 * @returns A promo with only those terms set.
 */
function terms(terms: Partial<JobPromo>): JobPromo {
  return { flatHourlyRate: null, percentDiscount: null, ...terms };
}

const FLAT_65 = terms({ discountType: "flat_hourly", flatHourlyRate: 65 });
const PCT_20 = terms({ discountType: "percent", percentDiscount: 0.2 });
const FIXED_32 = terms({ discountType: "fixed_amount", fixedAmount: 32 });
const FREE_TRAVEL = terms({ discountType: "free_travel", travelPercent: 0 });

/**
 * Prices a job and keeps the discount figures.
 * @param j - The job.
 * @param promo - The promo, or null.
 * @param pricing - Pricing over {@link BASE}.
 * @returns The promo, gold card and unsuccessful discounts and the total.
 */
function price(
  j: Job,
  promo: JobPromo | null,
  pricing: Partial<JobPricing>,
): { promo: number; gold: number; unsuccessful: number; total: number } {
  const t = calcJobTotal(j, promo, { ...BASE, ...pricing });
  return {
    promo: t.promoDiscount,
    gold: t.goldCardDiscount,
    unsuccessful: t.unsuccessfulDiscount,
    total: t.total,
  };
}

/**
 * The saved invoice's total: the job's lines less the three stored discounts, the way the
 * invoices route and PDF add it up.
 * @param j - The job.
 * @param promo - The promo, or null.
 * @param pricing - Pricing over {@link BASE}.
 * @returns The invoice total and the calculator's total, which must match.
 */
function invoiceVsCalculator(
  j: Job,
  promo: JobPromo | null,
  pricing: Partial<JobPricing>,
): { invoice: number; calculator: number } {
  const p = { ...BASE, ...pricing };
  const t = calcJobTotal(j, promo, p);
  const surcharge: LabourSurcharge | null = p.surchargeUplift
    ? { label: "Weekend surcharge", uplift: p.surchargeUplift }
    : null;
  const lines = jobToLineItems(j, surcharge, p.minTravelCharge, p.minBillableMins);
  const invoice = calcInvoiceTotals(
    lines,
    t.promoDiscount + t.goldCardDiscount + t.unsuccessfulDiscount,
    p.gstRegistered,
  ).total;
  return { invoice, calculator: t.total };
}

/**
 * A rate row for the lookup fixtures.
 * @param label - Row label.
 * @param percentDelta - Percent change, or null.
 * @param unit - Row unit.
 * @returns The row.
 */
function rate(label: string, percentDelta: number | null, unit = "modifier"): RateConfig {
  return {
    id: label,
    label,
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: null,
    percentDelta,
    unit,
    isDefault: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  } as RateConfig;
}

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  const twoHours = job([{ minutes: 120, unitPrice: 100 }], { part: 50, drive: 30 });

  console.log("10% off labour");
  expectEqual(
    "2h at $100 with $30 travel and a $50 part takes $20 off",
    price(twoHours, null, { goldCardPercent: 0.1 }),
    {
      promo: 0,
      gold: 20,
      unsuccessful: 0,
      total: 260,
    },
  );
  expectEqual(
    "a +25% weekend surcharge counts as labour",
    price(twoHours, null, { goldCardPercent: 0.1, surchargeUplift: 0.25 }),
    { promo: 0, gold: 25, unsuccessful: 0, total: 305 },
  );
  expectEqual(
    "flat-rate and flat-fee lines stay full price",
    price(
      job([
        { minutes: 60, unitPrice: 100 },
        { minutes: 0, unitPrice: 80, flatRate: true },
        { minutes: 0, unitPrice: 50, flatFee: true },
      ]),
      null,
      { goldCardPercent: 0.1 },
    ),
    { promo: 0, gold: 10, unsuccessful: 0, total: 220 },
  );
  expectEqual(
    "a job with no hourly labour has nothing to take off",
    price(job([{ minutes: 0, unitPrice: 80, flatRate: true }], { drive: 30 }), null, {
      goldCardPercent: 0.1,
    }).gold,
    0,
  );
  expectEqual(
    "rounds to the cent: 1h15m at $95 is $118.75, so $11.88 off",
    price(job([{ minutes: 75, unitPrice: 95 }]), null, { goldCardPercent: 0.1 }),
    { promo: 0, gold: 11.88, unsuccessful: 0, total: 106.87 },
  );

  console.log("\nStacks after the promo");
  expectEqual(
    "$65 locked rate then 10% off bills $58.50 for the hour",
    price(job([{ minutes: 60, unitPrice: 100 }]), FLAT_65, { goldCardPercent: 0.1 }),
    { promo: 35, gold: 6.5, unsuccessful: 0, total: 58.5 },
  );
  expectEqual(
    "4h20m at $65 flat ($281.67) then 10% off",
    price(job([{ minutes: 260, unitPrice: 100 }]), FLAT_65, { goldCardPercent: 0.1 }),
    { promo: 151.66, gold: 28.17, unsuccessful: 0, total: 253.5 },
  );
  expectEqual(
    "20% off then 10% off the rest",
    price(job([{ minutes: 120, unitPrice: 100 }]), PCT_20, { goldCardPercent: 0.1 }),
    { promo: 40, gold: 16, unsuccessful: 0, total: 144 },
  );
  expectEqual(
    "the promo skips the surcharge, the gold card doesn't",
    price(job([{ minutes: 120, unitPrice: 100 }]), PCT_20, {
      goldCardPercent: 0.1,
      surchargeUplift: 0.25,
    }),
    { promo: 40, gold: 21, unsuccessful: 0, total: 189 },
  );
  expectEqual(
    "$32 off then 10% off the rest",
    price(job([{ minutes: 120, unitPrice: 100 }]), FIXED_32, { goldCardPercent: 0.1 }),
    { promo: 32, gold: 16.8, unsuccessful: 0, total: 151.2 },
  );
  expectEqual(
    "free travel comes off travel, so the labour still gets the full 10%",
    price(job([{ minutes: 120, unitPrice: 100 }], { drive: 30 }), FREE_TRAVEL, {
      goldCardPercent: 0.1,
    }),
    { promo: 30, gold: 20, unsuccessful: 0, total: 180 },
  );

  console.log("\nBusiness work gets none");
  expectEqual(
    "a business-only job takes nothing off",
    price(job([{ minutes: 60, unitPrice: 140, business: true }]), null, { goldCardPercent: 0.1 }),
    { promo: 0, gold: 0, unsuccessful: 0, total: 140 },
  );
  const mixed = job([
    { minutes: 60, unitPrice: 100 },
    { minutes: 60, unitPrice: 140, business: true },
  ]);
  expectEqual("only the home hour comes down", price(mixed, null, { goldCardPercent: 0.1 }), {
    promo: 0,
    gold: 10,
    unsuccessful: 0,
    total: 230,
  });
  expectEqual(
    "only the home hour's share of a +25% surcharge comes down",
    price(mixed, null, { goldCardPercent: 0.1, surchargeUplift: 0.25 }),
    { promo: 0, gold: 12.5, unsuccessful: 0, total: 287.5 },
  );
  expectEqual(
    "$65 flat on the home hour, then 10% off it",
    price(mixed, FLAT_65, { goldCardPercent: 0.1 }),
    { promo: 35, gold: 6.5, unsuccessful: 0, total: 198.5 },
  );
  expectEqual(
    "an unfixed business hour is halved at full price",
    price(
      job([
        { minutes: 60, unitPrice: 100 },
        { minutes: 60, unitPrice: 140, business: true, unsuccessful: true },
      ]),
      null,
      { goldCardPercent: 0.1, unsuccessfulFactor: 0.5 },
    ),
    { promo: 0, gold: 10, unsuccessful: 70, total: 160 },
  );
  expectEqual(
    "an unfixed home hour is halved after the 10%",
    price(
      job([
        { minutes: 60, unitPrice: 100, unsuccessful: true },
        { minutes: 60, unitPrice: 140, business: true },
      ]),
      null,
      { goldCardPercent: 0.1, unsuccessfulFactor: 0.5 },
    ),
    { promo: 0, gold: 10, unsuccessful: 45, total: 185 },
  );

  console.log("\nBefore an unsuccessful visit is halved");
  expectEqual(
    "1h not fixed: 10% off, then half of the $90",
    price(job([{ minutes: 60, unitPrice: 100 }], { unsuccessful: true }), null, {
      goldCardPercent: 0.1,
      unsuccessfulFactor: 0.5,
    }),
    { promo: 0, gold: 10, unsuccessful: 45, total: 45 },
  );
  expectEqual(
    "$65 flat, 10% off, then half: $29.25",
    price(job([{ minutes: 60, unitPrice: 100 }], { unsuccessful: true }), FLAT_65, {
      goldCardPercent: 0.1,
      unsuccessfulFactor: 0.5,
    }),
    { promo: 35, gold: 6.5, unsuccessful: 29.25, total: 29.25 },
  );
  expectEqual(
    "only the unfixed task is halved",
    price(
      job([
        { minutes: 60, unitPrice: 100 },
        { minutes: 60, unitPrice: 100, unsuccessful: true },
      ]),
      null,
      { goldCardPercent: 0.1, unsuccessfulFactor: 0.5 },
    ),
    { promo: 0, gold: 20, unsuccessful: 45, total: 135 },
  );
  expectEqual(
    "a +25% day's surcharge on the unfixed hour is halved after the 10% too",
    price(job([{ minutes: 60, unitPrice: 100 }], { unsuccessful: true }), null, {
      goldCardPercent: 0.1,
      unsuccessfulFactor: 0.5,
      surchargeUplift: 0.25,
    }),
    { promo: 0, gold: 12.5, unsuccessful: 56.25, total: 56.25 },
  );

  console.log("\nGST and limits");
  expectEqual(
    "GST is on the total after the 10%",
    calcJobTotal(twoHours, null, { ...BASE, gstRegistered: true, goldCardPercent: 0.1 }).gstAmount,
    33.91,
  );
  expectEqual(
    "a percent over 100 stops at free labour",
    price(job([{ minutes: 60, unitPrice: 100 }], { drive: 30 }), null, { goldCardPercent: 1.5 }),
    { promo: 0, gold: 100, unsuccessful: 0, total: 30 },
  );
  expectEqual(
    "a negative percent takes nothing off",
    price(job([{ minutes: 60, unitPrice: 100 }]), null, { goldCardPercent: -0.1 }).gold,
    0,
  );

  console.log("\nTicked off changes nothing");
  const cases: [string, Job, JobPromo | null, Partial<JobPricing>][] = [
    ["plain", twoHours, null, {}],
    [
      "flat promo, surcharge, GST",
      job([{ minutes: 260, unitPrice: 100 }], { drive: 30 }),
      FLAT_65,
      { surchargeUplift: 0.25, gstRegistered: true },
    ],
    [
      "unfixed task with a fixed promo",
      job([
        { minutes: 60, unitPrice: 100 },
        { minutes: 45, unitPrice: 95, unsuccessful: true },
      ]),
      FIXED_32,
      { unsuccessfulFactor: 0.5 },
    ],
    ["free travel", job([{ minutes: 90, unitPrice: 100 }], { drive: 30 }), FREE_TRAVEL, {}],
  ];
  for (const [label, j, promo, pricing] of cases) {
    const before = calcJobTotal(j, promo, { ...BASE, ...pricing });
    const off = calcJobTotal(j, promo, { ...BASE, ...pricing, goldCardPercent: 0 });
    expectEqual(`${label}: same figures with the box unticked`, off, before);
    expectEqual(`${label}: no gold card line`, before.goldCardDiscount, 0);
  }

  console.log("\nThe saved invoice adds up to the calculator's total");
  const consistency: [string, Job, JobPromo | null, Partial<JobPricing>][] = [
    ["plain", twoHours, null, { goldCardPercent: 0.1 }],
    [
      "surcharge and GST",
      twoHours,
      null,
      { goldCardPercent: 0.1, surchargeUplift: 0.25, gstRegistered: true },
    ],
    [
      "4h20m flat promo",
      job([{ minutes: 260, unitPrice: 100 }], { drive: 30 }),
      FLAT_65,
      { goldCardPercent: 0.1 },
    ],
    [
      "1h15m at $95, 20% off",
      job([{ minutes: 75, unitPrice: 95 }]),
      PCT_20,
      { goldCardPercent: 0.1 },
    ],
    [
      "free travel",
      job([{ minutes: 90, unitPrice: 100 }], { drive: 30 }),
      FREE_TRAVEL,
      { goldCardPercent: 0.1 },
    ],
    [
      "unfixed task, fixed promo, weekend",
      job([
        { minutes: 60, unitPrice: 100 },
        { minutes: 45, unitPrice: 95, unsuccessful: true },
      ]),
      FIXED_32,
      { goldCardPercent: 0.1, unsuccessfulFactor: 0.5, surchargeUplift: 0.1 },
    ],
    [
      "home and business work, weekend, flat promo, unfixed business line",
      job([
        { minutes: 75, unitPrice: 95 },
        { minutes: 50, unitPrice: 135, business: true, unsuccessful: true },
      ]),
      FLAT_65,
      { goldCardPercent: 0.1, unsuccessfulFactor: 0.5, surchargeUplift: 0.1 },
    ],
    [
      "whole job unfixed",
      job([{ minutes: 100, unitPrice: 85 }], { drive: 24.5, unsuccessful: true }),
      FLAT_65,
      { goldCardPercent: 0.15, unsuccessfulFactor: 0.5 },
    ],
  ];
  for (const [label, j, promo, pricing] of consistency) {
    const { invoice, calculator } = invoiceVsCalculator(j, promo, pricing);
    expectEqual(`${label}: $${calculator}`, invoice, calculator);
  }

  console.log("\nThe rate in Settings > Rates");
  expectEqual(
    "-10% reads as 10% off",
    goldCardPercent([rate("Standard", null, "hour"), rate("Gold Card", -0.1)]),
    0.1,
  );
  expectEqual("+10% reads as 10% off too", goldCardPercent([rate("Gold Card", 0.1)]), 0.1);
  expectEqual("case and spaces don't matter", goldCardPercent([rate("  gold card ", -0.15)]), 0.15);
  expectEqual("no row hides the box", goldCardPercent([rate("Standard", null, "hour")]), null);
  expectEqual("a renamed row hides the box", goldCardPercent([rate("SuperGold", -0.1)]), null);
  expectEqual(
    "a row with no percent hides the box",
    goldCardPercent([rate("Gold Card", null)]),
    null,
  );
  expectEqual("0% hides the box", goldCardPercent([rate("Gold Card", 0)]), null);
  expectEqual(
    "an hourly row isn't the modifier",
    goldCardPercent([rate("Gold Card", -0.1, "hour")]),
    null,
  );
  expectEqual("over 100% stops at 100%", goldCardPercent([rate("Gold Card", -1.5)]), 1);

  console.log("\nInvoice line wording");
  expectEqual("with the percent", goldCardLineLabel(0.1), "Gold Card discount (10% off labour)");
  expectEqual(
    "a part percent keeps one decimal",
    goldCardLineLabel(0.125),
    "Gold Card discount (12.5% off labour)",
  );
  expectEqual("without the percent", goldCardLineLabel(null), "Gold Card discount (labour only)");

  finish();
}

main();
