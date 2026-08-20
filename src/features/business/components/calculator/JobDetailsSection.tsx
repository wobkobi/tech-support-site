"use client";
// src/features/business/components/calculator/JobDetailsSection.tsx
/**
 * @description Time card. Multiple Start/End slots sum into the billable
 * window, with {@link slotIssue} flagging zero-length or cross-midnight slots.
 * A follow-up minutes field adds work done outside the slots (a call after the
 * visit, a remote fix later) on top of the slot sum.
 */
import { minsToHoursLabel, timeDiffMins } from "@/features/business/lib/business";
import type { ParsedRange } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import type React from "react";

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
  /** Minutes of billable work done outside the slots; added to the slot sum. */
  followUpMins: number;
  onFollowUpMinsChange: (next: number) => void;
  /** Live billable minutes (slot sum + follow-up). */
  durationMins: number;
}

/**
 * Time card. Multiple Start/End slots sum into the billable window; the
 * follow-up field adds out-of-session minutes (a call after the visit) on top.
 * @param props - Component props.
 * @param props.timeRanges - Time slots (always at least one).
 * @param props.onTimeRangesChange - Replaces the slots array.
 * @param props.followUpMins - Out-of-session minutes added to the slot sum.
 * @param props.onFollowUpMinsChange - Sets the follow-up minutes.
 * @param props.durationMins - Live billable minutes (slot sum + follow-up).
 * @returns Time card element.
 */
export function JobDetailsSection({
  timeRanges,
  onTimeRangesChange,
  followUpMins,
  onFollowUpMinsChange,
  durationMins,
}: Props): React.ReactElement {
  const sumRangesMin = timeRanges.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);

  /**
   * Updates one slot's start or end time.
   * @param index - Slot index.
   * @param patch - Partial slot fields to merge.
   */
  function patchRange(index: number, patch: Partial<ParsedRange>): void {
    onTimeRangesChange(timeRanges.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  /** Appends a slot; rolling entry seeds its start from the previous slot's end. */
  function addRange(): void {
    const prevEnd = timeRanges[timeRanges.length - 1]?.endTime ?? "";
    onTimeRangesChange([...timeRanges, { startTime: prevEnd, endTime: "" }]);
  }

  /**
   * Removes the slot at `index`. Disabled when only one slot remains so the
   * card always has at least one row to edit.
   * @param index - Slot index to drop.
   */
  function removeRange(index: number): void {
    if (timeRanges.length <= 1) return;
    onTimeRangesChange(timeRanges.filter((_, i) => i !== index));
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
        <label htmlFor="follow-up-mins" className="mb-1 block text-xs font-medium text-slate-500">
          Follow-up time (mins)
        </label>
        <input
          id="follow-up-mins"
          type="number"
          min="0"
          step="5"
          inputMode="numeric"
          value={followUpMins === 0 ? "" : followUpMins}
          onChange={(e) => {
            // Blank/NaN clears back to 0 so the duration reverts to the slot sum.
            const v = parseInt(e.target.value, 10);
            onFollowUpMinsChange(Number.isNaN(v) || v < 0 ? 0 : v);
          }}
          placeholder="0"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-400">
          Work done outside the slots - a call after the visit, a remote fix later.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Total {minsToHoursLabel(durationMins)}
          {followUpMins > 0 && sumRangesMin > 0 && (
            <span className="ml-1 text-slate-300 italic">
              (slots {minsToHoursLabel(sumRangesMin)} + follow-up {minsToHoursLabel(followUpMins)})
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
