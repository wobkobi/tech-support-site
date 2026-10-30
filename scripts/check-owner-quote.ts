// scripts/check-owner-quote.ts
// The owner email's price breakdown: AI tasks priced through calcJobTotal, shown at the promo
// rate when the promo bills one, with the date surcharge, travel and a total. The shown lines
// must always add up to the total, which must match what the calculator would bill.
// Run with: npm test -- owner-quote

import { priceOwnerQuote, type OwnerQuoteBreakdown } from "@/features/booking/lib/owner-quote";
import type { DateSurcharge } from "@/features/business/lib/pricing-policy";
import type { ActivePromo } from "@/features/business/lib/promos";
import type { RateConfig } from "@/features/business/types/business";
import { roundCents } from "@/shared/lib/money";
import { expect, expectEqual, finish } from "./lib/harness.js";

/**
 * Builds a rate row.
 * @param id - Row id.
 * @param label - Row label.
 * @param ratePerHour - Base $/hr, or null for a modifier.
 * @param hourlyDelta - Modifier $/hr delta, or null for a base.
 * @returns The row.
 */
function rate(
  id: string,
  label: string,
  ratePerHour: number | null,
  hourlyDelta: number | null,
): RateConfig {
  return {
    id,
    label,
    ratePerHour,
    flatRate: null,
    hourlyDelta,
    percentDelta: null,
    unit: ratePerHour !== null ? "hour" : "modifier",
    isDefault: id === "standard",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const RATES = [
  rate("standard", "Standard", 100, null),
  rate("home", "At home", null, -30),
  rate("remote", "Remote", null, -25),
  rate("business", "Business", null, 40),
];

/**
 * Builds a promo of one discount type, live with no limits.
 * @param type - Discount type.
 * @param value - The flat $/hr, the percent off (0.1 = 10%), or the fixed dollars.
 * @returns The promo.
 */
function promo(type: "flat_hourly" | "percent" | "fixed_amount", value: number): ActivePromo {
  return {
    id: "promo",
    title: "Current rates locked in",
    description: null,
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2027-01-01T00:00:00.000Z",
    kind: "automatic",
    code: null,
    discountType: type,
    flatHourlyRate: type === "flat_hourly" ? value : null,
    percentDiscount: type === "percent" ? value : null,
    fixedAmount: type === "fixed_amount" ? value : null,
    travelPercent: null,
    minSpend: null,
    tiers: [],
    activeWeekdays: [],
    activeFromMinute: null,
    activeToMinute: null,
  };
}

const AFTER_HOURS: DateSurcharge = {
  reason: "After hours",
  label: "After hours surcharge",
  perHour: 10,
};
const WEEKEND: DateSurcharge = { reason: "Weekend", label: "Weekend surcharge", perHour: 10 };
const PRICING = { minBillableMins: 30, minTravelCharge: 10, gstRegistered: false };
const TASKS = [
  { label: "Modem setup", mins: 45 },
  { label: "Family apps and controls setup", mins: 25 },
];

/**
 * Prices a case with sensible defaults.
 * @param overrides - Inputs that differ from an in-person, no-promo, no-surcharge job.
 * @returns The breakdown, asserted non-null.
 */
function price(overrides: Partial<Parameters<typeof priceOwnerQuote>[0]>): OwnerQuoteBreakdown {
  const b = priceOwnerQuote({
    tasks: TASKS,
    rates: RATES,
    remote: false,
    promo: null,
    surcharge: null,
    travel: { minsThere: 2, minsBack: 2, ratePerHour: 40 },
    pricing: PRICING,
    quoted: null,
    ...overrides,
  });
  if (!b) throw new Error("priceOwnerQuote returned null");
  return b;
}

/**
 * Asserts the shown lines add up: task lines to the task subtotal, and subtotal plus
 * surcharge less any promo line plus travel to the total.
 * @param label - Case name.
 * @param b - The breakdown.
 */
function expectAddsUp(label: string, b: OwnerQuoteBreakdown): void {
  const lines = roundCents(b.tasks.reduce((s, t) => s + t.amount, 0));
  expectEqual(`${label}: task lines sum to the subtotal`, lines, b.tasksTotal);
  const sum = roundCents(
    b.tasksTotal + (b.surcharge?.amount ?? 0) - b.promoDiscount + (b.travel?.amount ?? 0),
  );
  expectEqual(`${label}: shown lines sum to the total`, sum, b.total);
}

/** Runs every owner quote fixture and reports the tally. */
function main(): void {
  console.log("owner quote fixtures\n");

  // Bobbie's booking at 6:30pm Friday: $65 flat promo, after hours, $10 minimum travel.
  const bobbie = price({ promo: promo("flat_hourly", 65), surcharge: AFTER_HOURS });
  expectEqual("flat promo shows the rate pair", [bobbie.fullRate, bobbie.promoRate], [100, 65]);
  expectEqual(
    "flat promo prices the lines at $65/hr",
    bobbie.tasks.map((t) => t.amount),
    [48.75, 27.08],
  );
  expectEqual("after hours adds $10/hr over 70 min", bobbie.surcharge?.amount, 11.67);
  expectEqual("no separate promo line when the rate is up front", bobbie.promoDiscount, 0);
  expectEqual("travel bills the $10 minimum", bobbie.travel?.amount, 10);
  expectEqual("total", bobbie.total, 97.5);
  expectEqual("promo title shown", bobbie.promoTitle, "Current rates locked in");
  expectAddsUp("flat promo", bobbie);

  // The same job at 2pm: no surcharge.
  const weekday = price({ promo: promo("flat_hourly", 65) });
  expectEqual("weekday daytime has no surcharge", weekday.surcharge, null);
  expectEqual("weekday daytime total", weekday.total, 85.83);

  // No promo on a weekend: full-rate lines, no rate pair.
  const full = price({ surcharge: WEEKEND });
  expectEqual("no promo has no promo rate", full.promoRate, null);
  expectEqual(
    "no promo prices at $100/hr",
    full.tasks.map((t) => t.amount),
    [75, 41.67],
  );
  expectEqual("no promo title", full.promoTitle, null);
  expectAddsUp("weekend, no promo", full);

  // A fixed-dollar promo can't be a rate, so it comes off as its own line.
  const fixed = price({ promo: promo("fixed_amount", 20) });
  expectEqual("fixed promo has no rate pair", fixed.promoRate, null);
  expectEqual("fixed promo is a $20 line", fixed.promoDiscount, 20);
  expectAddsUp("fixed promo", fixed);

  // Percent off: either a clean rate pair or a dollar line, but always adding up.
  const percent = price({ promo: promo("percent", 0.125), surcharge: WEEKEND });
  expectAddsUp("12.5% promo", percent);
  expect(
    "12.5% promo shows one or the other, never both",
    (percent.promoRate === null) !== (percent.promoDiscount === 0),
  );

  // Remote: the remote modifier, and no drive.
  const remote = price({ remote: true, travel: null });
  expectEqual("remote takes the remote modifier", remote.fullRate, 75);
  expectEqual("remote has no travel", remote.travel, null);
  expectAddsUp("remote", remote);

  // A short job is floored to the minimum billable time.
  const short = price({ tasks: [{ label: "Quick fix", mins: 15 }] });
  expectEqual("short job floors to 30 min", short.tasks[0]?.mins, 30);
  expectEqual("short job bills 30 min at $100/hr", short.tasksTotal, 50);

  // No estimate run: the rate line still shows, with no amounts.
  const none = price({ tasks: [], promo: promo("flat_hourly", 65), surcharge: AFTER_HOURS });
  expectEqual("no tasks still shows the promo rate", none.promoRate, 65);
  expectEqual("no tasks has no task lines", none.tasks, []);
  expectEqual("no tasks has no surcharge amount", none.surcharge?.amount, null);
  expectEqual("no tasks has no total", none.total, null);

  // No Standard rate row to price from.
  expectEqual(
    "no base rate gives no breakdown",
    priceOwnerQuote({
      tasks: TASKS,
      rates: [rate("remote", "Remote", null, -25)],
      remote: false,
      promo: null,
      surcharge: null,
      travel: null,
      pricing: PRICING,
      quoted: null,
    }),
    null,
  );

  finish();
}

main();
