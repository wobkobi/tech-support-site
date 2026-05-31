"use client";

import type React from "react";
import { FaCaretRight } from "react-icons/fa6";
import { cn } from "@/shared/lib/cn";
import {
  formatNZD,
  minsToHoursLabel,
  billableMins,
  timeDiffMins,
} from "@/features/business/lib/business";
import type { ParsedRange, RateConfig } from "@/features/business/types/business";

interface Props {
  timeRanges: ParsedRange[];
  onTimeRangesChange: (next: ParsedRange[]) => void;
  /** Operator-entered override; null means "sum of timeRanges". */
  durationMinsOverride: number | null;
  onDurationOverrideChange: (next: number | null) => void;
  /** Live billable minutes (override OR sum of slots). */
  durationMins: number;
  hourlyRateId: string | null;
  onHourlyRateIdChange: (id: string | null) => void;
  baseRates: RateConfig[];
}

/**
 * Time + hourly-rate card. Multiple Start/End slots sum into a single Labour
 * line; a manual duration override wins over the slot sum when set.
 * @param props - Component props.
 * @param props.timeRanges - Time slots (always at least one).
 * @param props.onTimeRangesChange - Replaces the slots array.
 * @param props.durationMinsOverride - Manual override; null means "use slot sum".
 * @param props.onDurationOverrideChange - Sets or clears the override.
 * @param props.durationMins - Live billable minutes (override or slot sum).
 * @param props.hourlyRateId - Selected base hourly rate id.
 * @param props.onHourlyRateIdChange - Picks a different base hourly rate.
 * @param props.baseRates - Available base hourly rates.
 * @returns Time/rate card element.
 */
export function JobDetailsSection({
  timeRanges,
  onTimeRangesChange,
  durationMinsOverride,
  onDurationOverrideChange,
  durationMins,
  hourlyRateId,
  onHourlyRateIdChange,
  baseRates,
}: Props): React.ReactElement {
  const sumRangesMin = timeRanges.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);
  // Mirror TotalsPanel's "Time" row visibility - only flag the rounded "billed"
  // figure when the duration is actually being charged. With no rate selected
  // (or a zero rate) durationMins is just bookkeeping, so the hint is noise.
  const selectedRate = baseRates.find((r) => r.id === hourlyRateId);
  const chargingDuration = selectedRate?.ratePerHour != null && selectedRate.ratePerHour > 0;

  /**
   * Updates one slot's start or end time. Clears any duration override so the
   * Duration field reflects the new sum until the operator explicitly types
   * one in.
   * @param index - Slot index.
   * @param patch - Partial slot fields to merge.
   */
  function patchRange(index: number, patch: Partial<ParsedRange>): void {
    onTimeRangesChange(timeRanges.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    onDurationOverrideChange(null);
  }

  /** Appends a blank slot below the existing ones. */
  function addRange(): void {
    onTimeRangesChange([...timeRanges, { startTime: "", endTime: "" }]);
    onDurationOverrideChange(null);
  }

  /**
   * Removes the slot at `index`. Disabled when only one slot remains so the
   * card always has at least one row to edit.
   * @param index - Slot index to drop.
   */
  function removeRange(index: number): void {
    if (timeRanges.length <= 1) return;
    onTimeRangesChange(timeRanges.filter((_, i) => i !== index));
    onDurationOverrideChange(null);
  }

  const multi = timeRanges.length > 1;

  return (
    <div className={cn("space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <h2 className={cn("text-russian-violet text-sm font-semibold")}>Time</h2>

      <div className={cn("space-y-2")}>
        {timeRanges.map((range, index) => (
          <div key={index} className={cn("flex items-end gap-2")}>
            <div className={cn("flex-1")}>
              {index === 0 && (
                <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>Start</label>
              )}
              <input
                type="time"
                value={range.startTime}
                onChange={(e) => patchRange(index, { startTime: e.target.value })}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              />
            </div>
            <div className={cn("flex-1")}>
              {index === 0 && (
                <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>End</label>
              )}
              <input
                type="time"
                value={range.endTime}
                onChange={(e) => patchRange(index, { endTime: e.target.value })}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              />
            </div>
            <button
              type="button"
              onClick={() => removeRange(index)}
              disabled={!multi}
              aria-label={`Remove time slot ${index + 1}`}
              className={cn(
                "rounded-lg border border-red-200 bg-white px-2 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-white",
              )}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRange}
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50",
          )}
        >
          + Add time slot
        </button>
      </div>

      <div>
        <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>
          Duration (override)
        </label>
        <input
          type="number"
          min="0"
          step="5"
          value={durationMinsOverride ?? durationMins}
          onChange={(e) => onDurationOverrideChange(parseInt(e.target.value) || 0)}
          className={cn(
            "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2",
          )}
        />
        <p className={cn("mt-1 text-xs text-slate-400")}>
          {minsToHoursLabel(durationMins)}
          {chargingDuration && billableMins(durationMins) !== durationMins && (
            <span className={cn("ml-1 inline-flex items-center gap-1 text-slate-300")}>
              <FaCaretRight className={cn("h-3 w-3")} aria-hidden />
              {minsToHoursLabel(billableMins(durationMins))} billed
            </span>
          )}
          {durationMinsOverride != null &&
            durationMinsOverride !== sumRangesMin &&
            sumRangesMin > 0 && (
              <span className={cn("ml-1 italic text-slate-300")}>
                (slots sum {minsToHoursLabel(sumRangesMin)})
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
  );
}
