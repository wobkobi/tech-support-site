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
  gst: boolean;
  onGstChange: (value: boolean) => void;
}

/**
 * Live job summary card on the right rail of the calculator: time charge,
 * tasks, promo (under labor lines so it's visually attached to what it
 * discounts), parts, travel, subtotal (already net of promo), GST toggle,
 * and the bold final total. Pure display - state lives in the parent.
 * @param props - Component props.
 * @param props.durationMins - Job duration in minutes (drives the time-charge row visibility).
 * @param props.hourlyRate - Active hourly rate (drives the time-charge row visibility and label).
 * @param props.totals - Output of calcJobTotal: per-bucket subtotals plus subtotal/gst/total.
 * @param props.activePromo - Promo applied to this job, or null when none.
 * @param props.gst - Whether GST is included; checkbox value.
 * @param props.onGstChange - Setter invoked when the GST checkbox toggles.
 * @returns Summary card element.
 */
export function TotalsPanel({
  durationMins,
  hourlyRate,
  totals,
  activePromo,
  gst,
  onGstChange,
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
        <div className={cn("flex items-center justify-between")}>
          <label className={cn("flex cursor-pointer items-center gap-2 text-slate-600")}>
            <input
              type="checkbox"
              checked={gst}
              onChange={(e) => onGstChange(e.target.checked)}
              className={cn("h-3.5 w-3.5")}
            />
            GST (15%)
          </label>
          <span className={cn("text-slate-600")}>{formatNZD(totals.gstAmount)}</span>
        </div>
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
