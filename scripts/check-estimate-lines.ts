// scripts/check-estimate-lines.ts
// Quote line minutes: on the billing grid, at least one step each, adding up to the estimate.
// Run with: npm test -- estimate-lines

import { fitLinesToTotal } from "@/features/business/lib/estimate-lines";
import { expectEqual, finish } from "./lib/harness.js";

console.log("\nQuote lines fit the estimate:");
expectEqual("lines already on the grid stay", fitLinesToTotal([40, 20], 60, 5), [40, 20]);
expectEqual(
  "a 0-min line gets one step, taken off the largest",
  fitLinesToTotal([0, 60], 60, 5),
  [5, 55],
);
expectEqual("off-grid lines snap and still add up", fitLinesToTotal([33, 27], 60, 5), [35, 25]);
expectEqual("a short split tops up to the estimate", fitLinesToTotal([20, 10], 60, 5), [50, 10]);
expectEqual(
  "more lines than steps keeps one step each",
  fitLinesToTotal([3, 3, 3], 10, 5),
  [5, 5, 5],
);

finish();
