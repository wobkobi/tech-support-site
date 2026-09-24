"use client";
// src/features/business/components/calculator/TaskTimeWarning.tsx

import { explicitRoundingAllowanceMins, hourlyTaskMinutes } from "@/features/business/lib/business";
import type { TaskLine } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import type React from "react";

interface TaskTimeWarningProps {
  tasks: TaskLine[];
  windowMin: number;
  minBillableMins: number;
  /** Live billing increment; sizes the pinned-task overshoot allowance. */
  snapMins?: number;
  onFix: () => void;
}

/**
 * Inline banner shown above the tasks panel when hourly task minutes don't
 * match the listed job window, or when a short job sits below the minimum
 * billable time. Stays hidden when everything lines up so the panel doesn't
 * carry a permanent strip of UI in the steady state.
 * @param props - Component props.
 * @param props.tasks - Current task lines (hourly + flat).
 * @param props.windowMin - Job window in minutes (`durationMins`).
 * @param props.minBillableMins - Minimum billable labour minutes; below this the floor banner shows.
 * @param props.snapMins - Live billing increment sizing the pinned-task overshoot allowance.
 * @param props.onFix - Handler that collapses tasks to the window and floors to the minimum.
 * @returns Warning element, or null when totals already match.
 */
export function TaskTimeWarning({
  tasks,
  windowMin,
  minBillableMins,
  snapMins,
  onFix,
}: TaskTimeWarningProps): React.ReactElement | null {
  const taskMin = hourlyTaskMinutes(tasks);
  if (taskMin === 0) return null;

  // Sub-minimum job: whole-job labour sits under the billable floor, so offer to bill at
  // the minimum (Fix floors the tasks). Checked before the window comparison - a short job
  // usually has taskMin == windowMin, which the drift tolerance below would swallow.
  if (taskMin < minBillableMins) {
    return (
      <div
        role="status"
        className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
      >
        <span>
          Tasks total {Math.round(taskMin)} min - minimum charge is {minBillableMins} min.
        </span>
        <button
          type="button"
          onClick={onFix}
          className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-900 hover:bg-sky-100"
        >
          Fix - bill the minimum
        </button>
      </div>
    );
  }

  if (windowMin <= 0) return null;
  // Explicit durations round UP to the snap grid, so their sum can top the
  // raw window by one step per pinned task without being an over-estimate.
  // Suppress that expected overshoot - Fix never rescales pinned tasks.
  const overshoot = taskMin - windowMin;
  if (overshoot > 0 && overshoot <= explicitRoundingAllowanceMins(tasks, snapMins)) return null;
  // Tolerance: qty rounds to 2 dp (0.6-min granularity), so a 3-task split can sit ~1.5
  // min off windowMin and still be correct after collapseToWindow. Without it the banner
  // reads "Tasks total 215 min - listed window is 215 min" off a 214.8 vs 215 float.
  if (Math.abs(taskMin - windowMin) < 2) return null;
  const over = taskMin > windowMin;
  // Billing to the minimum floor legitimately exceeds a shorter worked window,
  // so a floored job (taskMin at the minimum, window below it) isn't an
  // over-estimate - only flag "over" when the tasks also clear the floor.
  if (over && taskMin <= minBillableMins) return null;
  return (
    <div
      role="status"
      className={cn(
        "mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
        over
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-sky-200 bg-sky-50 text-sky-900",
      )}
    >
      <span>
        Tasks total {Math.round(taskMin)} min - listed window is {windowMin} min.
        {!over && " Bump the end time if you actually worked the extra."}
      </span>
      {over && (
        <button
          type="button"
          onClick={onFix}
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          Fix - rebalance tasks
        </button>
      )}
    </div>
  );
}
