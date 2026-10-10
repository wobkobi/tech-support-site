// src/features/business/components/tax/TaxEstimateCards.tsx
// Headline figures for one FY on the Tax page. TaxEstimateCards is the summary strip
// (income, deductions, profit, tax to set aside); SetAsideCard is the side card with the
// total and the weekly and monthly amounts that keep pace with 31 March for the weeks
// actually left (a past FY shows "Year ended" instead of targets). Server-safe.

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { StatStrip } from "@/features/admin/components/ui/StatStrip";
import { formatNZD } from "@/features/business/lib/business";
import type { TaxYearResult } from "@/features/business/lib/tax";
import type React from "react";

/** Props for {@link TaxEstimateCards}. */
interface TaxEstimateCardsProps {
  /** computeTaxYear output for the FY. */
  result: TaxYearResult;
  /** FY display label, e.g. "2026-27", for the strip's accessible name. */
  fyLabel: string;
}

/** Props for {@link SetAsideCard}. */
interface SetAsideCardProps {
  /** computeTaxYear output for the FY. */
  result: TaxYearResult;
  /** setAsideTargets output for the FY's total to set aside. */
  targets: { weeksLeft: number; monthsLeft: number; perWeek: number; perMonth: number };
  /** True when the FY is still running. */
  current: boolean;
  /** FY display label. */
  fyLabel: string;
  /** Extra classes, to hide the phone or desktop copy. */
  className?: string;
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
 * Renders the summary strip: income, deductions, profit and tax to set aside.
 * @param props - Component props.
 * @param props.result - computeTaxYear output for the FY.
 * @param props.fyLabel - FY display label.
 * @returns The strip.
 */
export function TaxEstimateCards({ result, fyLabel }: TaxEstimateCardsProps): React.ReactElement {
  const income = result.income + result.recoveryIncome;
  return (
    <StatStrip label={`${fyLabel} estimate`} className="mb-6 grid-cols-2 lg:grid-cols-4">
      <StatCard
        size="lg"
        label="Income"
        value={formatNZD(income)}
        tone="success"
        sub={
          result.recoveryIncome > 0
            ? `Includes ${formatNZD(result.recoveryIncome)} depreciation recovered on a sale`
            : undefined
        }
      />
      <StatCard size="lg" label="Deductions" value={formatNZD(result.deductions.total)} />
      <StatCard
        size="lg"
        label="Profit"
        value={formatNZD(result.profit)}
        tone={result.profit >= 0 ? "success" : "critical"}
        sub={result.profit < 0 ? "A loss, so no income tax" : undefined}
      />
      <StatCard
        size="lg"
        label="Tax to set aside"
        value={formatNZD(result.totalToSetAside)}
        tone="warning"
        sub="Income tax after credits, plus ACC"
      />
    </StatStrip>
  );
}

/**
 * Renders the set-aside card: the year's total, then what to put away each week and month
 * to reach it by 31 March.
 * @param props - Component props.
 * @param props.result - computeTaxYear output for the FY.
 * @param props.targets - Set-aside targets for the weeks and months left.
 * @param props.current - Whether the FY is still running.
 * @param props.fyLabel - FY display label.
 * @param props.className - Extra classes for the card.
 * @returns The card.
 */
export function SetAsideCard({
  result,
  targets,
  current,
  fyLabel,
  className,
}: SetAsideCardProps): React.ReactElement {
  return (
    <Card className={className}>
      <CardHeader title="Set aside" />
      <p className="text-sm text-admin-muted">Total for {fyLabel}</p>
      <p className="mt-0.5 text-[1.875rem] leading-tight font-semibold tracking-tight text-amber-700 tabular-nums">
        {formatNZD(result.totalToSetAside)}
      </p>
      {current ? (
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-t border-admin-border pt-4 text-[0.9375rem]">
          <dt className="text-admin-text-secondary">Each week</dt>
          <dd className="text-right font-semibold text-admin-text tabular-nums">
            {formatNZD(targets.perWeek)}
          </dd>
          <dt className="text-admin-text-secondary">Each month</dt>
          <dd className="text-right font-semibold text-admin-text tabular-nums">
            {formatNZD(targets.perMonth)}
          </dd>
          <dt className="text-admin-text-secondary">Left to 31 March</dt>
          <dd className="text-right text-admin-text tabular-nums">
            {plural(targets.weeksLeft, "week")}, {plural(targets.monthsLeft, "month")}
          </dd>
        </dl>
      ) : (
        <p className="mt-4 border-t border-admin-border pt-4 text-[0.9375rem] text-admin-text-secondary">
          Year ended. The full amount is due. Your accountant can confirm the date.
        </p>
      )}
    </Card>
  );
}
