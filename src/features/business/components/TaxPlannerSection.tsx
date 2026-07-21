// src/features/business/components/TaxPlannerSection.tsx
/**
 * @description "Tax Planner (NZ Sole Trader)" dashboard panel. Summarises FY
 * income, expenses, and profit, then shows profit-based set-asides (income tax,
 * ACC, KiwiSaver), weekly/monthly targets, and a GST roll-up. Targets only -
 * Payment-log actuals are omitted. Server component.
 */
import { Card } from "@/features/admin/components/ui/Card";
import { formatNZD } from "@/features/business/lib/business";
import {
  computeTaxPlan,
  DEFAULT_TAX_RATES,
  type TaxRates,
} from "@/features/business/lib/tax-planner";
import { cn } from "@/shared/lib/cn";
import type React from "react";

interface Props {
  /** Display label for the FY being summarised, e.g. "FY 2026-27 (current)". */
  fyLabel: string;
  /** Total income for the FY. */
  income: number;
  /** Total expenses excluding GST for the FY. */
  expensesExcl: number;
  /** GST claimable on FY expenses. */
  gstClaimable: number;
  /** Whether GST is registered (live pricing setting); gates the GST column. */
  gstRegistered: boolean;
  /**
   * Per-rate overrides for income tax / ACC / KiwiSaver, sourced from the
   * workbook's SETTINGS tab. Falls back to {@link DEFAULT_TAX_RATES} when the sheet
   * couldn't be read so the dashboard always renders something sensible.
   */
  rates?: TaxRates;
}

/**
 * "Tax Planner (NZ Sole Trader)" dashboard panel: income/expense/profit summary,
 * profit-based set-asides (income tax, ACC, KiwiSaver), weekly/monthly targets,
 * GST roll-up. Targets only; the Payment log "paid" actuals are omitted so the
 * panel reads as "what should be in your tax account". Server component.
 * @param props - Component props.
 * @param props.fyLabel - Display label for the period.
 * @param props.income - Period income.
 * @param props.expensesExcl - Period expenses excluding GST.
 * @param props.gstClaimable - Period GST claimable.
 * @param props.gstRegistered - Whether GST is registered (gates the GST column).
 * @param props.rates - Per-rate overrides; falls back to DEFAULT_TAX_RATES.
 * @returns The rendered tax planner section.
 */
export function TaxPlannerSection({
  fyLabel,
  income,
  expensesExcl,
  gstClaimable,
  gstRegistered,
  rates = DEFAULT_TAX_RATES,
}: Props): React.ReactElement {
  const plan = computeTaxPlan(income, expensesExcl, gstClaimable, rates);
  const incomeTaxPct = `${(rates.incomeTax * 100).toFixed(0)}%`;
  const accPct = `${(rates.acc * 100).toFixed(2)}%`;
  const kiwiSaverPct = `${(rates.kiwiSaver * 100).toFixed(0)}%`;

  // Tax account total: income tax + ACC, plus GST when registered.
  const gstToReserve = gstRegistered ? Math.max(0, plan.gst.netToPay) : 0;
  const taxAccountTarget = plan.setAsides.incomeTax + plan.setAsides.acc + gstToReserve;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-bold text-russian-violet">Tax planner</h2>
        <span className="text-xs font-medium text-admin-muted">{fyLabel}</span>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          gstRegistered ? "lg:grid-cols-3" : "lg:grid-cols-2",
        )}
      >
        {/* Tax account: income tax + ACC (+ GST when registered). Paid to IRD/ACC. */}
        <Card>
          <h3 className="mb-1 text-sm font-bold tracking-wide text-russian-violet uppercase">
            Tax account
          </h3>
          <p className="mb-3 text-[11px] text-admin-faint">Reserved for IRD + ACC bills.</p>
          <PlannerRow
            label={`Income tax @ ${incomeTaxPct}`}
            value={formatNZD(plan.setAsides.incomeTax)}
          />
          <PlannerRow label={`ACC (est.) @ ${accPct}`} value={formatNZD(plan.setAsides.acc)} />
          {gstRegistered && (
            <PlannerRow label="GST to pay" value={formatNZD(Math.max(0, plan.gst.netToPay))} />
          )}
          <PlannerRow label="Tax account total" value={formatNZD(taxAccountTarget)} emphasis />
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-admin-border pt-2">
            <SmallStat label="Weekly target" value={formatNZD(taxAccountTarget / 52)} />
            <SmallStat label="Monthly target" value={formatNZD(taxAccountTarget / 12)} />
          </div>
          <p className="mt-2 text-[11px] leading-snug text-admin-faint">
            This is the amount that should sit in your tax account. The weekly/monthly targets are
            what you'd need to transfer to be on pace by 31 March.
          </p>
        </Card>

        {/* KiwiSaver - separate provider, separate reserve. */}
        <Card>
          <h3 className="mb-1 text-sm font-bold tracking-wide text-russian-violet uppercase">
            KiwiSaver
          </h3>
          <p className="mb-3 text-[11px] text-admin-faint">
            Voluntary - paid to your KiwiSaver provider, not IRD.
          </p>
          <PlannerRow
            label={`KiwiSaver @ ${kiwiSaverPct}`}
            value={formatNZD(plan.setAsides.kiwiSaver)}
            emphasis
          />
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-admin-border pt-2">
            <SmallStat label="Weekly target" value={formatNZD(plan.setAsides.kiwiSaver / 52)} />
            <SmallStat label="Monthly target" value={formatNZD(plan.setAsides.kiwiSaver / 12)} />
          </div>
          <p className="mt-2 text-[11px] leading-snug text-admin-faint">
            Aim for at least $1,042.86/year to capture the full ~$260.72 govt contribution (25c per
            $1, since 1 July 2025). Profit-based target ({formatNZD(plan.setAsides.kiwiSaver)}) is
            just the rate × profit.
          </p>
        </Card>

        {/* GST - shown only when gstRegistered (live pricing setting) is true. */}
        {gstRegistered && (
          <Card>
            <h3 className="mb-3 text-sm font-bold tracking-wide text-russian-violet uppercase">
              GST
            </h3>
            <PlannerRow
              label="Output GST from income (3/23)"
              value={formatNZD(plan.gst.outputFromIncome)}
            />
            <PlannerRow
              label="Input GST from expenses"
              value={formatNZD(plan.gst.inputFromExpenses)}
              muted
            />
            <PlannerRow
              label={plan.gst.netToPay >= 0 ? "GST to pay" : "GST refund"}
              value={formatNZD(Math.abs(plan.gst.netToPay))}
              emphasis
            />
            <p className="mt-2 text-[11px] leading-snug text-admin-faint">
              Output GST is calculated as 3/23 of GST-inclusive income.
            </p>
          </Card>
        )}
      </div>
    </section>
  );
}

/**
 * One label/value row in a planner card.
 * @param props - Component props.
 * @param props.label - Left-side label.
 * @param props.value - Right-side pre-formatted value.
 * @param props.emphasis - Bold/larger styling for totals.
 * @param props.muted - Lighter styling for derivable rows.
 * @returns A single planner row.
 */
function PlannerRow({
  label,
  value,
  emphasis,
  muted,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "border-b border-admin-border py-1.5 last:border-0",
        emphasis && "border-t border-admin-border pt-2 font-bold",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("text-sm", muted ? "text-admin-muted" : "text-admin-text")}>
          {label}
        </span>
        <span
          className={cn(
            "font-mono text-sm",
            emphasis
              ? "text-base text-russian-violet"
              : muted
                ? "text-admin-muted"
                : "text-admin-text",
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

/**
 * Small label/value cell used to show weekly/monthly savings targets inside a
 * planner card.
 * @param props - Component props.
 * @param props.label - Caption rendered above the value.
 * @param props.value - Pre-formatted value text.
 * @returns A single small stat cell.
 */
function SmallStat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <p className="text-[10px] tracking-wide text-admin-faint uppercase">{label}</p>
      <p className="font-mono text-sm font-bold text-russian-violet">{value}</p>
    </div>
  );
}
