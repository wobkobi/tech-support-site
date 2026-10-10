// src/features/business/components/tax/TaxSummaryCard.tsx
// Compact tax card on the business overview: what to set aside for the selected scope,
// the weekly pace for the current FY, GST to pay when registered, and a link to the Tax
// page for the workings. Server-safe.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { formatNZD } from "@/features/business/lib/business";
import type { GstRollup, TaxEstimateSummary } from "@/features/business/lib/tax/workings";
import { Notice } from "@/shared/components/Notice";
import { formatDateSlash } from "@/shared/lib/date-format";
import type React from "react";

/** Props for {@link TaxSummaryCard}. */
interface TaxSummaryCardProps {
  /** Scope label, e.g. "FY 2026-27" or "All time". */
  scopeLabel: string;
  /** True for the all-time scope (the figures are every FY added up). */
  isAllTime: boolean;
  /** Summed estimate for the scope, or null when there are no FYs. */
  estimate: TaxEstimateSummary | null;
  /** Weekly pace for the current FY; null for a past FY or all time. */
  targets: { weeksLeft: number; perWeek: number } | null;
  /** GST roll-up when registered, else null. */
  gst: GstRollup | null;
  /** ISO date GST registration took effect, or null for "from business start". */
  gstRegisteredFrom: string | null;
  /** Tax page link for the same scope. */
  href: string;
}

/**
 * Renders the overview's tax card. For all time the taxable figure is each FY's taxable
 * profit added up, and a loss year counts as $0 in that sum, so it is never described as
 * one profit figure.
 * @param props - Component props.
 * @param props.scopeLabel - Scope label.
 * @param props.isAllTime - True for the all-time scope.
 * @param props.estimate - Summed estimate, or null when there are no FYs.
 * @param props.targets - Weekly pace for the current FY, or null.
 * @param props.gst - GST roll-up when registered, else null.
 * @param props.gstRegisteredFrom - ISO date GST registration took effect, or null.
 * @param props.href - Tax page link for the same scope.
 * @returns The card.
 */
export function TaxSummaryCard({
  scopeLabel,
  isAllTime,
  estimate,
  targets,
  gst,
  gstRegisteredFrom,
  href,
}: TaxSummaryCardProps): React.ReactElement {
  return (
    <Card className="mb-8">
      <CardHeader
        title="Tax to set aside"
        description={isAllTime ? `${scopeLabel}: every financial year added up` : scopeLabel}
        actions={
          <AdminButton href={href} variant="secondary">
            Open tax page
          </AdminButton>
        }
      />
      {estimate ? (
        <>
          <p className="text-3xl font-semibold tracking-tight text-amber-700 tabular-nums">
            {formatNZD(estimate.totalToSetAside)}
          </p>
          <p className="mt-1 text-[0.9375rem] text-admin-text-secondary">
            Income tax {formatNZD(estimate.residualIncomeTax)} plus ACC {formatNZD(estimate.acc)},
            {isAllTime
              ? ` on each year's taxable profit added up (${formatNZD(estimate.taxable)}).`
              : ` on a taxable profit of ${formatNZD(estimate.taxable)}.`}
          </p>
          {targets && (
            <p className="mt-1 text-[0.9375rem] text-admin-text-secondary">
              Put aside about {formatNZD(targets.perWeek)} a week to be on pace by 31 March (
              {targets.weeksLeft} {targets.weeksLeft === 1 ? "week" : "weeks"} left).
            </p>
          )}
          {estimate.provisionalWarning && (
            <Notice tone="warn" className="mt-4">
              {isAllTime
                ? "One of these years is over the provisional tax threshold. The Tax page shows which."
                : "Income tax is over the provisional tax threshold, so IRD will expect provisional tax next year. The Tax page has the details."}
            </Notice>
          )}
        </>
      ) : (
        <p className="text-[0.9375rem] text-admin-muted">
          No financial years yet. Set the business start date in Settings to see the estimate.
        </p>
      )}
      {gst && (
        <div className="mt-4 border-t border-admin-border pt-3">
          <p className="text-[0.9375rem] font-bold text-admin-text">
            {gst.netToPay >= 0 ? "GST to pay" : "GST refund"}: {formatNZD(Math.abs(gst.netToPay))}
          </p>
          <p className="mt-0.5 text-sm text-admin-muted">
            3/23 of income
            {gstRegisteredFrom
              ? ` from ${formatDateSlash(gstRegisteredFrom, { utc: true })}`
              : ""}{" "}
            ({formatNZD(gst.outputFromIncome)}) less GST on expenses (
            {formatNZD(gst.inputFromExpenses)}). Not part of the figure above.
          </p>
        </div>
      )}
    </Card>
  );
}
