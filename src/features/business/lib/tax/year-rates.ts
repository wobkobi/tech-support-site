// src/features/business/lib/tax/year-rates.ts
// IRD's yearly home-office sqm and vehicle km rates, published after each year ends, so a
// missing year borrows the latest earlier one. Only seeds a TaxYear record; maths reads the record.

import type { IrdYearRates } from "@/features/business/lib/tax/types";

/** 2025-26 rates (IRD home office and vehicle expense pages). */
const RATES_2025_26: IrdYearRates = {
  sqmRate: 57.3,
  km: {
    petrol: { tier1: 1.2, tier2: 0.37 },
    diesel: { tier1: 1.3, tier2: 0.38 },
    "petrol-hybrid": { tier1: 0.9, tier2: 0.24 },
    electric: { tier1: 1.22, tier2: 0.23 },
  },
};

/** Published rates by FY key ("2025-26"). Add a year when IRD publishes it. */
const IRD_YEAR_RATES: Record<string, IrdYearRates> = {
  "2025-26": RATES_2025_26,
};

/**
 * Rates for a tax year: exact, else the latest earlier year, else the earliest known.
 * FY keys sort as strings since they lead with the start year.
 * @param fyKey - FY key, e.g. "2026-27".
 * @returns The IRD rates to use.
 */
export function irdRatesFor(fyKey: string): IrdYearRates {
  const exact = IRD_YEAR_RATES[fyKey];
  if (exact) return exact;
  const keys = Object.keys(IRD_YEAR_RATES).sort();
  const earlier = keys.filter((k) => k < fyKey);
  const pick = earlier[earlier.length - 1] ?? keys[0];
  return (pick === undefined ? undefined : IRD_YEAR_RATES[pick]) ?? RATES_2025_26;
}
