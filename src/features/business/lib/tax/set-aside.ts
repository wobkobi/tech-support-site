// src/features/business/lib/tax/set-aside.ts
// Weekly and monthly set-aside targets. Nothing records what has been put aside, so the plan
// assumes the tax on income earned so far is already aside and paces only the tax still to
// come: the full-year bill projected from the year so far, less what has already accrued.

import { DAY_MS } from "@/features/business/lib/financial-year";
import { ledgerDay, roundCents } from "@/features/business/lib/tax/helpers";
import {
  incomeTaxOnBrackets,
  independentEarnerCredit,
} from "@/features/business/lib/tax/income-tax";
import type {
  IetcConfig,
  SetAsideOutlook,
  SetAsidePlan,
  TaxBracket,
  TaxFy,
  TaxYearResult,
} from "@/features/business/lib/tax/types";

/**
 * Spreads the tax still owed from NZ today (or FY start) to FY end, part weeks and months
 * counting as whole. A past FY gets the whole amount as one lump.
 * @param remaining - Dollars still to put aside.
 * @param fy - The financial year.
 * @param now - Current instant.
 * @returns Weeks and months left and the per-week and per-month amounts.
 */
export function setAsideTargets(remaining: number, fy: TaxFy, now: Date): SetAsidePlan {
  const owed = Math.max(0, remaining);
  const today = ledgerDay(now);
  if (today.getTime() >= fy.end.getTime()) {
    return { weeksLeft: 1, monthsLeft: 1, perWeek: roundCents(owed), perMonth: roundCents(owed) };
  }
  const from = today.getTime() < fy.start.getTime() ? fy.start : today;
  const days = Math.round((fy.end.getTime() - from.getTime()) / DAY_MS);
  const weeksLeft = Math.max(1, Math.ceil(days / 7));
  // Both dates are ledger-scale UTC midnights, so UTC parts are NZ calendar parts.
  const monthsLeft = Math.max(
    1,
    fy.end.getUTCFullYear() * 12 +
      fy.end.getUTCMonth() -
      (from.getUTCFullYear() * 12 + from.getUTCMonth()),
  );
  return {
    weeksLeft,
    monthsLeft,
    perWeek: roundCents(owed / weeksLeft),
    perMonth: roundCents(owed / monthsLeft),
  };
}

/** Fewest days of history a projection divides by. */
const MIN_PROJECTION_DAYS = 28;

/** The tax rules a full-year projection needs. */
export interface SetAsideRules {
  brackets: readonly TaxBracket[];
  ietc: IetcConfig;
  /** The year's ACC levy rate as a fraction. */
  accRate: number;
}

/**
 * Projects the whole FY's income tax plus ACC if the rest of the year earns at the pace of
 * the year so far. Income, expenses and km scale with the days elapsed; depreciation, home
 * office, recovery and disposal figures are already full-year amounts, so they stay as they
 * are. Never below the tax already accrued.
 * @param result - computeTaxYear output for the FY (income to date).
 * @param rules - Brackets, IETC and ACC rate for the year.
 * @param fy - The financial year.
 * @param now - Current instant.
 * @returns Projected total to set aside for the year.
 */
export function projectedYearTotal(
  result: TaxYearResult,
  rules: SetAsideRules,
  fy: TaxFy,
  now: Date,
): number {
  const today = ledgerDay(now).getTime();
  if (today < fy.start.getTime() || today >= fy.end.getTime()) return result.totalToSetAside;
  // Today counts as elapsed, since its income is already on the books. The floor keeps one
  // big job in the first days of April from projecting a huge year.
  const elapsedDays = Math.round((today - fy.start.getTime()) / DAY_MS) + 1;
  const fyDays = Math.round((fy.end.getTime() - fy.start.getTime()) / DAY_MS);
  const scale = fyDays / Math.max(elapsedDays, MIN_PROJECTION_DAYS);

  const d = result.deductions;
  const earned = result.income - d.expenses - d.km;
  const fixed =
    result.recoveryIncome -
    (d.depreciation + d.lowValueWriteOffs + d.investmentBoost + d.homeOffice + d.lossOnDisposal);
  const taxable = Math.max(0, earned * scale + fixed);
  const incomeTax = Math.max(
    0,
    incomeTaxOnBrackets(taxable, rules.brackets) - independentEarnerCredit(taxable, rules.ietc),
  );
  const projected = roundCents(incomeTax + taxable * rules.accRate);
  return Math.max(projected, result.totalToSetAside);
}

/**
 * The set-aside plan for a year: the tax on income so far (to have aside already), the
 * projected bill, and the weekly and monthly pace for the part still to come. A year that
 * has ended asks for nothing more.
 * @param result - computeTaxYear output for the FY.
 * @param rules - Brackets, IETC and ACC rate for the year.
 * @param fy - The financial year.
 * @param now - Current instant.
 * @returns The outlook, with the pace for {@link SetAsideOutlook.stillToCome}.
 */
export function setAsideOutlook(
  result: TaxYearResult,
  rules: SetAsideRules,
  fy: TaxFy,
  now: Date,
): SetAsideOutlook {
  const soFar = result.totalToSetAside;
  const projectedTotal = projectedYearTotal(result, rules, fy, now);
  const stillToCome = roundCents(Math.max(0, projectedTotal - soFar));
  return { ...setAsideTargets(stillToCome, fy, now), soFar, projectedTotal, stillToCome };
}
