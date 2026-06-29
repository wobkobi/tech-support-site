"use client";
// src/features/business/components/calculator/JobDetailsSection.tsx
/**
 * @description Time + hourly-rate card. Multiple Start/End slots sum into one
 * Labour line, with {@link slotIssue} flagging zero-length or cross-midnight
 * slots. A manual duration override wins over the slot sum, and a billed-
 * rounding hint shows only when a charging rate is selected.
 */
import {
  billableMins,
  formatNZD,
  minsToHoursLabel,
  timeDiffMins,
} from "@/features/business/lib/business";
import type { ParsedRange, RateConfig } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaCaretRight } from "react-icons/fa6";

/** Inline warning shown under a slot whose Start/End look off. */
interface SlotIssue {
  tone: "warn" | "info";
  text: string;
}

/**
 * Classifies a slot for inline flagging. Only complete, parseable slots are
 * judged - a half-typed row stays silent. A zero-length slot is a likely
 * mistake; an End before Start now rolls past midnight, so it's surfaced as an
 * info note in case the operator meant same-day and fat-fingered AM/PM.
 * @param range - Slot to check.
 * @returns Issue to display, or null when the slot reads fine.
 */
function slotIssue(range: ParsedRange): SlotIssue | null {
  const { startTime, endTime } = range;
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const raw = eh * 60 + em - (sh * 60 + sm);
  if (raw === 0) return { tone: "warn", text: "Start and end are the same" };
  if (raw < 0) {
    return {
      tone: "info",
      text: `Crosses midnight, counted as ${minsToHoursLabel(raw + 24 * 60)}`,
    };
  }
  return null;
}

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
  /** Billing increment (live pricing setting) used for the "billed" rounding hint. */
  billingIncrementMins: number;
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
 * @param props.billingIncrementMins - Billing increment (live pricing setting).
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
  billingIncrementMins,
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

  /** Appends a slot; rolling entry seeds its start from the previous slot's end. */
  function addRange(): void {
    const prevEnd = timeRanges[timeRanges.length - 1]?.endTime ?? "";
    onTimeRangesChange([...timeRanges, { startTime: prevEnd, endTime: "" }]);
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
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-russian-violet">Time</h2>

      <div className="space-y-2">
        {timeRanges.map((range, index) => {
          const issue = slotIssue(range);
          return (
            <div key={index} className="space-y-1">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  {index === 0 && (
                    <label className="mb-1 block text-xs font-medium text-slate-500">Start</label>
                  )}
                  <input
                    type="time"
                    value={range.startTime}
                    onChange={(e) => patchRange(index, { startTime: e.target.value })}
                    aria-invalid={issue?.tone === "warn"}
                    className={cn(
                      "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
                      issue?.tone === "warn" && "border-amber-400",
                    )}
                  />
                </div>
                <div className="flex-1">
                  {index === 0 && (
                    <label className="mb-1 block text-xs font-medium text-slate-500">End</label>
                  )}
                  <input
                    type="time"
                    value={range.endTime}
                    onChange={(e) => patchRange(index, { endTime: e.target.value })}
                    aria-invalid={issue?.tone === "warn"}
                    className={cn(
                      "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none",
                      issue?.tone === "warn" && "border-amber-400",
                    )}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRange(index)}
                  disabled={!multi}
                  aria-label={`Remove time slot ${index + 1}`}
                  className="rounded-lg border border-red-200 bg-white px-2 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-white"
                >
                  ×
                </button>
              </div>
              {issue && (
                <p
                  className={cn(
                    "text-xs",
                    issue.tone === "warn" ? "text-amber-600" : "text-slate-400 italic",
                  )}
                >
                  {issue.text}
                </p>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={addRange}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          + Add time slot
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Duration (override)</label>
        <input
          type="number"
          min="0"
          step="5"
          value={durationMinsOverride ?? durationMins}
          onChange={(e) => onDurationOverrideChange(parseInt(e.target.value) || 0)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-400">
          {minsToHoursLabel(durationMins)}
          {chargingDuration &&
            billableMins(durationMins, billingIncrementMins) !== durationMins && (
              <span className="ml-1 inline-flex items-center gap-1 text-slate-300">
                <FaCaretRight className="h-3 w-3" aria-hidden />
                {minsToHoursLabel(billableMins(durationMins, billingIncrementMins))} billed
              </span>
            )}
          {durationMinsOverride != null &&
            durationMinsOverride !== sumRangesMin &&
            sumRangesMin > 0 && (
              <span className="ml-1 text-slate-300 italic">
                (slots sum {minsToHoursLabel(sumRangesMin)})
              </span>
            )}
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Hourly rate</label>
        <select
          value={hourlyRateId ?? ""}
          onChange={(e) => onHourlyRateIdChange(e.target.value || null)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
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
