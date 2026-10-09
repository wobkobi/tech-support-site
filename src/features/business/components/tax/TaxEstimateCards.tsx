// src/features/business/components/tax/TaxEstimateCards.tsx
// Headline figures for one FY on the Tax page: income, deductions, profit, tax to set
// aside, and the weekly and monthly amounts that keep pace with 31 March for the weeks
// actually left. A past FY shows "Year ended" instead of targets. Server-safe.

import { StatCard } from "@/features/admin/components/ui/StatCard";
import { formatNZD } from "@/features/business/lib/business";
import type { TaxYearResult } from "@/features/business/lib/tax";
import type React from "react";

/** Props for {@link TaxEstimateCards}. */
interface TaxEstimateCardsProps {
  /** computeTaxYear output for the FY. */
  result: TaxYearResult;
  /** setAsideTargets output for the FY's total to set aside. */
  targets: { weeksLeft: number; monthsLeft: number; perWeek: number; perMonth: number };
  /** True when the FY is still running. */
  current: boolean;
}

/**
 * Counts with the right noun: "1 week", "3 weeks".
 * @param n - Count.
 * @param word - Singular noun.
 * @returns Phrase.
 */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Renders the estimate's stat cards.
 * @param props - Component props.
 * @param props.result - computeTaxYear output for the FY.
 * @param props.targets - Set-aside targets for the weeks and months left.
 * @param props.current - Whether the FY is still running.
 * @returns The card grid.
 */
export function TaxEstimateCards({
  result,
  targets,
  current,
}: TaxEstimateCardsProps): React.ReactElement {
  const income = result.income + result.recoveryIncome;
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatCard
        label="Income"
        value={formatNZD(income)}
        tone="success"
        sub={
          result.recoveryIncome > 0
            ? `Includes ${formatNZD(result.recoveryIncome)} depreciation recovered on a sale`
            : undefined
        }
      />
      <StatCard label="Deductions" value={formatNZD(result.deductions.total)} />
      <StatCard
        label="Profit"
        value={formatNZD(result.profit)}
        tone={result.profit >= 0 ? "success" : "critical"}
        sub={result.profit < 0 ? "A loss, so no income tax" : undefined}
      />
      <StatCard
        label="Tax to set aside"
        value={formatNZD(result.totalToSetAside)}
        tone="warning"
        sub="Income tax after credits, plus ACC"
      />
      {current ? (
        <>
          <StatCard
            label="Set aside each week"
            value={formatNZD(targets.perWeek)}
            tone="violet"
            sub={`${plural(targets.weeksLeft, "week")} left to 31 March`}
          />
          <StatCard
            label="Set aside each month"
            value={formatNZD(targets.perMonth)}
            tone="violet"
            sub={`${plural(targets.monthsLeft, "month")} left`}
          />
        </>
      ) : (
        <StatCard
          label="Set-aside targets"
          value="Year ended"
          sub="The full amount is due. Your accountant can confirm the date."
        />
      )}
    </div>
  );
}
