// scripts/check-task-window.ts
// How task durations are fitted to the job window. This decides what a real
// invoice charges for labour, in both directions: an over-long parse is scaled
// down, and a parse that falls short of the window is grown to meet it.
// Run with: npm run check:task-window

import {
  collapseToWindow,
  TASK_TIMING_FALLBACK,
  taskWindowMismatch,
} from "@/features/business/lib/business";
import type { TaskLine } from "@/features/business/types/business";

let failures = 0;

/**
 * Compares a value against its expectation, recording rather than throwing so
 * every fixture runs even after one fails.
 * @param label - Human-readable case name.
 * @param actual - What the call produced.
 * @param expected - What it should have produced.
 */
function expectEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS  ${label} > ${a}`);
  } else {
    console.error(`  FAIL  ${label} > expected ${e}, got ${a}`);
    failures++;
  }
}

/**
 * Builds an hourly task of a given duration.
 * @param description - Line description.
 * @param mins - Billed minutes.
 * @param pin - Which pin the parser put on it, if any.
 * @returns An hourly task line at $65/hr.
 */
function task(description: string, mins: number, pin?: "short" | "explicit"): TaskLine {
  return {
    rateConfigId: null,
    baseRateId: "base",
    description,
    minutes: mins,
    qty: mins / 60,
    unitPrice: 65,
    lineTotal: Math.round((mins / 60) * 65 * 100) / 100,
    isShort: pin === "short",
    isExplicit: pin === "explicit",
  };
}

/**
 * The billed minutes of every hourly line, in order.
 * @param tasks - Task lines to read.
 * @returns Minutes per hourly line.
 */
function minutesOf(tasks: TaskLine[]): number[] {
  return tasks.filter((t) => t.baseRateId != null).map((t) => t.minutes ?? 0);
}

/** Runs every fixture case and exits non-zero if any failed. */
function main(): void {
  console.log("task window fixtures\n");

  const timing = TASK_TIMING_FALLBACK;

  // ---- Already exact ----

  expectEqual(
    "a job that already fills its window is untouched",
    minutesOf(collapseToWindow([task("a", 60), task("b", 30)], 90, timing).tasks),
    [60, 30],
  );
  expectEqual(
    "and reports no rebalance, so nothing is toasted over an unchanged list",
    collapseToWindow([task("a", 90)], 90, timing).rescaled,
    false,
  );

  // ---- Short of the window ----
  //
  // The event end is the actual finish, so a shortfall is real time on the job
  // that a rounded description did not capture. It is billed, not written off.

  // Every line is pinned and one has a stated duration, so the largest line takes
  // the difference.
  const pinned = collapseToWindow(
    [task("stated", 90, "explicit"), task("quick", 15, "short")],
    110,
    timing,
  );
  expectEqual(
    "all-pinned lines short of the window are filled to it",
    minutesOf(pinned.tasks),
    [95, 15],
  );
  expectEqual("filling counts as a rebalance, so the operator is told", pinned.rescaled, true);
  expectEqual("nothing is dropped when growing", pinned.dropped, 0);

  // A floating task has no stated duration, so it absorbs the difference before
  // any pinned line is touched.
  expectEqual(
    "a floating task takes the shortfall, not the explicit one",
    minutesOf(
      collapseToWindow([task("main", 60), task("stated", 30, "explicit")], 110, timing).tasks,
    ),
    [80, 30],
  );

  expectEqual(
    "two floating tasks grow in proportion",
    minutesOf(collapseToWindow([task("a", 60), task("b", 30)], 120, timing).tasks),
    [80, 40],
  );

  // Only quick-task guesses and no stated time: none of them is the main job, so
  // they share the window rather than one line taking all the slack.
  expectEqual(
    "quick-task guesses with no stated time share the window evenly",
    minutesOf(collapseToWindow([task("a", 15, "short"), task("b", 15, "short")], 70, timing).tasks),
    [35, 35],
  );

  // A floating line at 0 min has no proportion to scale by; it must not turn the
  // totals into NaN.
  expectEqual(
    "floating lines at 0 min split what the pinned lines leave",
    minutesOf(
      collapseToWindow([task("quick", 15, "short"), task("a", 0), task("b", 0)], 75, timing).tasks,
    ),
    [15, 30, 30],
  );

  expectEqual(
    "a short-task pin is left alone while something floats",
    minutesOf(collapseToWindow([task("main", 60), task("quick", 15, "short")], 100, timing).tasks),
    [85, 15],
  );

  // The snap grid cannot always divide the remainder evenly, so the leftover is
  // parked on the largest line and the total still lands on the window.
  const uneven = collapseToWindow([task("a", 50), task("b", 25)], 98, timing);
  expectEqual(
    "an uneven split still totals the window exactly",
    minutesOf(uneven.tasks).reduce((s, m) => s + m, 0),
    98,
  );

  expectEqual(
    "input order survives a fill",
    collapseToWindow([task("first", 30), task("second", 60)], 120, timing).tasks.map(
      (t) => t.description,
    ),
    ["first", "second"],
  );

  // ---- Over the window ----
  //
  // Unchanged behaviour, kept here so the two directions are pinned together.

  expectEqual(
    "an over-long floating task is scaled down",
    minutesOf(collapseToWindow([task("a", 120), task("b", 60)], 90, timing).tasks),
    [60, 30],
  );

  expectEqual(
    "a stated duration is kept when the job overruns",
    minutesOf(
      collapseToWindow([task("floating", 120), task("stated", 30, "explicit")], 90, timing).tasks,
    ),
    [60, 30],
  );

  // ---- Guards ----

  expectEqual(
    "no window means no adjustment",
    minutesOf(collapseToWindow([task("a", 60)], 0, timing).tasks),
    [60],
  );

  expectEqual(
    "flat-rate lines are never touched",
    collapseToWindow(
      [
        task("labour", 60),
        {
          rateConfigId: "travel",
          description: "Travel",
          qty: 1,
          unitPrice: 30,
          lineTotal: 30,
        },
      ],
      90,
      timing,
    ).tasks.filter((t) => t.rateConfigId === "travel").length,
    1,
  );

  // The calculator's Fix banner: whether a Time card edit leaves the tasks off the window.
  console.log("\ntask-time banner\n");
  const stated = [task("TV setup", 30), task("Printer setup", 30), task("MacBook", 20, "explicit")];
  expectEqual("a 79-min window billed as 80 is a match", taskWindowMismatch(stated, 79, 30), null);
  expectEqual(
    "start moved 5 min later with a stated task present still flags over",
    taskWindowMismatch(stated, 75, 30),
    "over",
  );
  expectEqual("end moved 5 min later flags under", taskWindowMismatch(stated, 85, 30), "under");
  expectEqual(
    "all-stated tasks rounded up past the window stay quiet, Fix can't move them",
    taskWindowMismatch([task("A", 15, "explicit"), task("B", 15, "explicit")], 24, 30),
    null,
  );
  expectEqual(
    "a job under the minimum asks to bill the minimum",
    taskWindowMismatch([task("Quick fix", 20)], 20, 30),
    "floor",
  );

  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
