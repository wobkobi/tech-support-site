// src/features/business/lib/tax/set-aside.ts
// Weekly and monthly set-aside targets: what is still owed spread over the time left
// in the FY, rather than a flat /52 and /12 that ignores the weeks already gone.

import { DAY_MS } from "@/features/business/lib/financial-year";
import { ledgerDay, roundCents } from "@/features/business/lib/tax/helpers";
import type { SetAsidePlan, TaxFy } from "@/features/business/lib/tax/types";

/**
 * Spreads the tax still to put aside over the rest of the FY. Counts from NZ
 * today (or the FY start, for a year not begun yet) to the FY end; a part week
 * or part month counts as a whole one, so the targets finish on time. A past FY
 * has no time left, so the whole amount is due as one lump.
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
