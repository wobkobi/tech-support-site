// src/features/business/components/TaxPlannerSection.tsx
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { formatNZD } from "@/features/business/lib/business";
import {
  computeTaxPlan,
  GST_REGISTERED,
  DEFAULT_TAX_RATES,
  type TaxRates,
} from "@/features/business/lib/tax-planner";

interface Props {
  /** Display label for the FY being summarised, e.g. "FY 2026-27 (current)". */
  fyLabel: string;
  /** Total income for the FY. */
  income: number;
  /** Total expenses excluding GST for the FY. */
  expensesExcl: number;
  /** GST claimable on FY expenses. */
  gstClaimable: number;
  /**
   * Per-rate overrides for income tax / ACC / KiwiSaver, sourced from the
   * workbook's SETTINGS tab. Falls back to DEFAULT_TAX_RATES when the sheet
   * couldn't be read so the dashboard always renders something sensible.
   */
  rates?: TaxRates;
}

/**
 * Mirrors the user's "Tax Planner (NZ Sole Trader)" sheet on the dashboard:
 * income/expense/profit summary, profit-based set-asides (income tax, ACC,
 * KiwiSaver), weekly/monthly savings targets, and a GST roll-up. Shows only
 * the targets - the "paid" actuals from the Payment log are deliberately
 * omitted so the panel reads as "what should be in your tax account".
 *
 * Defaults to the parent page's selected scope. Server component - no
 * interactivity.
 * @param props - Component props.
 * @param props.fyLabel - Display label for the period.
 * @param props.income - Period income.
 * @param props.expensesExcl - Period expenses excluding GST.
 * @param props.gstClaimable - Period GST claimable.
 * @param props.rates - Per-rate overrides; falls back to DEFAULT_TAX_RATES.
 * @returns The rendered tax planner section.
 */
export function TaxPlannerSection({
  fyLabel,
  income,
  expensesExcl,
  gstClaimable,
  rates = DEFAULT_TAX_RATES,
}: Props): React.ReactElement {
  const plan = computeTaxPlan(income, expensesExcl, gstClaimable, rates);
  const incomeTaxPct = `${(rates.incomeTax * 100).toFixed(0)}%`;
  const accPct = `${(rates.acc * 100).toFixed(2)}%`;
  const kiwiSaverPct = `${(rates.kiwiSaver * 100).toFixed(0)}%`;

  // Tax account total: income tax + ACC, plus GST when registered.
  const gstToReserve = GST_REGISTERED ? Math.max(0, plan.gst.netToPay) : 0;
  const taxAccountTarget = plan.setAsides.incomeTax + plan.setAsides.acc + gstToReserve;

  return (
    <section className={cn("mb-8")}>
      <div className={cn("mb-3 flex flex-wrap items-baseline gap-2")}>
        <h2 className={cn("text-russian-violet text-lg font-bold")}>Tax planner</h2>
        <span className={cn("text-xs font-medium text-slate-500")}>{fyLabel}</span>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          GST_REGISTERED ? "lg:grid-cols-3" : "lg:grid-cols-2",
        )}
      >
        {/* Tax account: income tax + ACC (+ GST when registered). Paid to IRD/ACC. */}
        <div className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm")}>
          <h3 className={cn("text-russian-violet mb-1 text-sm font-bold uppercase tracking-wide")}>
            Tax account
          </h3>
          <p className={cn("mb-3 text-[11px] text-slate-400")}>Reserved for IRD + ACC bills.</p>
          <PlannerRow
            label={`Income tax @ ${incomeTaxPct}`}
            value={formatNZD(plan.setAsides.incomeTax)}
          />
          <PlannerRow label={`ACC (est.) @ ${accPct}`} value={formatNZD(plan.setAsides.acc)} />
          {GST_REGISTERED && (
            <PlannerRow label="GST to pay" value={formatNZD(Math.max(0, plan.gst.netToPay))} />
          )}
          <PlannerRow label="Tax account total" value={formatNZD(taxAccountTarget)} emphasis />
          <div className={cn("mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2")}>
            <SmallStat label="Weekly target" value={formatNZD(taxAccountTarget / 52)} />
            <SmallStat label="Monthly target" value={formatNZD(taxAccountTarget / 12)} />
          </div>
          <p className={cn("mt-2 text-[11px] leading-snug text-slate-400")}>
            This is the amount that should sit in your tax account. The weekly/monthly targets are
            what you'd need to transfer to be on pace by 31 March.
          </p>
        </div>

        {/* KiwiSaver - separate provider, separate reserve. */}
        <div className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm")}>
          <h3 className={cn("text-russian-violet mb-1 text-sm font-bold uppercase tracking-wide")}>
            KiwiSaver
          </h3>
          <p className={cn("mb-3 text-[11px] text-slate-400")}>
            Voluntary - paid to your KiwiSaver provider, not IRD.
          </p>
          <PlannerRow
            label={`KiwiSaver @ ${kiwiSaverPct}`}
            value={formatNZD(plan.setAsides.kiwiSaver)}
            emphasis
          />
          <div className={cn("mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2")}>
            <SmallStat label="Weekly target" value={formatNZD(plan.setAsides.kiwiSaver / 52)} />
            <SmallStat label="Monthly target" value={formatNZD(plan.setAsides.kiwiSaver / 12)} />
          </div>
          <p className={cn("mt-2 text-[11px] leading-snug text-slate-400")}>
            Aim for at least $1,042.86/year to capture the full $521 govt contribution match.
            Profit-based target ({formatNZD(plan.setAsides.kiwiSaver)}) is just the rate × profit.
          </p>
        </div>

        {/* GST - hidden until GST_REGISTERED is flipped to true in tax-planner.ts */}
        {GST_REGISTERED && (
          <div className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm")}>
            <h3
              className={cn("text-russian-violet mb-3 text-sm font-bold uppercase tracking-wide")}
            >
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
            <p className={cn("mt-2 text-[11px] leading-snug text-slate-400")}>
              Output GST is calculated as 3/23 of GST-inclusive income.
            </p>
          </div>
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
        "border-b border-slate-100 py-1.5 last:border-0",
        emphasis && "border-t border-slate-200 pt-2 font-bold",
      )}
    >
      <div className={cn("flex items-baseline justify-between gap-3")}>
        <span className={cn("text-sm", muted ? "text-slate-500" : "text-slate-700")}>{label}</span>
        <span
          className={cn(
            "font-mono text-sm",
            emphasis
              ? "text-russian-violet text-base"
              : muted
                ? "text-slate-500"
                : "text-slate-800",
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
      <p className={cn("text-[10px] uppercase tracking-wide text-slate-400")}>{label}</p>
      <p className={cn("text-russian-violet font-mono text-sm font-bold")}>{value}</p>
    </div>
  );
}
