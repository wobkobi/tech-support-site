// scripts/check-sheets-deletions.ts
// Sheet-wins deletion planner fixtures: which linked site rows a sync run removes, and every
// guard that stops it removing anything.
// Run with: npm test -- sheets-deletions

import {
  MAX_SHEET_DELETIONS_PER_RUN,
  describeLedgerRow,
  planSheetDeletions,
  rowHasData,
  type LinkedLedgerRow,
  type SheetDeletionInput,
} from "@/features/business/lib/sheets-deletions";
import { expectEqual, finish } from "./lib/harness.js";

const NOW = new Date("2026-11-17T06:00:00.000Z");
const OLD = new Date("2026-07-11T00:56:49.851Z");

/**
 * A linked income row written long before {@link NOW}.
 * @param n - Row number, used for the id and Sync ID.
 * @param over - Field overrides.
 * @returns The row.
 */
function row(n: number, over: Partial<LinkedLedgerRow> = {}): LinkedLedgerRow {
  return {
    kind: "income",
    id: `id${n}`,
    syncId: `sync${n}`,
    date: new Date("2026-07-11T00:00:00.000Z"),
    party: `Customer ${n}`,
    description: `Invoice ${n}`,
    amount: 100,
    invoiceId: null,
    createdAt: OLD,
    updatedAt: OLD,
    ...over,
  };
}

/**
 * Planner input: `count` linked rows, all seen except the listed row numbers.
 * @param count - How many linked rows.
 * @param missing - Row numbers missing from every Sheet.
 * @param over - Input overrides.
 * @returns The input.
 */
function input(
  count: number,
  missing: readonly number[],
  over: Partial<SheetDeletionInput> = {},
): SheetDeletionInput {
  const linked = Array.from({ length: count }, (_, i) => row(i + 1));
  const seen = new Set(linked.filter((_, i) => !missing.includes(i + 1)).map((r) => r.syncId));
  return {
    linked,
    seen,
    partial: new Set(),
    scanComplete: true,
    emptyWorkbooks: [],
    now: NOW,
    ...over,
  };
}

/**
 * The plan's outcome in a comparable shape.
 * @param plan - Planner output.
 * @returns Status plus the ids it would delete (or the block code and candidate ids).
 */
function summary(plan: ReturnType<typeof planSheetDeletions>): unknown {
  return plan.status === "ok"
    ? ["ok", plan.toDelete.map((r) => r.id), plan.held.map((h) => [h.row.id, h.reason])]
    : ["blocked", plan.block, plan.candidates.map((r) => r.id)];
}

console.log("\nDeletion plan:");
expectEqual("nothing missing", summary(planSheetDeletions(input(50, []))), ["ok", [], []]);
expectEqual("one row deleted in the Sheet", summary(planSheetDeletions(input(50, [7]))), [
  "ok",
  ["id7"],
  [],
]);
// A cleared row keeps its Sync ID in hidden column Z but no data, so it isn't in `partial`.
expectEqual(
  "half-edited row is held, not deleted",
  summary(planSheetDeletions(input(50, [7, 8], { partial: new Set(["sync8"]) }))),
  ["ok", ["id7"], [["id8", "half-edited"]]],
);
const fresh = input(50, [3]);
fresh.linked[2]!.updatedAt = new Date(NOW.getTime() - 30 * 60_000);
expectEqual("row edited 30 minutes ago is held", summary(planSheetDeletions(fresh)), [
  "ok",
  [],
  [["id3", "recent"]],
]);

console.log("\nGuards:");
expectEqual(
  "a workbook failed to read",
  summary(planSheetDeletions(input(50, [7], { scanComplete: false }))),
  ["blocked", "unreadable", ["id7"]],
);
expectEqual(
  "a workbook came back empty",
  summary(planSheetDeletions(input(50, [7], { emptyWorkbooks: ["2025-26"] }))),
  ["blocked", "empty", ["id7"]],
);
expectEqual(
  "nothing seen at all",
  (summary(planSheetDeletions(input(5, [1, 2, 3, 4, 5]))) as unknown[]).slice(0, 2),
  ["blocked", "nothing-seen"],
);
const many = Array.from({ length: MAX_SHEET_DELETIONS_PER_RUN + 1 }, (_, i) => i + 1);
expectEqual(
  "over the per-run cap",
  (summary(planSheetDeletions(input(500, many))) as unknown[]).slice(0, 2),
  ["blocked", "too-many"],
);
expectEqual(
  "at the per-run cap is allowed",
  (summary(planSheetDeletions(input(500, many.slice(1)))) as unknown[])[0],
  "ok",
);
// 3 of 20 is 15%, over the 10% share even though under the count cap.
expectEqual(
  "over the share of the books",
  (summary(planSheetDeletions(input(20, [1, 2, 3]))) as unknown[]).slice(0, 2),
  ["blocked", "too-large-share"],
);
expectEqual(
  "no missing rows: nothing to block",
  summary(planSheetDeletions(input(20, [], { scanComplete: false }))),
  ["ok", [], []],
);

console.log("\nHelpers:");
expectEqual(
  "cleared Cashbook row (formula columns only) has no data",
  rowHasData(["", "", "", "", "", "", "0", ""], [0, 1, 2, 4]),
  false,
);
expectEqual(
  "half-typed row has data",
  rowHasData(["11/07/2026", "Yeen Chan", "", "", ""], [0, 1, 2, 4]),
  true,
);
expectEqual(
  "describe",
  describeLedgerRow(row(1, { party: "Yeen Chan", amount: 342.25 })),
  "11/07/2026 Yeen Chan $342.25",
);

finish();
