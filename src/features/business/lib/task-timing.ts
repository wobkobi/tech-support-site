// Task-line minute maths - fitting parsed tasks to the job window, snapping to the billing
// grid, and the whole-job minimum-billable floor. Re-exported through business.ts.

import { MIN_BILLABLE_MINS } from "@/features/business/lib/pricing-policy";
import type { TaskLine } from "@/features/business/types/business";

/**
 * Total minutes contributed by hourly tasks. Flat-rate tasks (Travel, etc.)
 * carry no time so they're excluded.
 * @param tasks - Task lines from the calculator.
 * @returns Sum of hourly task minutes (`qty * 60`).
 */
export function hourlyTaskMinutes(tasks: TaskLine[]): number {
  return tasks.filter((t) => t.baseRateId != null).reduce((sum, t) => sum + t.qty * 60, 0);
}

/**
 * Overshoot allowance for operator-stated tasks: each explicit task's stated
 * duration rounds UP to the snap grid, so pinned tasks can exceed the raw
 * window by one step apiece. Overshoot within this allowance is rounding, not
 * an over-estimate to rebalance or warn on.
 * @param tasks - Task lines to assess.
 * @param snapMins - Live billing increment in minutes; defaults to the code fallback.
 * @returns Allowance in minutes (explicit hourly task count * snap step).
 */
export function explicitRoundingAllowanceMins(
  tasks: TaskLine[],
  snapMins: number = TASK_TIMING_FALLBACK.snapMins,
): number {
  return tasks.filter((t) => t.baseRateId != null && t.isExplicit).length * snapMins;
}

/**
 * Live task-timing values threaded in from pricing settings. Every consumer
 * reads the operator's settings; {@link TASK_TIMING_FALLBACK} is the in-code
 * default only, so editing Settings changes the apportionment everywhere.
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
 * Fallbacks matching the settings defaults. Literals rather than reads of
 * BILLING_INCREMENT_MINS et al: importing those here re-introduces a
 * circular-import TDZ with the pricing-policy module.
 */
export const TASK_TIMING_FALLBACK: TaskTimingConfig = {
  snapMins: 5,
  shortTaskMins: 15,
  minTaskMins: 5,
};

/**
 * Fits task lines to the listed job window, in both directions.
 * Pinned tasks (isShort or isExplicit) keep their parser-emitted qty - short
 * tasks at the live `shortTaskMins`, explicit tasks at whatever the operator
 * stated, with a one-snap-step-per-task overshoot allowance (see
 * {@link explicitRoundingAllowanceMins}) before an explicit task is dropped
 * for not fitting. The remaining floating tasks scale proportionally to fill what's
 * left of the window, so an over-long primary task absorbs more of the
 * correction than a correctly-sized one. Floating tasks that would scale
 * below the live `minTaskMins` are dropped, then the rest rescale. Snaps
 * qty to the live billing increment and parks any rounding remainder on the
 * largest floating survivor so totals match exactly. Flat-rate tasks pass through.
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
  const hourlyIn = tasks.filter((t) => t.baseRateId != null);
  const flat = tasks.filter((t) => t.baseRateId == null);
  if (hourlyIn.length === 0) return { tasks, dropped: 0, rescaled: false };

  // The classification below splits tasks into short / explicit / floating groups, so the
  // survivors have to be restored to the operator's order - otherwise a quick task leads
  // the invoice and the main work sinks. Clones carry their position via {@link derive}.
  const orderOf = new Map<TaskLine, number>();
  tasks.forEach((t, i) => orderOf.set(t, i));
  /**
   * {@link withMinutes} that carries the source task's input position onto the
   * clone, so {@link inInputOrder} can still place it.
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

  // Exactly right - nothing to move in either direction.
  if (hourlyMin === windowMin) {
    return { tasks, dropped: 0, rescaled: false };
  }

  // Short of the window. The event end is the actual finish, so the difference
  // is real time on the job that the parsed durations did not account for -
  // typically because a description rounds to "an hour and a half". Grown to
  // meet the window, mirroring how an overflow is scaled down to match it
  // exactly; leaving it would quietly bill less than the job took.
  if (hourlyMin < windowMin) {
    const floatingUp = hourlyIn.filter((t) => !t.isShort && !t.isExplicit);
    let grown: TaskLine[];
    if (floatingUp.length > 0) {
      // Floating tasks carry no stated duration, so they absorb the difference
      // first and pinned ones keep the operator's own measurement.
      const pinned = hourlyIn.filter((t) => t.isShort || t.isExplicit);
      const target = windowMin - sumTaskMinutes(pinned);
      const multiplier = target / sumTaskMinutes(floatingUp);
      grown = [
        ...pinned,
        ...floatingUp.map((t) =>
          derive(t, snapMinutes(taskMinutes(t) * multiplier, timing.snapMins)),
        ),
      ];
    } else {
      // Every task is pinned. The largest line takes the remainder, which is the
      // one case where a stated duration is overridden - preferred to billing
      // under the window, since the window is what the job actually ran.
      grown = [...hourlyIn];
    }
    // Park what the snap grid left over on the largest adjustable line, so the
    // billed total lands on the window exactly - the same reconciliation the
    // collapse path below does.
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

  // Pin short tasks at the operator's quick-task time and drop any that don't fit.
  // isExplicit beats isShort - a stated duration is the operator's own measurement, so it
  // keeps its qty. The parser emits the flags exclusive; this is the guard.
  const short: TaskLine[] = hourlyIn
    .filter((t) => t.isShort && !t.isExplicit)
    .map((t) => derive(t, timing.shortTaskMins));
  let dropped = 0;
  while (short.length * timing.shortTaskMins > windowMin) {
    short.pop();
    dropped++;
  }

  // Explicit tasks keep their parser-emitted qty. Stated durations round UP to
  // the snap grid, so tolerate one step of overshoot per explicit task; drop
  // (newest first) only genuine overflow beyond that.
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
    // Nothing floating: pinned tasks stand as-is, so only report a rescale
    // when something was actually dropped - otherwise the caller would toast
    // "Rebalanced tasks" over an untouched list.
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

  // Scale floating tasks proportionally to fill remainingMin; drop tasks that
  // would land below the operator's smallest-task time and rescale until
  // everything fits.
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
 * A task's billed minutes. Prefers the authoritative `minutes`, falling back to
 * the decimal-hour `qty` for rows that predate it (manual flat lines, legacy
 * drafts).
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
 * Returns a clone of `task` billed for `mins` whole minutes.
 *
 * `minutes` is the authoritative figure; `qty` is it in hours, deliberately
 * NOT rounded to 2 dp. Two decimals cannot represent a 5-minute grid - only
 * 15/30/45/60 land exactly - so rounding here is what used to make a 140-minute
 * job bill 139.8 or 140.4 and never 140. Carrying full precision keeps
 * `qty * unitPrice` exact everywhere it is summed.
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
    lineTotal: Math.round(qty * task.unitPrice * 100) / 100,
  };
}

/**
 * Enforces the whole-job minimum-billable floor. When the hourly task lines
 * carry some time but sum below minBillableMins, grows the most significant
 * line so the billed labour is at least the minimum - the largest floating
 * (neither operator-stated nor quick) task, or the largest hourly task when
 * every line is pinned. A job with no hourly time stays at 0 so the floor never invents a
 * charge on an empty or parts-only job. Applied by both calcJobTotal
 * and jobToLineItems (business.ts) so the on-screen total and the issued invoice
 * agree, mirroring the MIN_TRAVEL_CHARGE floor.
 * @param tasks - Task lines (`qty` in decimal hours); flat-rate lines pass through untouched.
 * @param minBillableMins - Minimum billable labour minutes (live pricing setting); defaults to the code const.
 * @returns Task list with the floor applied, or the input unchanged when already at/above the minimum.
 */
export function enforceMinBillable(
  tasks: TaskLine[],
  minBillableMins: number = MIN_BILLABLE_MINS,
): TaskLine[] {
  if (minBillableMins <= 0) return tasks;
  const hourly = tasks.filter(isHourlyTask);
  const totalMin = sumTaskMinutes(hourly);
  if (totalMin <= 0 || totalMin >= minBillableMins) return tasks;
  // Land the deficit on the most significant line: the largest floating task,
  // falling back to the largest hourly task when every line is pinned.
  const floating = hourly.filter((t) => !t.isExplicit && !t.isShort);
  const pool = floating.length > 0 ? floating : hourly;
  let biggest = pool[0];
  if (!biggest) return tasks;
  for (const t of pool) if (t.qty > biggest.qty) biggest = t;
  const bumped = withMinutes(biggest, biggest.qty * 60 + (minBillableMins - totalMin));
  return tasks.map((t) => (t === biggest ? bumped : t));
}

/**
 * Whether a task line counts as labour. Hourly tasks (an explicit base rate, or
 * no rate config at all) are labour; flat-rate rows like Travel never are, so
 * they're excluded from the unsuccessful-work discount.
 * @param task - Task line to classify.
 * @returns True when the line is hourly labour.
 */
export function isHourlyTask(task: TaskLine): boolean {
  return task.baseRateId != null || task.rateConfigId == null;
}
