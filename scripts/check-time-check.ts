// scripts/check-time-check.ts
// "Did you mean...?" for times: am/pm slips get a fix, ordinary jobs get nothing, and a slip
// no swap explains gets a plain warning.
// Run with: npm test -- time-check

import { checkRange, checkTime } from "@/features/admin/lib/time-check";
import { expectEqual, finish } from "./lib/harness.js";

/** Runs the fixtures. */
function main(): void {
  /**
   * One range check, flattened for comparing.
   * @param s - Start "HH:mm".
   * @param e - End "HH:mm".
   * @returns "start-end" of the fix, the warning text, or null when the times read fine.
   */
  const fix = (s: string, e: string): string | null => {
    const c = checkRange(s, e);
    return c?.fix ? `${c.fix.start}-${c.fix.end}` : (c?.text ?? null);
  };

  expectEqual("an ordinary afternoon job", fix("15:00", "16:30"), null);
  expectEqual("a late evening job is fine", fix("19:00", "21:30"), null);
  expectEqual("3 pm to 4 am > 4 pm", fix("15:00", "04:00"), "15:00-16:00");
  expectEqual("11 am to 1 am > 1 pm", fix("11:00", "01:00"), "11:00-13:00");
  expectEqual("3 am to 5 am > 3 pm to 5 pm", fix("03:00", "05:00"), "15:00-17:00");
  expectEqual("9 pm start, 11 am end > 9 am", fix("21:00", "11:00"), "09:00-11:00");
  expectEqual("3 pm to 1 am, no am/pm fit, swaps them", fix("15:00", "01:00"), "01:00-15:00");
  expectEqual("the swap is labelled", checkRange("15:00", "01:00")?.fixLabel, "Swap them");
  expectEqual("same time", fix("10:00", "10:00"), "Start and end are the same.");
  expectEqual(
    "8 am to 7 pm is long, no swap fits",
    fix("08:00", "19:00"),
    "That's over 10 hours. Check the times.",
  );
  expectEqual("not set yet", fix("", "10:00"), null);

  expectEqual("single: 2 pm is fine", checkTime("14:00"), null);
  expectEqual("single: 3 am > 3 pm", checkTime("03:00")?.fix, "15:00");
  expectEqual("single: 10:30 pm > 10:30 am", checkTime("22:30")?.fix, "10:30");
  expectEqual("single: 12 am > noon", checkTime("00:00")?.fix, "12:00");
  expectEqual("single: 1 am > 1 pm", checkTime("01:00")?.fix, "13:00");

  finish();
}

main();
