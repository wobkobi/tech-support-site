// src/features/business/lib/tax/home-office.ts
// IRD square-metre home office method: office m2 x m2 rate, plus the office's floor-area
// share of premises costs (mortgage interest or rent, and rates).

import { roundCents } from "@/features/business/lib/tax/helpers";
import type { HomeOfficeClaim, TaxYearRecordInput } from "@/features/business/lib/tax/types";

/**
 * Home office claim for one FY. Missing areas count as 0; the total sums the rounded parts.
 * @param input - The FY's TaxYear figures (areas, m2 rate, premises costs).
 * @returns Office share of the house, both parts and the total claim.
 */
export function homeOfficeClaim(input: TaxYearRecordInput): HomeOfficeClaim {
  const office = input.officeSqm !== null && input.officeSqm > 0 ? input.officeSqm : 0;
  const house = input.houseSqm !== null && input.houseSqm > 0 ? input.houseSqm : 0;
  const officePct = office > 0 && house > 0 ? Math.min(1, office / house) : 0;
  const premises = (input.mortgageInterestOrRent ?? 0) + (input.rates ?? 0);
  const sqmPart = roundCents(office * input.sqmRate);
  const proportionalPart = roundCents(officePct * premises);
  return {
    officePct,
    sqmPart,
    proportionalPart,
    amount: roundCents(sqmPart + proportionalPart),
  };
}
