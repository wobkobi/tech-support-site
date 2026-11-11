// scripts/check-task-minutes.ts
// How a parsed task's decimal-hours qty becomes billed minutes. The model writes hours to
// 2 dp, so a stated 10 min arrives as 0.17h (10.2 min) and must still bill 10, not 15.
// Run with: npm test -- task-minutes

import { snapTaskQtyMins } from "@/features/business/lib/pricing-policy";
import { expectEqual, finish } from "./lib/harness.js";

console.log("Stated durations at a 5-min step, as the model writes them (2 dp hours):");
const stated: [qty: number, mins: number][] = [
  [0.08, 5],
  [0.17, 10],
  [0.25, 15],
  [0.33, 20],
  [0.42, 25],
  [0.5, 30],
  [0.58, 35],
  [0.67, 40],
  [0.75, 45],
  [0.83, 50],
  [0.92, 55],
  [1.17, 70],
  [1.42, 85],
  [1.67, 100],
];
for (const [qty, mins] of stated) {
  expectEqual(`stated ${mins} min (${qty}h)`, snapTaskQtyMins(qty, true, 5), mins);
}
expectEqual("stated 10 min at full precision", snapTaskQtyMins(10 / 60, true, 5), 10);

console.log("Stated durations off the grid round UP:");
expectEqual("took 12 mins (0.2h) bills 15", snapTaskQtyMins(0.2, true, 5), 15);
expectEqual("took 21 mins (0.35h) bills 25", snapTaskQtyMins(0.35, true, 5), 25);
expectEqual("stated 10 min at a 15-min step bills 15", snapTaskQtyMins(0.17, true, 15), 15);
expectEqual("stated 40 min at a 15-min step bills 45", snapTaskQtyMins(0.67, true, 15), 45);

console.log("Floating tasks round to the nearest step, at least one:");
expectEqual("0.17h floating bills 10", snapTaskQtyMins(0.17, false, 5), 10);
expectEqual("0.42h floating bills 25", snapTaskQtyMins(0.42, false, 5), 25);
expectEqual("6 min floating bills 5", snapTaskQtyMins(0.1, false, 5), 5);
expectEqual("0h floating still bills one step", snapTaskQtyMins(0, false, 5), 5);

finish();
