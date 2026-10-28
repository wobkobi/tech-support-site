// scripts/check-job-totals-fuzz.ts
// Property check over thousands of seeded random jobs: the saved invoice re-totals to the
// calculator's figures, task order never moves a cent, and every amount is whole cents.
// Run with: npm test -- job-totals-fuzz

import {
  calcInvoiceTotals,
  calcJobTotal,
  jobToLineItems,
  withSplitLineTotals,
  type JobPricing,
  type JobPromo,
  type LabourSurcharge,
} from "@/features/business/lib/business";
import { GST_RATE } from "@/features/business/lib/pricing-policy";
import type {
  PartLine,
  RateConfig,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import { expect, finish } from "./lib/harness.js";

const JOBS = 20000;

/**
 * Seeded PRNG (mulberry32), so a failure reproduces from its job number.
 * @param seed - Starting state.
 * @returns A function giving the next float in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261026);

/**
 * Picks one item at random.
 * @param items - Choices.
 * @returns One of them.
 */
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

/**
 * Random whole number in a range.
 * @param lo - Lowest value.
 * @param hi - Highest value, inclusive.
 * @returns The number.
 */
function int(lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

/**
 * Builds a rate row with the unused columns nulled.
 * @param row - The columns that matter.
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

const RATES: RateConfig[] = [
  rate({ id: "std", label: "Standard", ratePerHour: 100, unit: "hour", isDefault: true }),
  rate({ id: "home", label: "At home", hourlyDelta: -30 }),
  rate({ id: "remote", label: "Remote", hourlyDelta: -10 }),
  rate({ id: "phone", label: "Phone", hourlyDelta: -35 }),
  rate({ id: "biz", label: "Business", hourlyDelta: 40 }),
];
const DELTA = new Map(RATES.map((r) => [r.id, r.hourlyDelta ?? 0]));

const BASE_PROMO: JobPromo = {
  discountType: null,
  flatHourlyRate: null,
  percentDiscount: null,
  fixedAmount: null,
  travelPercent: null,
  minSpend: null,
  tiers: [],
};

/**
 * Fractions the reference maths below works in exactly, as [numerator, denominator], so it
 * never shares the float rounding it is checking.
 */
const EXACT = new Map<number, [number, number]>([
  [0.1, [1, 10]],
  [0.125, [1, 8]],
  [0.2, [1, 5]],
  [0.25, [1, 4]],
  [1 / 3, [1, 3]],
]);

/**
 * A share of a whole-cent amount in integer maths, an exact half cent rounding up as it would
 * by hand.
 * @param cents - Amount in whole cents, not negative.
 * @param fraction - Share as a decimal; must be a key of {@link EXACT}.
 * @returns The share in whole cents.
 */
function shareCents(cents: number, fraction: number): number {
  const [num, den] = EXACT.get(fraction)!;
  return Math.floor((2 * cents * num + den) / (2 * den));
}

const PROMOS: (JobPromo | null)[] = [
  null,
  {
    ...BASE_PROMO,
    discountType: "flat_hourly",
    flatHourlyRate: 65,
    lockedDeltas: [
      { label: "At home", hourlyDelta: -15 },
      { label: "Remote", hourlyDelta: -10 },
      { label: "Phone", hourlyDelta: -25 },
      { label: "Business", hourlyDelta: 20 },
    ],
  },
  { ...BASE_PROMO, discountType: "flat_hourly", flatHourlyRate: 72.5 },
  { ...BASE_PROMO, discountType: "percent", percentDiscount: 0.125 },
  { ...BASE_PROMO, discountType: "percent", percentDiscount: 0.2, minSpend: 150 },
  { ...BASE_PROMO, discountType: "percent", percentDiscount: 1 / 3 },
  { ...BASE_PROMO, discountType: "fixed_amount", fixedAmount: 25 },
  { ...BASE_PROMO, discountType: "fixed_amount", fixedAmount: 33.33 },
  { ...BASE_PROMO, discountType: "free_travel", travelPercent: 0 },
  { ...BASE_PROMO, discountType: "free_travel", travelPercent: 0.5 },
  {
    ...BASE_PROMO,
    discountType: "percent",
    tiers: [
      {
        minSpend: 100,
        flatHourlyRate: null,
        percentDiscount: 0.1,
        fixedAmount: null,
        travelPercent: null,
      },
      {
        minSpend: 250,
        flatHourlyRate: null,
        percentDiscount: 0.15,
        fixedAmount: null,
        travelPercent: null,
      },
    ],
  },
];

const SURCHARGES: (LabourSurcharge | null)[] = [
  null,
  { label: "Weekend surcharge", perHour: 10 },
  { label: "Public holiday surcharge", perHour: 25 },
  { label: "After-hours surcharge", perHour: 12.5 },
];

const MINUTES = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 120, 150, 180, 245,
];

/**
 * A random task line shaped like the calculator's: a rated hourly row, a "No base" row with
 * a typed rate, or a flat fee.
 * @returns The task line.
 */
function randomTask(): TaskLine {
  const kind = rand();
  if (kind < 0.08) {
    const price = pick([49, 75, 120.5]);
    return {
      rateConfigId: null,
      baseRateId: null,
      description: "Flat fee",
      qty: 1,
      unitPrice: price,
      lineTotal: price,
      isFlatFee: true,
    };
  }
  const minutes = pick(MINUTES);
  const qty = minutes / 60;
  const unsuccessful = rand() < 0.15;
  // Typed rates include 110 and 140, which share a price (and a cent split) with rated rows.
  if (kind < 0.25) {
    const unitPrice = pick([85, 47.5, 33.33, 65, 110, 140, 112.75]);
    return {
      rateConfigId: null,
      baseRateId: null,
      modifierIds: [],
      description: pick(["Setup", "Typed rate"]),
      qty,
      minutes,
      unitPrice,
      lineTotal: Math.round(qty * unitPrice * 100) / 100,
      unsuccessful,
      priceOverridden: true,
    };
  }
  const channel = pick([[], ["home"], ["remote"], ["phone"]]);
  const mods = rand() < 0.2 ? [...channel, "biz"] : channel;
  const unitPrice = 100 + mods.reduce((s, id) => s + (DELTA.get(id) ?? 0), 0);
  return {
    rateConfigId: null,
    baseRateId: "std",
    modifierIds: mods,
    description: pick(["Setup", "Setup", "Backup"]),
    qty,
    minutes,
    unitPrice,
    lineTotal: Math.round(qty * unitPrice * 100) / 100,
    unsuccessful,
  };
}

/**
 * Random travel: a looked-up trip (sometimes under the minimum), parking, a store run.
 * @returns The travel entries.
 */
function randomTravel(): TravelEntry[] {
  const entries: TravelEntry[] = [];
  if (rand() < 0.6) {
    const there = int(3, 45);
    const back = int(3, 45);
    entries.push({
      label: "Trip",
      cost: Math.round(((there + back) / 60) * 40 * 100) / 100,
      isAuto: true,
      durationMinsOneWay: there,
      durationMinsBack: back,
    });
  }
  if (rand() < 0.15) entries.push({ label: "Parking", cost: pick([4.5, 7.2, 12]) });
  if (rand() < 0.15) {
    entries.push({ label: "Store", kind: "storeRun", cost: pick([8.67, 15, 21.33]) });
  }
  return entries;
}

/**
 * Random parts, some with sub-cent costs.
 * @returns The parts.
 */
function randomParts(): PartLine[] {
  const count = rand() < 0.6 ? 0 : int(1, 3);
  return Array.from({ length: count }, () => ({
    description: "Part",
    cost: pick([25, 9.99, 0.335, 149.5, 3.333]),
  }));
}

/**
 * The array shuffled (Fisher-Yates) with the seeded PRNG.
 * @param items - Items to shuffle.
 * @returns A shuffled copy.
 */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Whether a dollar figure is a whole number of cents.
 * @param n - Dollar amount.
 * @returns True when it has no fraction of a cent.
 */
function wholeCents(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

/**
 * Whether two dollar figures are the same number of cents.
 * @param a - First amount.
 * @param b - Second amount.
 * @returns True when they match to the cent.
 */
function sameCents(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

const MONEY_FIELDS = [
  "tasksTotal",
  "partsTotal",
  "travelTotal",
  "surchargeTotal",
  "subtotal",
  "promoDiscount",
  "goldCardDiscount",
  "unsuccessfulDiscount",
  "gstAmount",
  "total",
] as const;

/** Runs every property over the seeded jobs and exits non-zero on any failure. */
function main(): void {
  const firstFailure = new Map<string, string>();
  /**
   * Records the first counter-example for a property.
   * @param property - Property name.
   * @param ok - Whether it held for this job.
   * @param detail - What to print when it didn't.
   */
  const check = (property: string, ok: boolean, detail: () => string): void => {
    if (!firstFailure.has(property)) firstFailure.set(property, "");
    if (!ok && firstFailure.get(property) === "") firstFailure.set(property, detail());
  };

  for (let n = 0; n < JOBS; n++) {
    const tasks = Array.from({ length: int(1, 6) }, randomTask);
    const job = {
      durationMins: 0,
      tasks,
      parts: randomParts(),
      travelEntries: randomTravel(),
      notes: "",
      clientName: "",
      clientEmail: "",
      unsuccessful: rand() < 0.05,
    };
    const promo = pick(PROMOS);
    const surcharge = pick(SURCHARGES);
    const pricing: JobPricing = {
      gstRegistered: rand() < 0.5,
      minTravelCharge: 10,
      minBillableMins: 15,
      surchargePerHour: surcharge?.perHour ?? 0,
      unsuccessfulFactor: 0.5,
      businessModifierId: "biz",
      standardRate: 100,
      rates: RATES,
      goldCardPercent: rand() < 0.2 ? 0.1 : 0,
    };
    const calc = calcJobTotal(job, promo, pricing);
    const label = `job ${n} (promo ${JSON.stringify(promo)}, surcharge ${surcharge?.perHour ?? 0}, gold ${pricing.goldCardPercent}, tasks ${JSON.stringify(tasks.map((t) => [t.minutes ?? "flat", t.unitPrice, t.modifierIds, !!t.unsuccessful]))}, parts ${JSON.stringify(job.parts.map((p) => p.cost))}, travel ${JSON.stringify(job.travelEntries.map((e) => e.cost))}, job unsuccessful ${job.unsuccessful})`;

    // The saved invoice: its lines, re-totalled with the discounts the save sends.
    const lines = withSplitLineTotals(
      jobToLineItems(job, surcharge, pricing.minTravelCharge, pricing.minBillableMins),
    );
    const discounts = calc.promoDiscount + calc.goldCardDiscount + calc.unsuccessfulDiscount;
    const invoice = calcInvoiceTotals(lines, discounts, pricing.gstRegistered);
    check(
      "the saved invoice re-totals to the calculator's subtotal, GST and total",
      sameCents(invoice.subtotal, calc.subtotal) &&
        sameCents(invoice.total, calc.total) &&
        sameCents(invoice.gstAmount, calc.gstAmount),
      () =>
        `${label}\n        calc ${calc.subtotal}/${calc.gstAmount}/${calc.total}, invoice ${invoice.subtotal}/${invoice.gstAmount}/${invoice.total}`,
    );
    check(
      "the invoice's line totals add up to its subtotal",
      sameCents(
        lines.reduce((s, l) => s + l.lineTotal, 0),
        invoice.subtotal,
      ) && lines.every((l) => wholeCents(l.lineTotal)),
      () => `${label}\n        lines ${JSON.stringify(lines.map((l) => l.lineTotal))}`,
    );
    check(
      "every figure is a whole number of cents",
      MONEY_FIELDS.every((f) => wholeCents(calc[f])),
      () =>
        `${label}\n        ${JSON.stringify(Object.fromEntries(MONEY_FIELDS.map((f) => [f, calc[f]])))}`,
    );
    check(
      "the subtotal is its parts and the total is the subtotal less every discount",
      sameCents(
        calc.subtotal,
        calc.tasksTotal + calc.partsTotal + calc.travelTotal + calc.surchargeTotal,
      ) &&
        sameCents(
          calc.total,
          Math.max(
            0,
            calc.subtotal - calc.promoDiscount - calc.goldCardDiscount - calc.unsuccessfulDiscount,
          ),
        ),
      () => `${label}\n        ${JSON.stringify(calc)}`,
    );
    check(
      "no discount is negative and the total never goes below $0 or above the subtotal",
      calc.promoDiscount >= 0 &&
        calc.goldCardDiscount >= 0 &&
        calc.unsuccessfulDiscount >= 0 &&
        calc.total >= 0 &&
        calc.total <= calc.subtotal + 1e-9,
      () => `${label}\n        ${JSON.stringify(calc)}`,
    );
    check(
      "GST is 3/23 of the total, to the cent",
      !pricing.gstRegistered ||
        sameCents(
          calc.gstAmount,
          Math.round(((calc.total * GST_RATE) / (1 + GST_RATE)) * 100) / 100,
        ),
      () => `${label}\n        total ${calc.total}, gst ${calc.gstAmount}`,
    );

    // Reference maths in integer cents off the printed lines. The first tasks.length lines
    // are the tasks in order; a line with minutes is hourly labour.
    const taskLines = lines.slice(0, tasks.length);
    /**
     * Whole cents of the hourly task lines a filter keeps.
     * @param keep - Whether to count the task at this index.
     * @returns The cents.
     */
    const labourCents = (keep: (i: number) => boolean): number =>
      taskLines.reduce(
        (s, l, i) => (l.minutes != null && keep(i) ? s + Math.round(l.lineTotal * 100) : s),
        0,
      );
    /**
     * Whether the task at an index is business labour.
     * @param i - Task index.
     * @returns True when it carries the Business modifier.
     */
    const isBiz = (i: number): boolean => (tasks[i]!.modifierIds ?? []).includes("biz");
    // The flat $/hr rides on every paid hourly line's billed minutes; credit and free lines skip it.
    const paidMins = taskLines.reduce(
      (s, l) => (l.minutes != null && l.lineTotal > 0 ? s + l.minutes : s),
      0,
    );
    const surchargeCents = surcharge
      ? Math.floor((2 * paidMins * Math.round(surcharge.perHour * 100) + 60) / 120)
      : 0;
    check(
      "the surcharge is its $/hr on the paid labour minutes, an exact half cent rounding up",
      Math.round(calc.surchargeTotal * 100) === surchargeCents,
      () => `${label}\n        surcharge ${calc.surchargeTotal}, expected ${surchargeCents / 100}`,
    );
    const plainPercent =
      promo?.discountType === "percent" && !promo.tiers?.length ? promo.percentDiscount : null;
    if (plainPercent != null) {
      const reached = promo!.minSpend == null || calc.subtotal >= promo!.minSpend;
      const promoCents = reached
        ? shareCents(
            labourCents((i) => !isBiz(i)),
            plainPercent,
          )
        : 0;
      check(
        "a percent promo is its share of the home labour lines, to the cent",
        Math.round(calc.promoDiscount * 100) === promoCents,
        () => `${label}\n        promo ${calc.promoDiscount}, expected ${promoCents / 100}`,
      );
    }
    const anyBizLabour = taskLines.some((l, i) => l.minutes != null && isBiz(i));
    if (pricing.goldCardPercent && !anyBizLabour) {
      const labourPromo = promo?.discountType === "free_travel" ? 0 : calc.promoDiscount;
      const base = labourCents(() => true) + surchargeCents - Math.round(labourPromo * 100);
      const goldCents = Math.max(0, shareCents(base, pricing.goldCardPercent));
      check(
        "the Gold Card is 10% of what home labour costs after the promo, to the cent",
        Math.round(calc.goldCardDiscount * 100) === goldCents,
        () => `${label}\n        gold ${calc.goldCardDiscount}, expected ${goldCents / 100}`,
      );
    }

    // Task order is how the operator typed them; it must never move a cent.
    for (let k = 0; k < 2; k++) {
      const reordered = calcJobTotal({ ...job, tasks: shuffled(tasks) }, promo, pricing);
      const moved = MONEY_FIELDS.filter((f) => !sameCents(reordered[f], calc[f]));
      check(
        "task order never changes any figure",
        moved.length === 0,
        () =>
          `${label}\n        ${moved.map((f) => `${f} ${calc[f]} vs ${reordered[f]}`).join(", ")}`,
      );
    }
  }

  for (const [property, failure] of firstFailure) {
    expect(`${property} (${JOBS} jobs)`, failure === "", failure);
  }
  finish();
}

main();
