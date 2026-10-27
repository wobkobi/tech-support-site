// scripts/check-promo-pricing.ts
// What each promo type does to a quote. flat_hourly and percent discount the rate before
// priceRangeFor builds the band, so they must leave the quote stage untouched.
// Run with: npm test -- promo-pricing

import {
  calcInvoiceTotals,
  calcJobTotal,
  computeJobPromoDiscount,
  formatBilledTime,
  formatMoneyCompact,
  promoRateNote,
  splitLineTotals,
} from "@/features/business/lib/business";
import { reissuePrefill } from "@/features/business/lib/invoice-reissue";
import {
  chosenSurcharge,
  dateSurcharge,
  DEFAULT_RATE_ROWS,
  FALLBACK_BASE_RATE,
  surchargeOption,
} from "@/features/business/lib/pricing-policy";
import { validateDiscount, validateKind } from "@/features/business/lib/promo-validation";
import {
  applyPromoToHourlyRate,
  applyPromoToQuote,
  describePromoDiscount,
  describePromoOffer,
  promoForAppointment,
  promoForRateCard,
  promoForSpend,
  promoModifierRate,
  promoRateBeforeAfter,
  promoTravelBeforeAfter,
  summariseForBanner,
  type ActivePromo,
  type QuoteParts,
} from "@/features/business/lib/promos";
import type { RateConfig } from "@/features/business/types/business";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import { expectEqual, finish } from "./lib/harness.js";

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
  // Without an appointment to check, quoting the discount would promise an unhonoured price.

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

  // Customer-limited promos price only once the server has judged the customer
  const newCustomers: ActivePromo = { ...promo("percent", 0.2), customerLimited: true };
  expectEqual(
    "a customer-limited promo does not price an anonymous quote",
    promoForAppointment(newCustomers, null)?.id ?? null,
    null,
  );
  expectEqual(
    "it does once the server judged it against the email",
    promoForAppointment(newCustomers, null, { customerChecked: true })?.id ?? null,
    "p1",
  );
  expectEqual("and never prices a rate card", promoForRateCard(newCustomers)?.id ?? null, null);

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

  // endAt is exclusive (NZ midnight after the last day), so the banner names the day before.
  // One NZDT (+13) and one NZST (+12) date so the offset can't hide an off-by-one.
  const lastDayCases: [string, string][] = [
    ["2026-10-31T11:00:00.000Z", "31 Oct"],
    ["2026-07-31T12:00:00.000Z", "31 Jul"],
  ];
  for (const [endAt, lastDay] of lastDayCases) {
    expectEqual(
      `a promo stored to end ${endAt} is shown ending ${lastDay}`,
      summariseForBanner({ ...promo("percent", 0.2), endAt }, { fixedDate: true }).includes(
        lastDay,
      ),
      true,
    );
  }

  // ---- Spend thresholds and tiers ----
  // Judged on the LOW end of the pre-discount total: the discount the customer is sure of.

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

  // The band replaces the promo's columns wholesale; merging would mix values
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
  // The engine ignores its own value columns, so they must not be quoted.

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
      "20% off on jobs over $100 if you book by",
    ),
    true,
  );

  expectEqual(
    "a tiered promo does not repeat the promo-wide floor",
    summariseForBanner({ ...tiered([[100, 0.1]]), minSpend: 100 }).startsWith(
      "10% off over $100 if you book by",
    ),
    true,
  );

  // ---- Validation: kind and code have to agree ----

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

  // Routes uppercase first, so this judges the stored form
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
  // For a non-rate promo this phrase is the only place the offer is stated.

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

  // A travel promo must not cross out a rate only to show the same one back
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
  // Halved whole dollars must print "$7.50", never "$7.5" or a rounded "$9".

  expectEqual("whole dollars stay whole", formatMoneyCompact(65), "$65");
  expectEqual("half a dollar keeps both digits", formatMoneyCompact(8.5), "$8.50");
  expectEqual("and never rounds away", formatMoneyCompact(7.5), "$7.50");
  expectEqual("a discounted whole rate stays whole", formatMoneyCompact(34), "$34");

  // ---- Modifier rates during a promo ----
  // A delta modifier is discounted; an uplift and the promo both apply to full labour, so
  // they add: 65 + 25% - 15% is 71.50, not 81.25 x 0.85.

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
  // Business labour and a business visit's travel are both excluded.

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

  expectEqual(
    "travel is NOT discounted on a business visit",
    computeJobPromoDiscount(job(95, true), promo("free_travel", 0), 40, BIZ),
    0,
  );

  // The invoice path narrows by spend like the public estimate, on calcJobTotal's subtotal

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

  // One $65 home hour; the subtotal argument selects the band
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

  // ---- A flat rate on a mixed-rate job ----
  // Per line, never netted: $65 + $40 under $55/hr is $10 off, not $0.

  const mixed = job(65, false);
  mixed.tasks.push({ ...mixed.tasks[0]!, unitPrice: 40, lineTotal: 40 });
  expectEqual(
    "a flat rate discounts only the line above it",
    computeJobPromoDiscount(mixed, promo("flat_hourly", 55), 0, BIZ),
    10,
  );
  expectEqual(
    "and a single line exactly as before",
    computeJobPromoDiscount(job(65, false), promo("flat_hourly", 55), 0, BIZ),
    10,
  );

  // ---- A flat rate with the Standard rate known ----
  // A cut of (Standard - flat) off every home hour; figures derive from the seeded rates.

  /**
   * The seeded hourly delta for one modifier label.
   * @param label - RateConfig label.
   * @returns Its hourlyDelta.
   */
  const seededDelta = (label: string): number => {
    const delta = DEFAULT_RATE_ROWS.find((r) => r.label === label)?.hourlyDelta;
    if (delta == null) throw new Error(`No seeded hourlyDelta for ${label}`);
    return delta;
  };
  const STANDARD = FALLBACK_BASE_RATE;
  // Any flat rate under Standard; the gap is the per-hour cut.
  const FLAT = STANDARD - 10;
  const CUT = STANDARD - FLAT;
  const REMOTE_DELTA = seededDelta("Remote");
  const PHONE_DELTA = seededDelta("Phone");
  const HOLIDAY_UPLIFT = DEFAULT_SETTINGS.pricing.publicHolidayUplift;
  const remoteRate = STANDARD + REMOTE_DELTA;
  const phoneRate = STANDARD + PHONE_DELTA;
  const holidayRate = STANDARD * (1 + HOLIDAY_UPLIFT);

  const cutJob = job(remoteRate, false);
  cutJob.tasks.push({ ...cutJob.tasks[0]!, unitPrice: phoneRate, lineTotal: phoneRate });
  expectEqual(
    "a flat rate cuts every home line by Standard minus flat",
    computeJobPromoDiscount(cutJob, promo("flat_hourly", FLAT), 0, BIZ, undefined, STANDARD),
    2 * CUT,
  );
  const tinyRate = CUT / 2;
  expectEqual(
    "the cut never takes a line below zero",
    computeJobPromoDiscount(
      job(tinyRate, false),
      promo("flat_hourly", FLAT),
      0,
      BIZ,
      undefined,
      STANDARD,
    ),
    tinyRate,
  );
  expectEqual(
    "business labour is still excluded from the cut",
    computeJobPromoDiscount(
      job(STANDARD, true),
      promo("flat_hourly", FLAT),
      0,
      BIZ,
      undefined,
      STANDARD,
    ),
    0,
  );
  expectEqual(
    "a flat rate above Standard cuts nothing",
    computeJobPromoDiscount(
      job(remoteRate, false),
      promo("flat_hourly", STANDARD + 1),
      0,
      BIZ,
      undefined,
      STANDARD,
    ),
    0,
  );
  // ---- A line priced under the live rate ----
  // Each hour floors at the promo price for its rate tags, so a stale line never bills
  // under the advertised flat rate.

  const LIVE_RATES = [
    { id: "base", ratePerHour: STANDARD, hourlyDelta: null, percentDelta: null },
    { id: "phone", ratePerHour: null, hourlyDelta: PHONE_DELTA, percentDelta: null },
  ] as unknown as RateConfig[];
  const STALE = FLAT + CUT / 2;
  expectEqual(
    "a stale line under the live rate only comes down to the flat rate",
    computeJobPromoDiscount(
      job(STALE, false),
      promo("flat_hourly", FLAT),
      0,
      BIZ,
      undefined,
      STANDARD,
      LIVE_RATES,
    ),
    STALE - FLAT,
  );
  const livePhone = job(phoneRate, false);
  livePhone.tasks[0]!.modifierIds = ["phone"];
  expectEqual(
    "a live modified line still takes the full cut",
    computeJobPromoDiscount(
      livePhone,
      promo("flat_hourly", FLAT),
      0,
      BIZ,
      undefined,
      STANDARD,
      LIVE_RATES,
    ),
    CUT,
  );
  expectEqual(
    "a line above the live rate takes the cut, no more",
    computeJobPromoDiscount(
      job(STANDARD + 20, false),
      promo("flat_hourly", FLAT),
      0,
      BIZ,
      undefined,
      STANDARD,
      LIVE_RATES,
    ),
    CUT,
  );

  expectEqual(
    "the rate helper cuts a modified rate the same way",
    applyPromoToHourlyRate(phoneRate, promo("flat_hourly", FLAT), STANDARD),
    phoneRate - CUT,
  );
  expectEqual(
    "the rate helper still reads a bare rate as Standard",
    applyPromoToHourlyRate(STANDARD, promo("flat_hourly", FLAT)),
    FLAT,
  );
  expectEqual(
    "the pricing page's modifier rate keeps its gap from the flat rate",
    promoModifierRate(STANDARD, remoteRate, "delta", promo("flat_hourly", FLAT)),
    FLAT + REMOTE_DELTA,
  );
  expectEqual(
    "a public holiday takes the same per-hour cut",
    promoModifierRate(STANDARD, holidayRate, "uplift", promo("flat_hourly", FLAT)),
    holidayRate - CUT,
  );

  // ---- Locked deltas ----
  // "Lock in current rates" set at $65 Standard / At home -$15, read after rates moved to
  // $100 / -$30: at-home bills the old $50, not $70 less the $35 Standard cut.

  const LOCKED = {
    ...promo("flat_hourly", 65),
    lockedDeltas: [{ label: "At home", hourlyDelta: -15 }],
  };
  const MOVED_RATES = [
    { id: "base", label: "Standard", ratePerHour: 100, hourlyDelta: null, percentDelta: null },
    { id: "home", label: "At home", ratePerHour: null, hourlyDelta: -30, percentDelta: null },
    { id: "remote", label: "Remote", ratePerHour: null, hourlyDelta: -10, percentDelta: null },
  ] as unknown as RateConfig[];
  const homeJob = job(70, false);
  homeJob.tasks = [
    { ...homeJob.tasks[0]!, modifierIds: ["home"], qty: 0.75, lineTotal: 52.5 },
    { ...homeJob.tasks[0]!, modifierIds: ["home"], qty: 125 / 60, lineTotal: 145.83 },
  ];
  expectEqual(
    "an at-home job bills the locked $50, not $35",
    computeJobPromoDiscount(homeJob, LOCKED, 0, BIZ, undefined, 100, MOVED_RATES),
    56.66,
  );
  const remoteJob = job(90, false);
  remoteJob.tasks[0]!.modifierIds = ["remote"];
  expectEqual(
    "a modifier with no locked delta keeps the plain Standard cut",
    computeJobPromoDiscount(remoteJob, LOCKED, 0, BIZ, undefined, 100, MOVED_RATES),
    35,
  );
  expectEqual(
    "a Standard line still bills the flat rate",
    computeJobPromoDiscount(job(100, false), LOCKED, 0, BIZ, undefined, 100, MOVED_RATES),
    35,
  );
  expectEqual(
    "the rate helper prices a locked modifier at flat plus its old delta",
    applyPromoToHourlyRate(70, LOCKED, 100, [{ label: "At home", hourlyDelta: -30 }]),
    50,
  );
  expectEqual(
    "the pricing page matches the locked at-home rate case-insensitively",
    promoModifierRate(100, 70, "delta", LOCKED, "at home"),
    50,
  );
  expectEqual(
    "a locked delta never raises the rate",
    applyPromoToHourlyRate(
      70,
      { ...LOCKED, lockedDeltas: [{ label: "At home", hourlyDelta: 30 }] },
      100,
      [{ label: "At home", hourlyDelta: -30 }],
    ),
    70,
  );

  // ---- The rate card ----
  // /pricing and /faq have no job total, so spend-gated promos are named but never priced.

  expectEqual(
    "an unconditional promo prices the rate card",
    promoForRateCard(promo("percent", 0.2))?.id ?? null,
    "p1",
  );
  expectEqual(
    "a spend floor keeps it off the rate card",
    promoForRateCard({ ...promo("percent", 0.2), minSpend: 100 })?.id ?? null,
    null,
  );
  expectEqual("so do tiers", promoForRateCard(TIERED)?.id ?? null, null);
  expectEqual(
    "and a weekday restriction, as before",
    promoForRateCard({ ...promo("percent", 0.2), activeWeekdays: [2] })?.id ?? null,
    null,
  );
  expectEqual(
    "the offer line names the floor",
    describePromoOffer({ ...promo("percent", 0.2), minSpend: 100 }),
    "20% off on jobs over $100",
  );

  // --- Unsuccessful visit during a promo ---
  // Half price comes off each line after the promo: 1.5h at $65 promo bills $48.75.

  /**
   * Builds a job of hourly lines for the unsuccessful cases.
   * @param lines - Each line's hours, rate and per-task unsuccessful flag.
   * @param unsuccessful - The whole-job unsuccessful flag.
   * @returns A job shaped like the calculator's.
   */
  function failedJob(
    lines: { qty: number; unitPrice: number; unsuccessful?: boolean }[],
    unsuccessful: boolean,
  ): Parameters<typeof calcJobTotal>[0] {
    return {
      durationMins: 60,
      unsuccessful,
      tasks: lines.map((l) => ({
        rateConfigId: null,
        baseRateId: "base",
        modifierIds: [],
        description: "Task",
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.qty * l.unitPrice,
        unsuccessful: l.unsuccessful,
      })),
      parts: [],
      travelEntries: [],
      notes: "",
    } as unknown as Parameters<typeof calcJobTotal>[0];
  }
  const NO_FLOOR = {
    gstRegistered: false,
    minTravelCharge: 0,
    minBillableMins: 0,
    standardRate: 100,
  };

  const flatFailed = calcJobTotal(
    failedJob([{ qty: 1.5, unitPrice: 100 }], true),
    promo("flat_hourly", 65),
    NO_FLOOR,
  );
  expectEqual("a failed visit still gets the promo", flatFailed.promoDiscount, 52.5);
  expectEqual(
    "then half of the promo price comes off, not half of the full price",
    flatFailed.unsuccessfulDiscount,
    48.75,
  );
  expectEqual("so the labour bills at half the promo price", flatFailed.total, 48.75);

  // 4h20m across thirds-of-a-cent lines: $433.33 at $100/hr, $281.67 at $65/hr. The
  // raw $35/hr cut is $151.667; rounded on its own it billed $281.66.
  const lockedRate = calcJobTotal(
    failedJob(
      [135, 25, 15, 25, 5, 20, 35].map((mins) => ({ qty: mins / 60, unitPrice: 100 })),
      false,
    ),
    promo("flat_hourly", 65),
    NO_FLOOR,
  );
  expectEqual("a flat promo's discount is the rounded gap", lockedRate.promoDiscount, 151.66);
  expectEqual("so the hours bill at exactly the promo price", lockedRate.total, 281.67);

  expectEqual(
    "with no promo, a failed visit is half the full price",
    calcJobTotal(failedJob([{ qty: 1.5, unitPrice: 100 }], true), null, NO_FLOOR)
      .unsuccessfulDiscount,
    75,
  );
  expectEqual(
    "a flagged task is halved after its own promo share",
    calcJobTotal(
      failedJob(
        [
          { qty: 1, unitPrice: 100, unsuccessful: true },
          { qty: 1, unitPrice: 100 },
        ],
        false,
      ),
      promo("percent", 0.2),
      NO_FLOOR,
    ).unsuccessfulDiscount,
    40,
  );
  const fixedLines = [
    { qty: 1, unitPrice: 100, unsuccessful: true },
    { qty: 2, unitPrice: 100, unsuccessful: true },
  ];
  expectEqual(
    "flagging every task matches the whole-job flag under a fixed-amount promo",
    calcJobTotal(failedJob(fixedLines, false), promo("fixed_amount", 30), NO_FLOOR)
      .unsuccessfulDiscount,
    calcJobTotal(failedJob(fixedLines, true), promo("fixed_amount", 30), NO_FLOOR)
      .unsuccessfulDiscount,
  );
  expectEqual(
    "a fixed amount is spread before halving: (300 - 30) / 2",
    calcJobTotal(failedJob(fixedLines, true), promo("fixed_amount", 30), NO_FLOOR)
      .unsuccessfulDiscount,
    135,
  );

  expectEqual(
    "a +25% day's surcharge is halved with the labour: 2h at $65 takes $81.25 off",
    calcJobTotal(failedJob([{ qty: 2, unitPrice: 65 }], true), null, {
      ...NO_FLOOR,
      surchargeUplift: 0.25,
    }).unsuccessfulDiscount,
    81.25,
  );

  /**
   * One $100 hour beside a second row, under 20% off.
   * @param row - The second row's rate tags and flags.
   * @returns The promo discount.
   */
  const percentBeside = (row: Record<string, unknown>): number =>
    calcJobTotal(
      {
        ...failedJob([{ qty: 1, unitPrice: 100 }], false),
        tasks: [
          ...failedJob([{ qty: 1, unitPrice: 100 }], false).tasks,
          { description: "Row", qty: 1, unitPrice: 50, lineTotal: 50, ...row },
        ],
      } as Parameters<typeof calcJobTotal>[0],
      promo("percent", 0.2),
      NO_FLOOR,
    ).promoDiscount;
  expectEqual(
    "a cancellation fee is not labour, so no promo comes off it",
    percentBeside({ rateConfigId: null, baseRateId: null, isFlatFee: true }),
    20,
  );
  expectEqual(
    "a 'No base' hourly row is labour, so the promo does",
    percentBeside({ rateConfigId: null, baseRateId: null }),
    30,
  );

  const freeTravel = calcJobTotal(
    {
      ...failedJob([{ qty: 1, unitPrice: 100 }], false),
      travelEntries: [
        { label: "Travel", cost: 30, isAuto: true, durationMinsOneWay: 15 },
        { label: "Parking", cost: 5, isParsedCost: true },
      ],
    },
    promo("free_travel", 0),
    NO_FLOOR,
  );
  expectEqual("free travel covers the drive, not the parking", freeTravel.promoDiscount, 30);
  expectEqual("free travel names no rate", freeTravel.promoRate, null);

  // The invoice's promo note: 1 hr 55 min at $100/hr under the $65 promo read as 1.55 hrs.
  console.log("\nthe promo row names the hours and rates\n");
  const lockedIn = calcJobTotal(
    failedJob([{ qty: 115 / 60, unitPrice: 100 }], false),
    promo("flat_hourly", 65),
    NO_FLOOR,
  );
  expectEqual("the flat promo's discount", lockedIn.promoDiscount, 67.09);
  expectEqual(
    "it names the time at both rates",
    promoRateNote(lockedIn.promoRate),
    "1 hr 55 min at $65/hr instead of $100/hr",
  );
  expectEqual(
    "two lines at the same rates sum their time",
    promoRateNote(
      calcJobTotal(
        failedJob(
          [
            { qty: 1, unitPrice: 100 },
            { qty: 0.5, unitPrice: 100 },
          ],
          false,
        ),
        promo("percent", 0.2),
        NO_FLOOR,
      ).promoRate,
    ),
    "1 hr 30 min at $80/hr instead of $100/hr",
  );
  expectEqual(
    "lines at different rates name none, since one pair would misstate some",
    calcJobTotal(
      failedJob(
        [
          { qty: 1, unitPrice: 100 },
          { qty: 1, unitPrice: 90 },
        ],
        false,
      ),
      promo("percent", 0.2),
      NO_FLOOR,
    ).promoRate,
    null,
  );
  expectEqual(
    "a fixed amount names no rate",
    calcJobTotal(
      failedJob([{ qty: 1, unitPrice: 100 }], false),
      promo("fixed_amount", 20),
      NO_FLOOR,
    ).promoRate,
    null,
  );
  expectEqual(
    "billed time is spelled out, never h:mm",
    [45, 60, 115, 120, 655].map(formatBilledTime),
    ["45 min", "1 hr", "1 hr 55 min", "2 hr", "10 hr 55 min"],
  );

  // Timed lines share cents: 35 + 35 + 20 min at $100/hr must total $150, not $149.99
  console.log("\nline totals split cents across timed lines\n");
  /**
   * A timed line item as jobToLineItems emits one.
   * @param mins - Billed minutes.
   * @param rate - Hourly rate.
   * @returns The line's qty, unit price and minutes.
   */
  const timed = (
    mins: number,
    rate: number,
  ): { qty: number; unitPrice: number; minutes: number } => ({
    qty: mins / 60,
    unitPrice: rate,
    minutes: mins,
  });
  const thirds = [timed(35, 100), timed(35, 100), timed(20, 100)];
  expectEqual(
    "the leftover cent goes to the first of the biggest lines",
    splitLineTotals(thirds),
    [58.34, 58.33, 33.33],
  );
  expectEqual(
    "a tied cent lands on the big line, not a 5-min one",
    splitLineTotals([timed(5, 100), timed(185, 100)]),
    [8.33, 308.34],
  );
  expectEqual(
    "the subtotal is the whole time at the rate",
    calcInvoiceTotals(thirds).subtotal,
    150,
  );
  expectEqual(
    "two 35-min lines at $65/hr total 70 min, not two rounded halves",
    splitLineTotals([timed(35, 65), timed(35, 65)]),
    [37.92, 37.91],
  );
  expectEqual(
    "lines without minutes and lone timed lines round on their own",
    splitLineTotals([timed(35, 65), { qty: 1, unitPrice: 10 }, timed(20, 55)]),
    [37.92, 10, 18.33],
  );

  console.log("\nthe surcharge tick\n");
  const uplifts = { publicHolidayUplift: 0.25, weekendUplift: 0.1 };
  const saturday = dateSurcharge(null, 6, uplifts);
  const holiday = dateSurcharge("Labour Day", 1, uplifts);
  expectEqual(
    "untouched, a Saturday bills weekend rates",
    chosenSurcharge(saturday, null, 0.1),
    saturday,
  );
  expectEqual("unticked, a Saturday bills none", chosenSurcharge(saturday, false, 0.1), null);
  expectEqual("unticked, a holiday bills none", chosenSurcharge(holiday, false, 0.1), null);
  expectEqual("ticked, a holiday keeps its own rate", chosenSurcharge(holiday, true, 0.1), holiday);
  expectEqual("untouched, a weekday bills none", chosenSurcharge(null, null, 0.1), null);
  expectEqual(
    "ticked, a weekday bills the weekend uplift as after hours",
    chosenSurcharge(null, true, 0.1),
    {
      reason: "After hours",
      label: "After-hours surcharge",
      uplift: 0.1,
    },
  );
  expectEqual("with weekend rates off there is nothing to tick", surchargeOption(null, 0), null);

  console.log("\na re-issue carries the surcharge as a tick, not a line\n");
  /**
   * Re-issue prefill for a voided invoice with these lines.
   * @param descriptions - The voided invoice's line descriptions.
   * @param extra - Invoice fields to override.
   * @returns What the calculator would seed.
   */
  const voided = (
    descriptions: string[],
    extra: Partial<Parameters<typeof reissuePrefill>[0]> = {},
  ): ReturnType<typeof reissuePrefill> =>
    reissuePrefill({
      id: "0123456789abcdef01234567",
      number: "TTP-1",
      clientName: "A",
      clientEmail: "a@b.nz",
      issueDate: new Date("2026-10-25T00:00:00Z"),
      jobDate: null,
      lineItems: descriptions.map((description) => ({ description, qty: 1, unitPrice: 10 })),
      notes: null,
      alreadyPaid: null,
      alreadyPaidMethod: null,
      goldCardPercent: null,
      ...extra,
    });
  const withLine = voided(["Email setup", "Weekend surcharge (+10%)", "Round-trip travel"]);
  expectEqual(
    "the surcharge line leaves the job text",
    withLine.jobText.includes("surcharge"),
    false,
  );
  expectEqual("and is remembered", withLine.surcharge, true);
  expectEqual("a dropped surcharge starts the tick off", voided(["Email setup"]).surcharge, false);
  expectEqual(
    "a holiday surcharge line is spotted too",
    voided(["Public holiday surcharge (+25%)"]).surcharge,
    true,
  );
  expectEqual(
    "and an after-hours one, so a weekday re-issue keeps it ticked",
    voided(["After-hours surcharge (+10%)"]).surcharge,
    true,
  );
  // 2026-10-26T00:00Z is Mon 26 Oct in NZ; the job was the Saturday before.
  const lateInvoice = { issueDate: new Date("2026-10-26T00:00:00Z") };
  expectEqual(
    "no job date falls back to the issue day",
    voided([], lateInvoice).jobDate,
    "2026-10-26",
  );
  expectEqual(
    "a stored job date wins, so a Saturday job keeps weekend rates",
    voided([], { ...lateInvoice, jobDate: "2026-10-24" }).jobDate,
    "2026-10-24",
  );
  const prepaid = voided([], { alreadyPaid: 40, alreadyPaidMethod: "Bank" });
  expectEqual(
    "money paid on the day carries over",
    [prepaid.alreadyPaid, prepaid.alreadyPaidMethod],
    [40, "Bank"],
  );
  expectEqual(
    "with the voided invoice's id to move its entry",
    prepaid.invoiceId,
    "0123456789abcdef01234567",
  );
  expectEqual(
    "nothing paid carries no method",
    voided([], { alreadyPaid: 0, alreadyPaidMethod: "Cash" }).alreadyPaidMethod,
    null,
  );

  finish();
}

main();
