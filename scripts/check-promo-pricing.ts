// scripts/check-promo-pricing.ts
// What each promo type does to a quote, and - the point of this file - proof
// that the two existing types still produce exactly the numbers they did
// before the quote-level stage existed.
//
// The pricing pipeline discounts the hourly rate BEFORE priceRangeFor builds
// the band, so a quote-level discount that scaled the band afterwards would
// round differently. flat_hourly and percent therefore stay on the rate stage
// and must leave the quote stage untouched; the equivalence cases below fail
// if that ever stops being true.
// Run with: npm run check:promo-pricing

import { formatMoneyCompact } from "@/features/business/lib/business";
import { validateDiscount } from "@/features/business/lib/promo-validation";
import {
  applyPromoToHourlyRate,
  applyPromoToQuote,
  describePromoDiscount,
  promoModifierRate,
  promoRateBeforeAfter,
  promoTravelBeforeAfter,
  type ActivePromo,
  type QuoteParts,
} from "@/features/business/lib/promos";

let failures = 0;

/**
 * Compares a value against its expectation, recording rather than throwing so
 * every fixture runs even after one fails.
 * @param label - Human-readable case name.
 * @param actual - Value produced by the code under test.
 * @param expected - Value the case should produce.
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
 * Builds a promo of one discount type.
 * @param type - Discount type.
 * @param value - The type's single value.
 * @returns A promo shaped like the ones the resolver returns.
 */
function promo(type: ActivePromo["discountType"], value: number): ActivePromo {
  return {
    id: "p1",
    title: "Test promo",
    description: null,
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2026-12-31T00:00:00.000Z",
    discountType: type,
    flatHourlyRate: type === "flat_hourly" ? value : null,
    percentDiscount: type === "percent" ? value : null,
    fixedAmount: type === "fixed_amount" ? value : null,
    travelPercent: type === "free_travel" ? value : null,
  };
}

/**
 * Builds a priced quote to run through the discount stage.
 * @param labourLow - Low end of the labour band, in dollars.
 * @param labourHigh - High end of the labour band, in dollars.
 * @param travel - Round-trip travel charge, in dollars.
 * @returns The quote parts.
 */
function parts(labourLow: number, labourHigh: number, travel: number): QuoteParts {
  return { labourLow, labourHigh, travel };
}

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("promo pricing fixtures\n");

  // ---- Rate stage: unchanged behaviour for the two existing types ----

  expectEqual("no promo leaves the rate alone", applyPromoToHourlyRate(90, null), 90);

  expectEqual(
    "flat hourly overrides the rate",
    applyPromoToHourlyRate(90, promo("flat_hourly", 60)),
    60,
  );

  // A promo above the base rate is a misconfiguration, never a price rise.
  expectEqual(
    "flat hourly never raises the price",
    applyPromoToHourlyRate(90, promo("flat_hourly", 120)),
    90,
  );

  expectEqual("percent comes off the rate", applyPromoToHourlyRate(90, promo("percent", 0.2)), 72);

  expectEqual(
    "percent rounds to cents",
    applyPromoToHourlyRate(99.99, promo("percent", 0.15)),
    84.99,
  );

  // The new types must not touch the rate - they act after pricing.
  expectEqual(
    "fixed amount leaves the rate alone",
    applyPromoToHourlyRate(90, promo("fixed_amount", 20)),
    90,
  );
  expectEqual(
    "free travel leaves the rate alone",
    applyPromoToHourlyRate(90, promo("free_travel", 0)),
    90,
  );

  // ---- Quote stage: the two existing types must be a no-op here ----

  const q = parts(120, 180, 30);

  expectEqual("no promo leaves the quote alone", applyPromoToQuote(q, null), q);

  expectEqual(
    "flat hourly does nothing at the quote stage",
    applyPromoToQuote(q, promo("flat_hourly", 60)),
    q,
  );

  expectEqual(
    "percent does nothing at the quote stage",
    applyPromoToQuote(q, promo("percent", 0.2)),
    q,
  );

  // ---- Quote stage: the new types ----

  expectEqual(
    "free travel zeroes the travel line",
    applyPromoToQuote(q, promo("free_travel", 0)),
    parts(120, 180, 0),
  );

  expectEqual(
    "half-price travel halves it",
    applyPromoToQuote(q, promo("free_travel", 0.5)),
    parts(120, 180, 15),
  );

  expectEqual(
    "fixed amount comes off both band ends",
    applyPromoToQuote(q, promo("fixed_amount", 20)),
    parts(100, 160, 30),
  );

  // The floor exists so a small job cannot quote a negative labour figure.
  expectEqual(
    "fixed amount floors at zero, never negative",
    applyPromoToQuote(parts(15, 25, 30), promo("fixed_amount", 40)),
    parts(0, 0, 30),
  );

  expectEqual(
    "fixed amount does not eat into travel",
    applyPromoToQuote(parts(10, 10, 30), promo("fixed_amount", 100)),
    parts(0, 0, 30),
  );

  // ---- Validation: each type is judged on its own value column ----
  //
  // The create and edit routes each had their own copy of this and drifted:
  // the edit route kept demanding one of the two original columns, so editing
  // a fixed-amount promo was rejected outright. These cases pin the shape.

  expectEqual(
    "fixed amount is valid with both original columns null",
    validateDiscount({
      discountType: "fixed_amount",
      flatHourlyRate: null,
      percentDiscount: null,
      fixedAmount: 20,
    }),
    null,
  );

  expectEqual(
    "free travel is valid at 0 (travel is free)",
    validateDiscount({ discountType: "free_travel", travelPercent: 0 }),
    null,
  );

  expectEqual(
    "free travel at 1 is rejected - it would discount nothing",
    validateDiscount({ discountType: "free_travel", travelPercent: 1 }),
    "travelPercent must be between 0 and 1 (0 = free travel)",
  );

  expectEqual(
    "fixed amount without a value is rejected",
    validateDiscount({ discountType: "fixed_amount", fixedAmount: null }),
    "fixedAmount must be a positive number",
  );

  expectEqual(
    "flat hourly still validates as before",
    validateDiscount({ discountType: "flat_hourly", flatHourlyRate: 60 }),
    null,
  );

  expectEqual(
    "percent still validates as before",
    validateDiscount({ discountType: "percent", percentDiscount: 0.2 }),
    null,
  );

  // A promo written before discountType existed still has to pass.
  expectEqual(
    "legacy row with only flatHourlyRate is valid",
    validateDiscount({ flatHourlyRate: 50 }),
    null,
  );

  // ---- Customer-facing copy ----
  //
  // A non-rate promo leaves the headline $/hr alone, so this phrase is the only
  // place the pricing page says what the offer actually gives.

  expectEqual(
    "fixed amount reads as money off",
    describePromoDiscount(promo("fixed_amount", 10)),
    "$10 off",
  );

  expectEqual(
    "free travel reads as free, not 100% off",
    describePromoDiscount(promo("free_travel", 0)),
    "Free travel",
  );

  expectEqual(
    "part-charged travel reads as a percentage off",
    describePromoDiscount(promo("free_travel", 0.5)),
    "50% off travel",
  );

  expectEqual(
    "flat hourly wording is unchanged",
    describePromoDiscount(promo("flat_hourly", 60)),
    "$60/hr",
  );

  expectEqual(
    "percent wording is unchanged",
    describePromoDiscount(promo("percent", 0.2)),
    "20% off",
  );

  // ---- The pricing page's crossed-out pairs ----

  expectEqual(
    "flat hourly crosses out the base rate",
    promoRateBeforeAfter(65, promo("flat_hourly", 50)),
    { before: 65, after: 50 },
  );

  expectEqual(
    "percent crosses out the base rate",
    promoRateBeforeAfter(65, promo("percent", 0.2)),
    { before: 65, after: 52 },
  );

  // At the operator's request: a one-hour illustration, not a charged rate.
  expectEqual(
    "fixed amount subtracts from the hourly figure",
    promoRateBeforeAfter(65, promo("fixed_amount", 10)),
    { before: 65, after: 55 },
  );

  expectEqual(
    "a fixed amount bigger than the rate floors at zero",
    promoRateBeforeAfter(65, promo("fixed_amount", 100)),
    { before: 65, after: 0 },
  );

  // A travel promo must not touch the hourly pair, or the page crosses out a
  // price and shows the identical one back - the reported bug.
  expectEqual(
    "free travel leaves the hourly pair alone",
    promoRateBeforeAfter(65, promo("free_travel", 0)),
    null,
  );

  expectEqual(
    "free travel crosses out the travel charge",
    promoTravelBeforeAfter(25, promo("free_travel", 0)),
    { before: 25, after: 0 },
  );

  expectEqual(
    "half-price travel halves the travel charge",
    promoTravelBeforeAfter(25, promo("free_travel", 0.5)),
    { before: 25, after: 12.5 },
  );

  expectEqual(
    "a labour promo leaves the travel pair alone",
    promoTravelBeforeAfter(25, promo("fixed_amount", 10)),
    null,
  );

  // ---- Money formatting ----
  //
  // A promo can halve a whole-dollar setting into cents. Bare arithmetic then
  // prints "$7.5", and toFixed(0) rounded $8.50 up to "$9" beside a "$8.50"
  // stated lower down the same page. Both shipped once.

  expectEqual("whole dollars stay whole", formatMoneyCompact(65), "$65");
  expectEqual("half a dollar keeps both digits", formatMoneyCompact(8.5), "$8.50");
  expectEqual("and never rounds away", formatMoneyCompact(7.5), "$7.50");
  expectEqual("a discounted whole rate stays whole", formatMoneyCompact(34), "$34");

  // ---- Modifier rates during a promo ----
  //
  // Mirrors the engine. A delta modifier changes the task's own rate, so the
  // promo discounts the modified figure. An uplift is a surcharge on full
  // labour and the promo discount comes off full labour too, so they add
  // rather than multiply - 65 + 25% - 15% is 71.50, not 81.25 x 0.85.

  expectEqual(
    "percent promo discounts a delta modifier",
    promoModifierRate(65, 40, "delta", promo("percent", 0.15)),
    34,
  );

  expectEqual(
    "percent promo against a holiday uplift is additive",
    promoModifierRate(65, 81.25, "uplift", promo("percent", 0.15)),
    71.5,
  );

  expectEqual(
    "fixed amount comes off a delta modifier",
    promoModifierRate(65, 40, "delta", promo("fixed_amount", 10)),
    30,
  );

  expectEqual(
    "fixed amount against an uplift takes the same dollars",
    promoModifierRate(65, 81.25, "uplift", promo("fixed_amount", 10)),
    71.25,
  );

  // A travel promo touches no labour rate at all.
  expectEqual(
    "travel promo leaves modifiers alone",
    promoModifierRate(65, 40, "delta", promo("free_travel", 0)),
    40,
  );

  expectEqual("no promo leaves modifiers alone", promoModifierRate(65, 40, "delta", null), 40);

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
