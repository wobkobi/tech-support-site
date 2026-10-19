"use client";
// src/features/business/components/calculator/TaskTimeWarning.tsx

import { hourlyTaskMinutes, taskWindowMismatch } from "@/features/business/lib/business";
import type { TaskLine } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import type React from "react";

interface TaskTimeWarningProps {
  tasks: TaskLine[];
  windowMin: number;
  minBillableMins: number;
  /** Live billing increment: the grid the window is judged on. */
  snapMins?: number;
  onFix: () => void;
}

/**
 * Banner above the tasks panel when hourly task minutes miss the job window or fall
 * below the minimum; {@link taskWindowMismatch} decides which.
 * @param props - Component props.
 * @param props.tasks - Current task lines (hourly + flat).
 * @param props.windowMin - Job window in minutes (`durationMins`).
 * @param props.minBillableMins - Minimum billable labour minutes; below this the floor banner shows.
 * @param props.snapMins - Live billing increment: the grid the window is judged on.
 * @param props.onFix - Handler that fits tasks to the window, either way, and floors to the minimum.
 * @returns Warning element, or null when totals already match.
 */
export function TaskTimeWarning({
  tasks,
  windowMin,
  minBillableMins,
  snapMins,
  onFix,
}: TaskTimeWarningProps): React.ReactElement | null {
  const mismatch = taskWindowMismatch(tasks, windowMin, minBillableMins, snapMins);
  if (!mismatch) return null;
  const taskMin = hourlyTaskMinutes(tasks);

  // Sub-minimum job: Fix floors the tasks to the billable minimum.
  if (mismatch === "floor") {
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
          className="inline-flex min-h-9 items-center rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100 pointer-coarse:min-h-11"
        >
          Fix - bill the minimum
        </button>
      </div>
    );
  }

  const over = mismatch === "over";
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
      </span>
      {/* The end time is the actual finish, so Fix grows the tasks to fill the window. */}
      <button
        type="button"
        onClick={onFix}
        className={cn(
          "inline-flex min-h-9 items-center rounded-lg border bg-white px-3 py-1.5 text-sm font-medium pointer-coarse:min-h-11",
          over
            ? "border-amber-300 text-amber-900 hover:bg-amber-100"
            : "border-sky-300 text-sky-900 hover:bg-sky-100",
        )}
      >
        {over ? "Fix - rebalance tasks" : "Fix - spread tasks over the window"}
      </button>
    </div>
  );
}
