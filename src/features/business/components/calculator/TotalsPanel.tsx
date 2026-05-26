"use client";

import type React from "react";
import { cn } from "@/shared/lib/cn";
import {
  formatNZD,
  minsToHoursLabel,
  billableMins,
  type calcJobTotal,
} from "@/features/business/lib/business";
import type { ActivePromo } from "@/features/business/lib/promos";
import type { RateConfig } from "@/features/business/types/business";

type JobTotals = ReturnType<typeof calcJobTotal>;

interface Props {
  durationMins: number;
  hourlyRate: RateConfig | null;
  totals: JobTotals;
  activePromo: ActivePromo | null;
}

/**
 * Right-rail live job summary: time charge, tasks, promo (under labour lines),
 * parts, travel, subtotal, and the bold final total. Pure display.
 * @param props - Component props.
 * @param props.durationMins - Job duration; drives time-charge row visibility.
 * @param props.hourlyRate - Active hourly rate; drives label + row visibility.
 * @param props.totals - Output of calcJobTotal.
 * @param props.activePromo - Promo applied to this job, or null.
 * @returns Summary card element.
 */
export function TotalsPanel({
  durationMins,
  hourlyRate,
  totals,
  activePromo,
}: Props): React.ReactElement {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <h2 className={cn("text-russian-violet mb-4 text-sm font-semibold")}>Summary</h2>
      <div className={cn("space-y-2 text-sm")}>
        {durationMins > 0 && hourlyRate && hourlyRate.ratePerHour !== null && (
          <div className={cn("flex justify-between text-slate-600")}>
            <span>
              Time ({minsToHoursLabel(billableMins(durationMins))} @{" "}
              {formatNZD(hourlyRate.ratePerHour)}/hr)
            </span>
            <span>{formatNZD(totals.timeCharge)}</span>
          </div>
        )}
        {totals.tasksTotal > 0 && (
          <div className={cn("flex justify-between text-slate-600")}>
            <span>Tasks</span>
            <span>{formatNZD(totals.tasksTotal)}</span>
          </div>
        )}
        {/* Promo sits immediately under the labor lines so it's visually
            attached to what it discounts. Travel + parts are appended
            AFTER, at full price - never touched by the promo. */}
        {totals.promoDiscount > 0 && activePromo && (
          <div className={cn("flex justify-between text-amber-700")}>
            <span>Promo: {activePromo.title}</span>
            <span>-{formatNZD(totals.promoDiscount)}</span>
          </div>
        )}
        {totals.partsTotal > 0 && (
          <div className={cn("flex justify-between text-slate-600")}>
            <span>Parts</span>
            <span>{formatNZD(totals.partsTotal)}</span>
          </div>
        )}
        {totals.travelTotal > 0 && (
          <div className={cn("flex justify-between text-slate-600")}>
            <span>Travel</span>
            <span>{formatNZD(totals.travelTotal)}</span>
          </div>
        )}
        <div
          className={cn(
            "flex justify-between border-t border-slate-100 pt-2 font-medium text-slate-700",
          )}
        >
          <span>Subtotal</span>
          <span>{formatNZD(totals.subtotal - totals.promoDiscount)}</span>
        </div>
        {totals.gstAmount > 0 && (
          <div className={cn("flex items-center justify-between text-slate-500")}>
            <span>Includes GST</span>
            <span>{formatNZD(totals.gstAmount)}</span>
          </div>
        )}
        <div
          className={cn(
            "text-russian-violet flex justify-between border-t border-slate-200 pt-2 text-base font-extrabold",
          )}
        >
          <span>Total</span>
          <span>{formatNZD(totals.total)}</span>
        </div>
      </div>
    </div>
  );
}
