// scripts/check-job-totals.ts
// Calculator totals against the saved invoice on edge inputs: minimum-padding ties, negative
// and sub-cent entries, a flat promo on a stale base, and when the promo note may print.
// Run with: npm test -- job-totals

import {
  calcInvoiceTotals,
  calcJobTotal,
  jobToLineItems,
  withSplitLineTotals,
  type JobPricing,
  type JobPromo,
  type LabourSurcharge,
} from "@/features/business/lib/business";
import { toggleTaskModifierLine } from "@/features/business/lib/calculator-helpers";
import type {
  PartLine,
  RateConfig,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import { expectEqual, finish } from "./lib/harness.js";

type Job = Parameters<typeof calcJobTotal>[0];

/**
 * Builds a rate row with the unused columns nulled.
 * @param row - The columns that matter for the case.
 * @returns The rate row.
 */
function rate(row: Partial<RateConfig> & { id: string; label: string }): RateConfig {
  return {
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: null,
    percentDelta: null,
    unit: "modifier",
    isDefault: false,
    createdAt: "",
    ...row,
  };
}

// The live rate rows, as of 2026-10-26.
const RATES: RateConfig[] = [
  rate({ id: "std", label: "Standard", ratePerHour: 100, unit: "hour", isDefault: true }),
  rate({ id: "home", label: "At home", hourlyDelta: -30 }),
  rate({ id: "remote", label: "Remote", hourlyDelta: -10 }),
  rate({ id: "phone", label: "Phone", hourlyDelta: -35 }),
  rate({ id: "biz", label: "Business", hourlyDelta: 40 }),
];

// "Current rates locked in": $65 flat with the modifier gaps from when it was made.
const LOCKED: JobPromo = {
  discountType: "flat_hourly",
  flatHourlyRate: 65,
  percentDiscount: null,
  fixedAmount: null,
  travelPercent: null,
  minSpend: null,
  tiers: [],
  lockedDeltas: [
    { label: "At home", hourlyDelta: -15 },
    { label: "Remote", hourlyDelta: -10 },
    { label: "Phone", hourlyDelta: -25 },
    { label: "Business", hourlyDelta: 20 },
  ],
};

const PERCENT_12_5: JobPromo = {
  ...LOCKED,
  discountType: "percent",
  flatHourlyRate: null,
  percentDiscount: 0.125,
  lockedDeltas: undefined,
};

const WEEKEND: LabourSurcharge = { label: "Weekend surcharge", uplift: 0.1 };

/**
 * Builds an hourly task line the way the calculator does after a typed time.
 * @param minutes - Billed minutes.
 * @param unitPrice - The line's $/hr.
 * @param opts - Base rate, modifiers and the "Didn't finish" flag.
 * @param opts.base - Base rate id, or null for a "No base" row.
 * @param opts.mods - Modifier ids.
 * @param opts.unsuccessful - Whether the line wasn't finished.
 * @returns The task line.
 */
function task(
  minutes: number,
  unitPrice: number,
  {
    base = "std",
    mods = [],
    unsuccessful = false,
  }: { base?: string | null; mods?: string[]; unsuccessful?: boolean } = {},
): TaskLine {
  const qty = minutes / 60;
  return {
    rateConfigId: null,
    baseRateId: base,
    modifierIds: mods,
    description: `${minutes} min`,
    qty,
    minutes,
    unitPrice,
    lineTotal: Math.round(qty * unitPrice * 100) / 100,
    isExplicit: true,
    unsuccessful,
  };
}

/**
 * Builds a job shaped like the calculator's.
 * @param tasks - Task lines.
 * @param parts - Parts lines.
 * @param travelEntries - Travel entries.
 * @returns The job.
 */
function job(tasks: TaskLine[], parts: PartLine[] = [], travelEntries: TravelEntry[] = []): Job {
  return {
    durationMins: 0,
    tasks,
    parts,
    travelEntries,
    notes: "",
    clientName: "",
    clientEmail: "",
  };
}

/** A job priced both ways. */
interface Priced {
  calc: ReturnType<typeof calcJobTotal>;
  invoice: { subtotal: number; total: number };
}

/**
 * Prices a job on the calculator path and on the saved-invoice path.
 * @param j - The job.
 * @param opts - Promo, surcharge and Standard rate overrides.
 * @param opts.promo - Active promo, or null.
 * @param opts.surcharge - Date surcharge, or null.
 * @param opts.standardRate - Standard $/hr, or null when there's no Standard row.
 * @returns The calculator totals plus the invoice's subtotal and total.
 */
function price(
  j: Job,
  {
    promo = null,
    surcharge = null,
    standardRate = 100,
  }: {
    promo?: JobPromo | null;
    surcharge?: LabourSurcharge | null;
    standardRate?: number | null;
  } = {},
): Priced {
  const pricing: JobPricing = {
    gstRegistered: false,
    minTravelCharge: 10,
    minBillableMins: 15,
    surchargeUplift: surcharge?.uplift ?? 0,
    unsuccessfulFactor: 0.5,
    businessModifierId: "biz",
    standardRate,
    rates: RATES,
    goldCardPercent: 0,
  };
  const calc = calcJobTotal(j, promo, pricing);
  const lines = withSplitLineTotals(jobToLineItems(j, surcharge, 10, 15));
  const discounts = calc.promoDiscount + calc.goldCardDiscount + calc.unsuccessfulDiscount;
  const invoice = calcInvoiceTotals(lines, discounts, false);
  return { calc, invoice: { subtotal: invoice.subtotal, total: invoice.total } };
}

/**
 * Totals of a job and of the same job with its tasks reversed.
 * @param tasks - Task lines, in the order typed.
 * @returns Both totals, which must match.
 */
function bothOrders(tasks: TaskLine[]): number[] {
  return [price(job(tasks)).calc.total, price(job([...tasks].reverse())).calc.total];
}

/** Runs every fixture group and exits non-zero on any failure. */
function main(): void {
  console.log("Minimum padding ignores task order:");
  expectEqual(
    "Std 5m + At home 5m pads the cheaper line",
    bothOrders([task(5, 100), task(5, 70, { mods: ["home"] })]),
    [20, 20],
  );
  expectEqual(
    "Remote 5m + Phone 5m pads Phone",
    bothOrders([task(5, 90, { mods: ["remote"] }), task(5, 65, { mods: ["phone"] })]),
    [18.33, 18.33],
  );
  expectEqual(
    "a finished line takes the padding over an unfinished one",
    bothOrders([
      task(5, 70, { mods: ["home"], unsuccessful: true }),
      task(5, 70, { mods: ["home"] }),
    ]),
    [14.58, 14.58],
  );
  const percent20: JobPromo = { ...PERCENT_12_5, percentDiscount: 0.2 };
  const bizAndHome = [task(5, 110, { mods: ["biz", "home"] }), task(5, 110, { mods: ["remote"] })];
  expectEqual(
    "a Business and a home line at one price pad the same line either way",
    [bizAndHome, [...bizAndHome].reverse()].map(
      (tasks) => price(job(tasks), { promo: percent20 }).calc.promoDiscount,
    ),
    [1.83, 1.83],
  );

  console.log("\nNegative and sub-cent entries:");
  const negTravel = price(job([task(60, 100)], [], [{ label: "Waive", cost: -20 }]));
  expectEqual(
    "a negative travel entry counts as $0 on both paths",
    [negTravel.calc.total, negTravel.invoice.total],
    [100, 100],
  );
  const negLabour = price(
    job([task(60, 100), task(60, -150, { base: null })], [{ description: "Part", cost: 200 }]),
    { surcharge: WEEKEND },
  );
  expectEqual(
    "labour netting below $0 takes no surcharge on either path",
    [negLabour.calc.surchargeTotal, negLabour.calc.subtotal, negLabour.invoice.subtotal],
    [0, 150, 150],
  );
  const subCent = price(
    job(
      [task(60, 100)],
      [0.335, 0.335, 0.335].map((cost) => ({ description: "Cable", cost })),
    ),
  );
  expectEqual(
    "sub-cent parts round per part on both paths",
    [subCent.calc.subtotal, subCent.invoice.subtotal],
    [101.02, 101.02],
  );

  console.log("\nFlat promo:");
  expectEqual(
    "an At home line on a deleted base still bills the locked $50",
    price(job([task(120, 70, { base: "old-std", mods: ["home"] })]), { promo: LOCKED }).calc
      .promoDiscount,
    40,
  );
  expectEqual(
    "a Phone line on a deleted base bills the locked $40",
    price(job([task(60, 65, { base: "old-std", mods: ["phone"] })]), { promo: LOCKED }).calc
      .promoDiscount,
    25,
  );
  expectEqual(
    "with no Standard row an At home line still bills $50",
    price(job([task(120, 70, { mods: ["home"] })]), { promo: LOCKED, standardRate: null }).calc
      .promoDiscount,
    40,
  );
  const sharedRate = price(job([task(35, 65, { base: null }), task(35, 100)]), { promo: LOCKED });
  expectEqual(
    "an untouched $65 row doesn't shift a cent into the promo",
    [sharedRate.calc.promoDiscount, sharedRate.calc.total, sharedRate.invoice.total],
    [20.41, 75.84, 75.84],
  );

  console.log("\nPromo note:");
  expectEqual(
    "the note's pair reproduces the billed amount",
    price(job([task(35, 65, { base: null }), task(35, 100)]), { promo: LOCKED }).calc.promoRate,
    { mins: 35, before: 100, after: 65 },
  );
  expectEqual(
    "12.5% off $65 ($56.875/hr) prints no note",
    price(job([task(790, 65, { mods: ["phone"] })]), { promo: PERCENT_12_5 }).calc.promoRate,
    null,
  );

  console.log("\nModifier chips:");
  const typed = [{ ...task(60, 80, { base: null }), priceOverridden: true }];
  const toggled = toggleTaskModifierLine(typed, 0, "home", RATES)[0]!;
  expectEqual(
    "a chip on a No base row keeps the typed $/hr",
    [toggled.unitPrice, toggled.lineTotal, toggled.modifierIds],
    [80, 80, ["home"]],
  );
  const based = toggleTaskModifierLine([task(60, 100)], 0, "home", RATES)[0]!;
  expectEqual(
    "a chip on a based row still re-prices it",
    [based.unitPrice, based.lineTotal],
    [70, 70],
  );

  finish();
}

main();
