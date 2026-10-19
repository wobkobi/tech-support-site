// src/features/business/lib/tax/workings.ts
// Pure display maths for the Tax page and overview tax card: bracket split, labels,
// all-FY sum and GST roll-up. The tax maths itself is in income-tax.ts and tax-year.ts.

import { formatNZD } from "@/features/business/lib/business-format";
import { GST_RATE } from "@/features/business/lib/pricing-policy";
import { isGstRegisteredOn } from "@/features/business/lib/tax/gst-basis";
import { roundCents } from "@/features/business/lib/tax/helpers";
import { incomeTaxOnBrackets } from "@/features/business/lib/tax/income-tax";
import type {
  GstStatus,
  TaxBracket,
  TaxYearResult,
  VehicleFuel,
} from "@/features/business/lib/tax/types";
import { VEHICLE_FUEL_LABELS } from "@/shared/lib/settings/field-meta";

/** One NZ income tax band as it applies to a given taxable profit. */
export interface TaxBand {
  /** Lower bound: the previous band's `upTo`, or 0 for the first band. */
  from: number;
  /** Upper bound (inclusive), null for the open top band. */
  upTo: number | null;
  /** Band rate as a fraction (0.105 = 10.5%). */
  rate: number;
  /** Part of the taxable profit that falls in this band. */
  taxedAmount: number;
  /** Tax on that part, rounded to cents. */
  tax: number;
}

/** The figures the overview card and its stat-card breakdown show, summed over one or more FYs. */
export interface TaxEstimateSummary {
  /** Income plus depreciation recovery income. */
  income: number;
  deductions: number;
  taxable: number;
  incomeTax: number;
  ietc: number;
  residualIncomeTax: number;
  acc: number;
  totalToSetAside: number;
  /** True when any summed FY is over the provisional tax threshold. */
  provisionalWarning: boolean;
}

/** GST owed for a registered business: output on income less input on expenses. */
export interface GstRollup {
  outputFromIncome: number;
  inputFromExpenses: number;
  /** Positive = owed to IRD; negative = refund. */
  netToPay: number;
}

/** GST share of a GST-inclusive amount: 15/115 = 3/23 at 15%. */
const GST_FRACTION_OF_INCLUSIVE = GST_RATE / (1 + GST_RATE);

/**
 * Sort order for brackets: ascending upper bound, the open (null) band last.
 * @param a - First bracket.
 * @param b - Second bracket.
 * @returns Negative when `a` comes first.
 */
function byUpperBound(a: TaxBracket, b: TaxBracket): number {
  if (a.upTo === b.upTo) return 0;
  if (a.upTo === null) return 1;
  if (b.upTo === null) return -1;
  return a.upTo - b.upTo;
}

/**
 * Splits a taxable profit across the brackets, one row each (unreached ones at 0). Bands
 * round on their own, so their sum can be a cent or two off; show `incomeTax` as the total.
 * @param taxable - Taxable profit (0 or more).
 * @param brackets - Brackets from settings, in any order.
 * @returns One row per bracket, lowest first.
 */
export function bandBreakdown(taxable: number, brackets: readonly TaxBracket[]): TaxBand[] {
  const ordered = [...brackets].sort(byUpperBound);
  const bands: TaxBand[] = [];
  let from = 0;
  for (const bracket of ordered) {
    const top = bracket.upTo ?? Number.POSITIVE_INFINITY;
    const taxedAmount = Math.max(0, Math.min(taxable, top) - from);
    bands.push({
      from,
      upTo: bracket.upTo,
      rate: bracket.rate,
      taxedAmount: roundCents(taxedAmount),
      tax: roundCents(taxedAmount * bracket.rate),
    });
    if (bracket.upTo === null) break;
    from = bracket.upTo;
  }
  return bands;
}

/**
 * A fractional rate as a percent with up to two decimals: 0.105 > "10.5%", 0.03 > "3%".
 * @param rate - Rate as a fraction.
 * @returns Percent label.
 */
export function formatRatePct(rate: number): string {
  // toFixed first: 0.0146 * 100 is 1.4600000000000002 in floating point.
  return `${Number((rate * 100).toFixed(2))}%`;
}

/**
 * Rate label for a filed year, worked back from saved amounts (acc / taxable) so a later
 * Settings change can't drift it.
 * @param amount - Saved levy or contribution (ACC, KiwiSaver).
 * @param taxable - Saved taxable profit.
 * @returns Percent label, or null when there is no taxable profit to divide by.
 */
export function filedRateLabel(amount: number, taxable: number): string | null {
  if (taxable <= 0) return null;
  return formatRatePct(amount / taxable);
}

/**
 * Whether today's brackets still give a filed year's saved income tax to the cent. Uses
 * incomeTaxOnBrackets, since {@link bandBreakdown} rows can sit a cent or two off.
 * @param result - Saved result of the filed year.
 * @param brackets - Brackets in Settings now.
 * @returns True when the band rows can be shown beside the saved total.
 */
export function bracketsMatchFiled(
  result: Pick<TaxYearResult, "taxable" | "incomeTax">,
  brackets: readonly TaxBracket[],
): boolean {
  const diffCents = Math.round(
    Math.abs(incomeTaxOnBrackets(result.taxable, brackets) - result.incomeTax) * 100,
  );
  return diffCents <= 1;
}

/**
 * Dollars without cents, for bracket edges and thresholds: 15600 > "$15,600".
 * @param amount - Dollar amount.
 * @returns Formatted amount.
 */
export function formatWholeDollars(amount: number): string {
  return formatNZD(Math.round(amount)).replace(/\.00$/, "");
}

/**
 * Dollars that drop only a ".00": 1000 > "$1,000", 999.5 > "$999.50". For limits where
 * rounding would misstate the rule.
 * @param amount - Dollar amount.
 * @returns Formatted amount.
 */
export function formatDollars(amount: number): string {
  return formatNZD(amount).replace(/\.00$/, "");
}

/**
 * Plain-English label for one band: "10.5% on the first $15,600",
 * "17.5% from $15,600 to $53,500", "39% over $180,000".
 * @param band - Band from {@link bandBreakdown}.
 * @returns Label.
 */
export function bandLabel(band: TaxBand): string {
  const pct = formatRatePct(band.rate);
  if (band.upTo === null) return `${pct} over ${formatWholeDollars(band.from)}`;
  if (band.from === 0) return `${pct} on the first ${formatWholeDollars(band.upTo)}`;
  return `${pct} from ${formatWholeDollars(band.from)} to ${formatWholeDollars(band.upTo)}`;
}

/**
 * Readable name for a vehicle fuel type.
 * @param fuel - Fuel key from settings.
 * @returns Lower-case label, e.g. "petrol hybrid".
 */
export function fuelLabel(fuel: VehicleFuel): string {
  // Sentence case of the settings tab's names, so there is one list of fuel types.
  return VEHICLE_FUEL_LABELS[fuel].toLowerCase();
}

/**
 * Adds up finished FY results for the overview; never re-taxes a combined profit, since
 * brackets, IETC and ACC apply per year.
 * @param results - One result per FY in scope.
 * @returns Summed figures, rounded to cents.
 */
export function sumTaxEstimates(results: readonly TaxYearResult[]): TaxEstimateSummary {
  let income = 0;
  let deductions = 0;
  let taxable = 0;
  let incomeTax = 0;
  let ietc = 0;
  let residualIncomeTax = 0;
  let acc = 0;
  let totalToSetAside = 0;
  let provisionalWarning = false;
  for (const r of results) {
    income += r.income + r.recoveryIncome;
    deductions += r.deductions.total;
    taxable += r.taxable;
    incomeTax += r.incomeTax;
    ietc += r.ietc;
    residualIncomeTax += r.residualIncomeTax;
    acc += r.acc;
    totalToSetAside += r.totalToSetAside;
    provisionalWarning = provisionalWarning || r.provisionalWarning;
  }
  return {
    income: roundCents(income),
    deductions: roundCents(deductions),
    taxable: roundCents(taxable),
    incomeTax: roundCents(incomeTax),
    ietc: roundCents(ietc),
    residualIncomeTax: roundCents(residualIncomeTax),
    acc: roundCents(acc),
    totalToSetAside: roundCents(totalToSetAside),
    provisionalWarning,
  };
}

/**
 * GST owed on rows dated from registration: the GST share ({@link GST_RATE}, 3/23 at 15%)
 * of inclusive income less recorded expense GST. Earlier rows count for nothing.
 * @param income - Income rows (ISO ledger dates, GST-inclusive amounts).
 * @param expenses - Expense rows with their recorded GST.
 * @param gst - Registration status and start date.
 * @returns Output, input and net GST, rounded to cents.
 */
export function gstToPay(
  income: readonly { date: string; amount: number }[],
  expenses: readonly { date: string; gstAmount: number }[],
  gst: GstStatus,
): GstRollup {
  let incomeIncl = 0;
  for (const row of income) {
    if (isGstRegisteredOn(row.date, gst)) incomeIncl += row.amount;
  }
  let input = 0;
  for (const row of expenses) {
    if (isGstRegisteredOn(row.date, gst)) input += row.gstAmount;
  }
  const outputFromIncome = roundCents(incomeIncl * GST_FRACTION_OF_INCLUSIVE);
  const inputFromExpenses = roundCents(input);
  return {
    outputFromIncome,
    inputFromExpenses,
    netToPay: roundCents(outputFromIncome - inputFromExpenses),
  };
}
