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

import { validateDiscount } from "@/features/business/lib/promo-validation";
import {
  applyPromoToHourlyRate,
  applyPromoToQuote,
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

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
