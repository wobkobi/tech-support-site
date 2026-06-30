// src/features/business/lib/tax-planner.ts
/**
 * @description NZ sole-trader tax planner calculations - mirrors the user's
 * `Tax Planner` spreadsheet so the dashboard reserve numbers reconcile with
 * what's in the per-FY workbook.
 *
 * Rates and weekly transfer amounts are now sourced from each FY workbook's
 * SETTINGS tab (see `readPlannerConfig` in tax-settings.ts). The defaults
 * below are only used when the sheet is unavailable - they should match
 * whatever the active workbook has so the dashboard stays consistent.
 */

/**
 * Rates used by the planner. The first three come from `SETTINGS!B13:B15`
 * in the per-FY workbook; the GST output ratio is a fixed NZ constant.
 */
export interface TaxRates {
  /** Flat income tax provision applied to profit. */
  incomeTax: number;
  /** ACC levy estimate. */
  acc: number;
  /** Voluntary KiwiSaver contribution rate. */
  kiwiSaver: number;
  /** GST output rate as a fraction of the GST-inclusive amount: 15/115 = 3/23. */
  gstOutOfInclusive: number;
}

/**
 * Defaults for when SETTINGS can't be read (sheet unavailable, env missing,
 * read error). Match the values currently in the user's workbook so the
 * dashboard degrades gracefully rather than showing wildly different numbers.
 */
export const DEFAULT_TAX_RATES: TaxRates = {
  incomeTax: 0.2,
  acc: 0.0146,
  kiwiSaver: 0.12,
  gstOutOfInclusive: 3 / 23,
};

/** Output of {@link computeTaxPlan} covering set-asides, savings targets, and GST. */
export interface TaxPlan {
  income: number;
  expensesExcl: number;
  profit: number;
  setAsides: {
    incomeTax: number;
    acc: number;
    kiwiSaver: number;
    total: number;
  };
  savingsTargets: {
    weekly: number;
    monthly: number;
  };
  gst: {
    outputFromIncome: number;
    /** GST claimable on GST-inclusive expenses (mirrors what the dashboard already shows). */
    inputFromExpenses: number;
    /** Positive = owe IRD; negative = refund. */
    netToPay: number;
  };
}

/**
 * Builds the full tax plan from income/expense totals + GST claimable.
 * Set-asides are computed on PROFIT (income - expenses excl. GST), matching
 * the spreadsheet model; savings targets divide across 52 weeks / 12 months.
 * @param income - Total income for the period (e.g. current FY).
 * @param expensesExcl - Total expenses excluding GST for the period.
 * @param gstClaimable - GST input claimable on those expenses.
 * @param rates - Per-rate overrides; defaults to DEFAULT_TAX_RATES.
 * @returns Computed plan.
 */
export function computeTaxPlan(
  income: number,
  expensesExcl: number,
  gstClaimable: number,
  rates: TaxRates = DEFAULT_TAX_RATES,
): TaxPlan {
  const profit = income - expensesExcl;
  const incomeTax = round2(profit * rates.incomeTax);
  const acc = round2(profit * rates.acc);
  const kiwiSaver = round2(profit * rates.kiwiSaver);
  const total = round2(incomeTax + acc + kiwiSaver);

  const outputFromIncome = round2(income * rates.gstOutOfInclusive);
  const netToPay = round2(outputFromIncome - gstClaimable);

  return {
    income: round2(income),
    expensesExcl: round2(expensesExcl),
    profit: round2(profit),
    setAsides: { incomeTax, acc, kiwiSaver, total },
    savingsTargets: {
      weekly: round2(total / 52),
      monthly: round2(total / 12),
    },
    gst: {
      outputFromIncome,
      inputFromExpenses: round2(gstClaimable),
      netToPay,
    },
  };
}

/**
 * Rounds to 2 decimal places.
 * @param n - Value to round.
 * @returns Rounded value.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
