"use client";

import type React from "react";
import { cn } from "@/shared/lib/cn";
import { formatNZD, minsToHoursLabel, billableMins } from "@/features/business/lib/business";
import type { RateConfig } from "@/features/business/types/business";

interface Props {
  startTime: string;
  onStartTimeChange: (value: string) => void;
  endTime: string;
  onEndTimeChange: (value: string) => void;
  durationOverride: number | null;
  onDurationOverrideChange: (value: number | null) => void;
  /** Live duration (override or derived from start/end). */
  durationMins: number;
  hourlyRateId: string | null;
  onHourlyRateIdChange: (id: string | null) => void;
  baseRates: RateConfig[];
}

/**
 * Time + hourly-rate card on the left rail. Start/End drive the live
 * duration, with a manual override input that wins when set. The "billed"
 * sub-label appears when billableMins rounds up to the next 15-min slice so
 * the operator can see what'll appear on the invoice. The hourly rate
 * dropdown only lists base rates (modifier rates are picked per-task).
 * @param props - Component props.
 * @param props.startTime - HH:MM start time.
 * @param props.onStartTimeChange - Setter for start time (also clears any duration override).
 * @param props.endTime - HH:MM end time.
 * @param props.onEndTimeChange - Setter for end time (also clears any duration override).
 * @param props.durationOverride - Manual override in minutes, or null when derived from start/end.
 * @param props.onDurationOverrideChange - Setter for the duration override.
 * @param props.durationMins - Live derived duration in minutes (already accounts for override).
 * @param props.hourlyRateId - Selected hourly rate id, or null when none.
 * @param props.onHourlyRateIdChange - Setter for the hourly rate dropdown.
 * @param props.baseRates - Available base hourly rates (modifier rates not listed here).
 * @returns Time/rate card element.
 */
export function JobDetailsSection({
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  durationOverride,
  onDurationOverrideChange,
  durationMins,
  hourlyRateId,
  onHourlyRateIdChange,
  baseRates,
}: Props): React.ReactElement {
  return (
    <div className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <h2 className={cn("text-russian-violet text-sm font-semibold")}>Time</h2>
      <div className={cn("grid grid-cols-2 gap-3")}>
        <div>
          <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>Start</label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => {
              onStartTimeChange(e.target.value);
              onDurationOverrideChange(null);
            }}
            className={cn(
              "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
            )}
          />
        </div>
        <div>
          <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>End</label>
          <input
            type="time"
            value={endTime}
            onChange={(e) => {
              onEndTimeChange(e.target.value);
              onDurationOverrideChange(null);
            }}
            className={cn(
              "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
            )}
          />
        </div>
      </div>
      <div className={cn("grid grid-cols-2 gap-3")}>
        <div>
          <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>
            Duration (override)
          </label>
          <input
            type="number"
            min="0"
            step="5"
            value={durationOverride ?? durationMins}
            onChange={(e) => onDurationOverrideChange(parseInt(e.target.value) || 0)}
            className={cn(
              "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
            )}
          />
          <p className={cn("mt-1 text-xs text-slate-400")}>
            {minsToHoursLabel(durationMins)}
            {billableMins(durationMins) !== durationMins && (
              <span className={cn("ml-1 text-slate-300")}>
                → {minsToHoursLabel(billableMins(durationMins))} billed
              </span>
            )}
          </p>
        </div>
        <div>
          <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>Hourly rate</label>
          <select
            value={hourlyRateId ?? ""}
            onChange={(e) => onHourlyRateIdChange(e.target.value || null)}
            className={cn(
              "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
            )}
          >
            <option value="">None</option>
            {baseRates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} ({formatNZD(r.ratePerHour ?? 0)}/hr)
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
