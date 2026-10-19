// src/features/business/lib/task-timing.ts
// Task-line minute maths: window fitting, grid snapping and the minimum-billable floor.

import { MIN_BILLABLE_MINS } from "@/features/business/lib/pricing-policy";
import type { TaskLine } from "@/features/business/types/business";
import { roundCents } from "@/shared/lib/money";

/**
 * Total minutes from hourly tasks; flat-rate tasks carry no time.
 * @param tasks - Task lines from the calculator.
 * @returns Sum of hourly task minutes (`qty * 60`).
 */
export function hourlyTaskMinutes(tasks: TaskLine[]): number {
  return tasks.filter(isHourlyTask).reduce((sum, t) => sum + t.qty * 60, 0);
}

/**
 * Overshoot allowance for explicit tasks: each rounds UP to the grid, so one snap step apiece
 * over the window is rounding, not an over-estimate.
 * @param tasks - Task lines to assess.
 * @param snapMins - Live billing increment in minutes; defaults to the code fallback.
 * @returns Allowance in minutes (explicit hourly task count * snap step).
 */
export function explicitRoundingAllowanceMins(
  tasks: TaskLine[],
  snapMins: number = TASK_TIMING_FALLBACK.snapMins,
): number {
  return tasks.filter((t) => isHourlyTask(t) && t.isExplicit).length * snapMins;
}

/** What the calculator's task-time banner flags, from {@link taskWindowMismatch}. */
export type TaskWindowMismatch = "floor" | "over" | "under";

/**
 * Whether the tasks disagree with the grid-snapped window enough to offer a Fix, and which
 * way. Overshoot inside {@link explicitRoundingAllowanceMins} passes only when every task is
 * pinned; a floating task could absorb it.
 * @param tasks - Current task lines (hourly + flat).
 * @param windowMin - Job window in minutes (slot sum plus follow-up).
 * @param minBillableMins - Minimum billable labour minutes.
 * @param snapMins - Live billing increment in minutes; defaults to the code fallback.
 * @returns "floor", "over" or "under", or null when the tasks already fit.
 */
export function taskWindowMismatch(
  tasks: TaskLine[],
  windowMin: number,
  minBillableMins: number,
  snapMins: number = TASK_TIMING_FALLBACK.snapMins,
): TaskWindowMismatch | null {
  const taskMin = hourlyTaskMinutes(tasks);
  if (taskMin === 0) return null;
  // Checked before the window: a short job usually has taskMin == windowMin.
  if (taskMin < minBillableMins) return "floor";
  if (windowMin <= 0) return null;
  const snap = snapMins > 0 ? snapMins : TASK_TIMING_FALLBACK.snapMins;
  const gridWindow = Math.round(windowMin / snap) * snap;
  // A window under half an increment rounds to nothing, which Fix leaves alone.
  if (gridWindow <= 0) return null;
  const gap = taskMin - gridWindow;
  // Tolerance: a legacy qty at 2 dp sits up to ~1.5 min off after a 3-task split.
  if (Math.abs(gap) < 2) return null;
  // Billing at the minimum floor legitimately exceeds a shorter window.
  if (gap > 0 && taskMin <= minBillableMins) return null;
  const canAbsorb = tasks.some((t) => isHourlyTask(t) && !t.isExplicit && !t.isShort);
  if (gap > 0 && !canAbsorb && gap <= explicitRoundingAllowanceMins(tasks, snap)) return null;
  return gap > 0 ? "over" : "under";
}

/**
 * Live task-timing values from pricing settings; {@link TASK_TIMING_FALLBACK} is only the default.
 */
export interface TaskTimingConfig {
  /** Rounding granularity for task qty; the live `billingIncrementMins`. */
  snapMins: number;
  /** Minutes an `isShort` task is pinned to; the live `shortTaskMins`. */
  shortTaskMins: number;
  /** Minutes a floating task can shrink to before it's dropped; the live `minTaskMins`. */
  minTaskMins: number;
}

/**
 * Fallbacks matching the settings defaults. Literals, since importing BILLING_INCREMENT_MINS
 * et al causes a circular-import TDZ with pricing-policy.
 */
export const TASK_TIMING_FALLBACK: TaskTimingConfig = {
  snapMins: 5,
  shortTaskMins: 15,
  minTaskMins: 5,
};

/**
 * Fits task lines to the job window in both directions. Pinned tasks keep their qty (within
 * {@link explicitRoundingAllowanceMins}); floating ones scale proportionally, dropping any
 * below `minTaskMins`, and the snap remainder lands on the largest survivor.
 * @param tasks - Task lines to collapse.
 * @param windowMin - Target window in minutes (`durationMins`).
 * @param timing - Live task-timing settings; defaults to {@link TASK_TIMING_FALLBACK}.
 * @returns Adjusted task list, count of dropped tasks, and whether any qty was rescaled.
 */
export function collapseToWindow(
  tasks: TaskLine[],
  windowMin: number,
  timing: TaskTimingConfig = TASK_TIMING_FALLBACK,
): { tasks: TaskLine[]; dropped: number; rescaled: boolean } {
  if (windowMin <= 0) return { tasks, dropped: 0, rescaled: false };
  const hourlyIn = tasks.filter(isHourlyTask);
  const flat = tasks.filter((t) => !isHourlyTask(t));
  if (hourlyIn.length === 0) return { tasks, dropped: 0, rescaled: false };

  // Grouping reorders tasks, so survivors are restored to the operator's order via derive.
  const orderOf = new Map<TaskLine, number>();
  tasks.forEach((t, i) => orderOf.set(t, i));
  /**
   * {@link withMinutes} that carries the source task's input position onto the clone.
   * @param task - Source task line.
   * @param mins - New duration in minutes.
   * @returns Updated task line, registered at the source task's position.
   */
  const derive = (task: TaskLine, mins: number): TaskLine => {
    const next = withMinutes(task, mins);
    orderOf.set(next, orderOf.get(task) ?? 0);
    return next;
  };
  /**
   * Restores input order across the classification groups.
   * @param list - Surviving task lines in group order.
   * @returns The same lines ordered as the operator listed them.
   */
  const inInputOrder = (list: TaskLine[]): TaskLine[] =>
    [...list].sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0));

  const hourlyMin = sumTaskMinutes(hourlyIn);

  if (hourlyMin === windowMin) {
    return { tasks, dropped: 0, rescaled: false };
  }

  // Short of the window: the event end is the actual finish, so grow tasks to meet it.
  if (hourlyMin < windowMin) {
    const floatingUp = hourlyIn.filter((t) => !t.isShort && !t.isExplicit);
    let grown: TaskLine[];
    if (floatingUp.length > 0) {
      // Floating tasks absorb the difference; pinned ones keep the operator's measurement.
      const pinned = hourlyIn.filter((t) => t.isShort || t.isExplicit);
      const target = windowMin - sumTaskMinutes(pinned);
      const floatingMin = sumTaskMinutes(floatingUp);
      // All-zero floating lines split evenly (no proportions, and no divide by zero).
      grown = [
        ...pinned,
        ...floatingUp.map((t) =>
          derive(
            t,
            snapMinutes(
              floatingMin > 0
                ? taskMinutes(t) * (target / floatingMin)
                : target / floatingUp.length,
              timing.snapMins,
            ),
          ),
        ),
      ];
    } else if (hourlyIn.every((t) => t.isShort && !t.isExplicit)) {
      // All quick-task guesses with no times stated: share the window evenly.
      grown = hourlyIn.map((t) =>
        derive(t, snapMinutes(windowMin / hourlyIn.length, timing.snapMins)),
      );
    } else {
      // All pinned with a stated duration: the largest line takes the remainder anyway,
      // since the window is what the job actually ran.
      grown = [...hourlyIn];
    }
    // Park the snap remainder on the largest adjustable line so the total hits the window.
    const adjustable =
      floatingUp.length > 0 ? grown.filter((t) => !t.isShort && !t.isExplicit) : grown;
    const error = windowMin - sumTaskMinutes(grown);
    if (error !== 0 && adjustable.length > 0) {
      let biggest = adjustable[0]!;
      for (const t of adjustable) if (taskMinutes(t) > taskMinutes(biggest)) biggest = t;
      grown[grown.indexOf(biggest)] = derive(
        biggest,
        Math.max(timing.minTaskMins, taskMinutes(biggest) + error),
      );
    }
    return { tasks: inInputOrder([...grown, ...flat]), dropped: 0, rescaled: true };
  }

  // Pin short tasks at the quick-task time, dropping any that don't fit. isExplicit beats isShort.
  const short: TaskLine[] = hourlyIn
    .filter((t) => t.isShort && !t.isExplicit)
    .map((t) => derive(t, timing.shortTaskMins));
  let dropped = 0;
  while (short.length * timing.shortTaskMins > windowMin) {
    short.pop();
    dropped++;
  }

  // Explicit tasks keep their qty with one snap step of overshoot each; drop newest first beyond.
  const explicit: TaskLine[] = hourlyIn.filter((t) => t.isExplicit);
  const shortMin = short.length * timing.shortTaskMins;
  while (
    explicit.length > 0 &&
    shortMin + sumTaskMinutes(explicit) > windowMin + explicit.length * timing.snapMins
  ) {
    explicit.pop();
    dropped++;
  }
  const pinnedMin = shortMin + sumTaskMinutes(explicit);

  let floating: TaskLine[] = hourlyIn.filter((t) => !t.isShort && !t.isExplicit);
  const remainingMin = windowMin - pinnedMin;

  if (floating.length === 0) {
    // Nothing floating: report a rescale only if something was dropped.
    return {
      tasks: inInputOrder([...short, ...explicit, ...flat]),
      dropped,
      rescaled: dropped > 0,
    };
  }

  if (remainingMin <= 0) {
    // Pinned tasks already cover the whole window; drop every floating one.
    dropped += floating.length;
    return {
      tasks: inInputOrder([...short, ...explicit, ...flat]),
      dropped,
      rescaled: true,
    };
  }

  // Scale floating tasks to remainingMin, dropping the smallest below minTaskMins until all fit.
  while (floating.length > 0) {
    const sum = sumTaskMinutes(floating);
    if (sum <= remainingMin) break;
    const multiplier = remainingMin / sum;
    const scaled = floating.map((t) => ({ task: t, scaledMin: t.qty * 60 * multiplier }));
    const tooSmall = scaled.filter((s) => s.scaledMin < timing.minTaskMins);
    if (tooSmall.length === 0) {
      floating = scaled.map((s) => derive(s.task, snapMinutes(s.scaledMin, timing.snapMins)));
      break;
    }
    scaled.sort((a, b) => a.scaledMin - b.scaledMin);
    const removed = scaled[0]!.task;
    floating = floating.filter((t) => t !== removed);
    dropped++;
  }

  // Park rounding remainder on the largest floating survivor so totals match.
  const combined = [...short, ...explicit, ...floating];
  if (combined.length > 0) {
    const error = windowMin - sumTaskMinutes(combined);
    if (error !== 0 && floating.length > 0) {
      let biggestIdx = 0;
      for (let i = 1; i < floating.length; i++) {
        if (floating[i]!.qty > floating[biggestIdx]!.qty) biggestIdx = i;
      }
      const winner = floating[biggestIdx]!;
      const adjustedMin = Math.max(timing.minTaskMins, winner.qty * 60 + error);
      floating[biggestIdx] = derive(winner, adjustedMin);
    }
  }

  return {
    tasks: inInputOrder([...short, ...explicit, ...floating, ...flat]),
    dropped,
    rescaled: true,
  };
}

/**
 * Rounds a minute value to the nearest task-qty snap step.
 * @param mins - Raw minutes.
 * @param snapMins - Live billing increment in minutes; defaults to the code fallback.
 * @returns Minutes rounded to the nearest snap step.
 */
function snapMinutes(mins: number, snapMins: number = TASK_TIMING_FALLBACK.snapMins): number {
  return Math.round(mins / snapMins) * snapMins;
}

/**
 * A task's billed minutes: `minutes`, else the decimal-hour `qty`.
 * @param task - Task line.
 * @returns Billed minutes.
 */
export function taskMinutes(task: TaskLine): number {
  return task.minutes ?? task.qty * 60;
}

/**
 * Total minutes across the given task lines.
 * @param arr - Task lines.
 * @returns Sum of minute durations.
 */
function sumTaskMinutes(arr: TaskLine[]): number {
  return arr.reduce((s, t) => s + taskMinutes(t), 0);
}

/**
 * Returns a clone of `task` billed for `mins` whole minutes. `qty` is NOT rounded to 2 dp:
 * two decimals can't hold a 5-min grid (140 min would bill 139.8 or 140.4).
 * @param task - Source task line.
 * @param mins - New duration in minutes; rounded to a whole minute.
 * @returns Updated task line.
 */
function withMinutes(task: TaskLine, mins: number): TaskLine {
  const minutes = Math.round(mins);
  const qty = minutes / 60;
  return {
    ...task,
    minutes,
    qty,
    lineTotal: roundCents(qty * task.unitPrice),
  };
}

/**
 * Enforces the whole-job minimum-billable floor by growing the largest floating task (else
 * largest hourly). A job with no hourly time stays at 0. Used by calcJobTotal and jobToLineItems.
 * @param tasks - Task lines; flat-rate lines pass through.
 * @param minBillableMins - Live minimum billable labour minutes.
 * @returns Task list with the floor applied, or the input when already at the minimum.
 */
export function enforceMinBillable(
  tasks: TaskLine[],
  minBillableMins: number = MIN_BILLABLE_MINS,
): TaskLine[] {
  if (minBillableMins <= 0) return tasks;
  const hourly = tasks.filter(isHourlyTask);
  const totalMin = sumTaskMinutes(hourly);
  if (totalMin <= 0 || totalMin >= minBillableMins) return tasks;
  const floating = hourly.filter((t) => !t.isExplicit && !t.isShort);
  const pool = floating.length > 0 ? floating : hourly;
  let biggest = pool[0];
  if (!biggest) return tasks;
  for (const t of pool) if (t.qty > biggest.qty) biggest = t;
  const bumped = withMinutes(biggest, biggest.qty * 60 + (minBillableMins - totalMin));
  return tasks.map((t) => (t === biggest ? bumped : t));
}

/**
 * Whether a task line is labour, the one classifier for pricing and timing: a base rate, or
 * no rate config ("No base" per-hour row). Flat fees never are.
 * @param task - Task line to classify.
 * @returns True when the line is hourly labour.
 */
export function isHourlyTask(
  task: Pick<TaskLine, "baseRateId" | "rateConfigId" | "isFlatFee">,
): boolean {
  if (task.isFlatFee) return false;
  return task.baseRateId != null || task.rateConfigId == null;
}
