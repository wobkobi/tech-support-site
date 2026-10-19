// src/features/business/lib/tax/income-tax.ts
// NZ progressive income tax and the IETC. Defaults (from 1 April 2025) only seed settings.tax.

import { roundCents } from "@/features/business/lib/tax/helpers";
import type { IetcConfig, TaxBracket } from "@/features/business/lib/tax/types";

/** Individual income tax brackets from 1 April 2025. */
export const DEFAULT_TAX_BRACKETS: readonly TaxBracket[] = [
  { upTo: 15_600, rate: 0.105 },
  { upTo: 53_500, rate: 0.175 },
  { upTo: 78_100, rate: 0.3 },
  { upTo: 180_000, rate: 0.33 },
  { upTo: null, rate: 0.39 },
];

/** IETC from 1 April 2025: $520 for $24,000-$66,000, abating 13c per $ to nil at $70,000. */
export const DEFAULT_IETC: IetcConfig = {
  enabled: true,
  annual: 520,
  from: 24_000,
  fullTo: 66_000,
  cutoff: 70_000,
  abatementPerDollar: 0.13,
};

/**
 * Income tax on progressive brackets, each rate applying to its slice; bands sorted by `upTo`, null last.
 * @param taxable - Taxable income in dollars.
 * @param brackets - The bands.
 * @returns Tax in dollars, rounded to cents (0 for zero or negative income).
 */
export function incomeTaxOnBrackets(taxable: number, brackets: readonly TaxBracket[]): number {
  if (!(taxable > 0)) return 0;
  const ordered = [...brackets].sort(
    (a, b) => (a.upTo ?? Number.POSITIVE_INFINITY) - (b.upTo ?? Number.POSITIVE_INFINITY),
  );
  let tax = 0;
  let lower = 0;
  for (const band of ordered) {
    const upper = band.upTo ?? Number.POSITIVE_INFINITY;
    tax += Math.max(0, Math.min(taxable, upper) - lower) * band.rate;
    if (taxable <= upper) break;
    lower = upper;
  }
  return roundCents(tax);
}

/**
 * Independent earner tax credit for a year's income.
 * @param income - Income the credit is tested on (taxable business income).
 * @param cfg - IETC settings.
 * @returns The credit in dollars, rounded to cents.
 */
export function independentEarnerCredit(income: number, cfg: IetcConfig): number {
  if (!cfg.enabled || income < cfg.from || income > cfg.cutoff) return 0;
  if (income <= cfg.fullTo) return roundCents(cfg.annual);
  return roundCents(Math.max(0, cfg.annual - (income - cfg.fullTo) * cfg.abatementPerDollar));
}
