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

import { computeJobPromoDiscount, formatMoneyCompact } from "@/features/business/lib/business";
import { validateDiscount, validateKind } from "@/features/business/lib/promo-validation";
import {
  applyPromoToHourlyRate,
  applyPromoToQuote,
  describePromoDiscount,
  promoForAppointment,
  promoForSpend,
  promoModifierRate,
  promoRateBeforeAfter,
  promoTravelBeforeAfter,
  summariseForBanner,
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
    kind: "automatic",
    code: null,
    discountType: type,
    flatHourlyRate: type === "flat_hourly" ? value : null,
    percentDiscount: type === "percent" ? value : null,
    fixedAmount: type === "fixed_amount" ? value : null,
    travelPercent: type === "free_travel" ? value : null,
    minSpend: null,
    tiers: [],
    activeWeekdays: [],
    activeFromMinute: null,
    activeToMinute: null,
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

  // ---- A restricted promo is advertised but not priced in ----
  //
  // Words and numbers part company: the banner names the restriction, while any
  // surface without an appointment to check declines to discount. Quoting a
  // Tuesday discount to someone who has not picked a day promises a price the
  // invoice will not honour.

  const tuesdayOnly: ActivePromo = { ...promo("percent", 0.2), activeWeekdays: [2] };

  expectEqual(
    "an unrestricted promo prices anywhere",
    promoForAppointment(promo("percent", 0.2), null)?.id ?? null,
    "p1",
  );
  expectEqual(
    "a restricted one does not, with no appointment",
    promoForAppointment(tuesdayOnly, null)?.id ?? null,
    null,
  );
  expectEqual(
    "it does on a matching appointment",
    promoForAppointment(tuesdayOnly, new Date("2026-06-01T21:00:00Z"))?.id ?? null,
    "p1",
  );
  expectEqual(
    "and not on a different day",
    promoForAppointment(tuesdayOnly, new Date("2026-06-02T21:00:00Z"))?.id ?? null,
    null,
  );
  expectEqual("null in, null out", promoForAppointment(null, null), null);

  // The banner is what adds the qualifier, so the phrase itself stays reusable.
  expectEqual(
    "the banner names the restriction",
    summariseForBanner({
      ...tuesdayOnly,
      activeFromMinute: 9 * 60,
      activeToMinute: 17 * 60,
    }).endsWith(", Tuesdays 9am to 5pm only"),
    true,
  );

  // ---- Spend thresholds and tiers ----
  //
  // Judged against the LOW end of the pre-discount total. A job quoted $90-$140
  // sits below a $100 threshold at one end and above it at the other; the low
  // end quotes the discount the customer is certain to get, and a job that
  // lands higher earns more at invoice time.

  /**
   * Builds a percent promo with spend bands.
   * @param bands - Pairs of [minSpend, percent off].
   * @returns A tiered promo.
   */
  function tiered(bands: [number, number][]): ActivePromo {
    return {
      ...promo("percent", 0.1),
      tiers: bands.map(([minSpend, pct]) => ({
        minSpend,
        flatHourlyRate: null,
        percentDiscount: pct,
        fixedAmount: null,
        travelPercent: null,
      })),
    };
  }

  expectEqual(
    "no threshold and no tiers applies as-is",
    promoForSpend(promo("percent", 0.2), 50)?.percentDiscount ?? null,
    0.2,
  );
  expectEqual(
    "a job under minSpend earns nothing",
    promoForSpend({ ...promo("percent", 0.2), minSpend: 100 }, 99),
    null,
  );
  expectEqual(
    "the threshold is inclusive",
    promoForSpend({ ...promo("percent", 0.2), minSpend: 100 }, 100)?.percentDiscount ?? null,
    0.2,
  );

  const BANDS = tiered([
    [100, 0.1],
    [200, 0.2],
    [300, 0.3],
  ]);

  expectEqual("below every band the promo does not apply", promoForSpend(BANDS, 99), null);
  expectEqual(
    "the first band at its floor",
    promoForSpend(BANDS, 100)?.percentDiscount ?? null,
    0.1,
  );
  expectEqual(
    "between bands takes the lower one",
    promoForSpend(BANDS, 199)?.percentDiscount ?? null,
    0.1,
  );
  expectEqual(
    "the highest band the job reaches wins",
    promoForSpend(BANDS, 250)?.percentDiscount ?? null,
    0.2,
  );
  expectEqual(
    "well past the top band still takes the top",
    promoForSpend(BANDS, 5000)?.percentDiscount ?? null,
    0.3,
  );

  // Resolution must not depend on how the bands happen to be stored.
  expectEqual(
    "stored out of order, same answer",
    promoForSpend(
      tiered([
        [300, 0.3],
        [100, 0.1],
        [200, 0.2],
      ]),
      250,
    )?.percentDiscount ?? null,
    0.2,
  );

  // The band replaces the promo's own columns wholesale. Merging them would let
  // a half-filled tier inherit the parent's value and discount by an amount
  // that appears in neither.
  expectEqual(
    "a band's value replaces the promo's own",
    promoForSpend(tiered([[100, 0.25]]), 150)?.percentDiscount ?? null,
    0.25,
  );

  // Both gates apply: minSpend can rule a job out before any band is reached.
  expectEqual(
    "minSpend is checked before the bands",
    promoForSpend({ ...tiered([[100, 0.1]]), minSpend: 200 }, 150),
    null,
  );

  expectEqual("null in, null out", promoForSpend(null, 500), null);

  // ---- What a tiered promo says it is ----
  //
  // Its own value columns are ignored by the engine, so quoting them would name
  // a discount nobody can earn.

  expectEqual(
    "a tiered promo names its bands, not its own column",
    describePromoDiscount(
      tiered([
        [200, 0.2],
        [100, 0.1],
      ]),
    ),
    "10% off over $100, 20% off over $200",
  );

  expectEqual(
    "a spend floor is named, or the offer reads as unconditional",
    summariseForBanner({ ...promo("percent", 0.2), minSpend: 100 }).startsWith(
      "20% off on jobs over $100 until",
    ),
    true,
  );

  expectEqual(
    "a tiered promo does not repeat the promo-wide floor",
    summariseForBanner({ ...tiered([[100, 0.1]]), minSpend: 100 }).startsWith(
      "10% off over $100 until",
    ),
    true,
  );

  // ---- Validation: kind and code have to agree ----
  //
  // A code promo saved without a code could never be claimed by anyone, and an
  // automatic promo carrying one would read as code-only in the admin list
  // while quietly applying to every visitor.

  expectEqual("an automatic promo needs no code", validateKind({ kind: "automatic" }), null);

  expectEqual(
    "an automatic promo may not carry one",
    validateKind({ kind: "automatic", code: "SPRING25" }),
    "an automatic promo cannot have a code",
  );

  expectEqual(
    "a code promo with a code is valid",
    validateKind({ kind: "code", code: "SPRING25" }),
    null,
  );

  expectEqual(
    "a code promo without one is rejected",
    validateKind({ kind: "code", code: null }),
    "a code promo needs a code",
  );

  // Lowercase never reaches here - the routes normalise first - so the pattern
  // judges the stored form, and a space would make the code unspeakable over
  // the phone.
  expectEqual(
    "a code with a space is rejected",
    validateKind({ kind: "code", code: "SPRING 25" }),
    "code must be 3-32 characters, letters, numbers and dashes only",
  );

  expectEqual(
    "a two-character code is too short to be worth guessing at",
    validateKind({ kind: "code", code: "AB" }),
    "code must be 3-32 characters, letters, numbers and dashes only",
  );

  expectEqual("dashes are allowed", validateKind({ kind: "code", code: "WINTER-25" }), null);

  // Missing kind means automatic, matching the column default.
  expectEqual("no kind at all reads as automatic", validateKind({}), null);

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

  // ---- The calculator: promos are a home offer ----
  //
  // This decides what a real invoice charges. Business labour is excluded, and
  // so is a business visit's travel - a travel promo used to discount it
  // because the travel branch returned before the business filter ran.

  const BIZ = "biz-modifier-id";

  /**
   * Builds a one-task job for the promo-discount cases.
   * @param unitPrice - The task's hourly rate.
   * @param business - Whether it carries the Business modifier.
   * @param travel - Travel charge on the job.
   * @returns A job shaped like the calculator's.
   */
  function job(
    unitPrice: number,
    business: boolean,
    travel = 0,
  ): Parameters<typeof computeJobPromoDiscount>[0] {
    return {
      durationMins: 60,
      tasks: [
        {
          rateConfigId: null,
          baseRateId: "base",
          modifierIds: business ? [BIZ] : [],
          description: "Task",
          qty: 1,
          unitPrice,
          lineTotal: unitPrice,
        },
      ],
      parts: [],
      travelEntries: [],
      notes: "",
      _travel: travel,
    } as unknown as Parameters<typeof computeJobPromoDiscount>[0];
  }

  expectEqual(
    "home labour is discounted",
    computeJobPromoDiscount(job(65, false), promo("percent", 0.15), 0, BIZ),
    9.75,
  );

  expectEqual(
    "business labour is not",
    computeJobPromoDiscount(job(95, true), promo("percent", 0.15), 0, BIZ),
    0,
  );

  expectEqual(
    "a fixed amount skips business labour too",
    computeJobPromoDiscount(job(95, true), promo("fixed_amount", 10), 0, BIZ),
    0,
  );

  expectEqual(
    "travel is discounted on a home visit",
    computeJobPromoDiscount(job(65, false), promo("free_travel", 0), 40, BIZ),
    40,
  );

  // The bug this pins: the travel branch used to return before the filter.
  expectEqual(
    "travel is NOT discounted on a business visit",
    computeJobPromoDiscount(job(95, true), promo("free_travel", 0), 40, BIZ),
    0,
  );

  // The invoice path narrows by spend through the same function as the public
  // estimate, judged on the subtotal calcJobTotal has already computed.

  const TIERED = {
    ...promo("percent", 0.1),
    tiers: [
      {
        minSpend: 100,
        flatHourlyRate: null,
        percentDiscount: 0.1,
        fixedAmount: null,
        travelPercent: null,
      },
      {
        minSpend: 200,
        flatHourlyRate: null,
        percentDiscount: 0.2,
        fixedAmount: null,
        travelPercent: null,
      },
    ],
  };

  // job(65, false) is one hour of home labour at $65; the subtotal argument is
  // what selects the band.
  expectEqual(
    "a job under every band earns nothing on the invoice either",
    computeJobPromoDiscount(job(65, false), TIERED, 0, BIZ, 65),
    0,
  );
  expectEqual(
    "reaching the first band discounts at its rate",
    computeJobPromoDiscount(job(65, false), TIERED, 0, BIZ, 150),
    6.5,
  );
  expectEqual(
    "reaching the second takes the higher one",
    computeJobPromoDiscount(job(65, false), TIERED, 0, BIZ, 250),
    13,
  );
  expectEqual(
    "a spend floor blocks the invoice discount too",
    computeJobPromoDiscount(
      job(65, false),
      { ...promo("percent", 0.15), minSpend: 100 },
      0,
      BIZ,
      99,
    ),
    0,
  );

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
