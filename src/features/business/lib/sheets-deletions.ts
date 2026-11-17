// src/features/business/lib/sheets-deletions.ts
// Which site ledger rows a sheet-wins sync may remove because their Sheet row is gone. Pure:
// the import gathers what it read, this decides, and the guards refuse anything that looks
// like a bad read rather than a real deletion.

/** Most rows one sync run may remove; more than this waits for the owner. */
export const MAX_SHEET_DELETIONS_PER_RUN = 10;

/** Largest share of linked rows one run may remove (10%). */
export const MAX_SHEET_DELETION_SHARE = 0.1;

/** Rows created or edited this recently are left alone: a write may still be landing. */
export const SHEET_DELETION_GRACE_MS = 2 * 60 * 60_000;

/** A site ledger row linked to a Sheet row by its Sync ID. */
export interface LinkedLedgerRow {
  kind: "income" | "expense";
  id: string;
  /** The column-Z Sync ID (sheetRowKey). */
  syncId: string;
  date: Date;
  /** Customer for income, supplier for an expense. */
  party: string;
  description: string;
  /** Income amount, or the expense's GST-inclusive amount. */
  amount: number;
  /** Invoice the income row pays, if any. */
  invoiceId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

/** What one sync run read from the Sheets, for {@link planSheetDeletions}. */
export interface SheetDeletionInput {
  /** Every site row with a Sync ID, from the DB snapshot taken before the Sheets were read. */
  linked: readonly LinkedLedgerRow[];
  /** Sync IDs on readable rows in any workbook read this run, retired ones included. */
  seen: ReadonlySet<string>;
  /** Sync IDs on rows that still hold some data but didn't parse (half-edited). */
  partial: ReadonlySet<string>;
  /** True only when every workbook, retired ones included, was read without an error. */
  scanComplete: boolean;
  /** Workbooks whose read came back with no rows at all in either tab. */
  emptyWorkbooks: readonly string[];
  now: Date;
}

/** A row left in place this run, and why. */
export interface HeldRow {
  row: LinkedLedgerRow;
  reason: "half-edited" | "recent";
}

/** Which guard stopped a deletion pass. */
export type DeletionBlock =
  "unreadable" | "empty" | "nothing-seen" | "too-many" | "too-large-share";

/** Outcome of {@link planSheetDeletions}. */
export type SheetDeletionPlan =
  | { status: "ok"; toDelete: LinkedLedgerRow[]; held: HeldRow[] }
  | {
      status: "blocked";
      block: DeletionBlock;
      reason: string;
      candidates: LinkedLedgerRow[];
      held: HeldRow[];
    };

/**
 * Decides which linked site rows to remove because no Sheet carries their Sync ID any more.
 * A row whose Sync ID sits on a cleared (all blank) Sheet row counts as gone. Blocks the
 * whole pass when the read can't be trusted: a workbook failed or came back blank, nothing
 * was seen at all, or the removals would pass {@link MAX_SHEET_DELETIONS_PER_RUN} or
 * {@link MAX_SHEET_DELETION_SHARE} of the linked rows.
 * @param input - What this run read.
 * @returns Rows to delete, or the reason nothing should be.
 */
export function planSheetDeletions(input: SheetDeletionInput): SheetDeletionPlan {
  const held: HeldRow[] = [];
  const candidates: LinkedLedgerRow[] = [];
  const cutoff = input.now.getTime() - SHEET_DELETION_GRACE_MS;
  for (const row of input.linked) {
    if (input.seen.has(row.syncId)) continue;
    const touched = Math.max(row.createdAt.getTime(), row.updatedAt?.getTime() ?? 0);
    if (input.partial.has(row.syncId)) held.push({ row, reason: "half-edited" });
    else if (touched > cutoff) held.push({ row, reason: "recent" });
    else candidates.push(row);
  }

  /**
   * A blocked plan carrying the candidates and held rows for the owner push.
   * @param code - Which guard tripped.
   * @param reason - Plain-English reason for the push.
   * @returns The blocked plan.
   */
  const block = (code: DeletionBlock, reason: string): SheetDeletionPlan => ({
    status: "blocked",
    block: code,
    reason,
    candidates,
    held,
  });
  if (candidates.length === 0) return { status: "ok", toDelete: [], held };
  if (!input.scanComplete) return block("unreadable", "not every workbook could be read");
  if (input.emptyWorkbooks.length > 0) {
    return block("empty", `${input.emptyWorkbooks.join(", ")} came back empty`);
  }
  if (input.seen.size === 0) return block("nothing-seen", "no Sheet rows were read at all");
  if (candidates.length > MAX_SHEET_DELETIONS_PER_RUN) {
    return block(
      "too-many",
      `${candidates.length} rows would go, over the limit of ${MAX_SHEET_DELETIONS_PER_RUN} a run`,
    );
  }
  if (candidates.length > input.linked.length * MAX_SHEET_DELETION_SHARE) {
    return block(
      "too-large-share",
      `${candidates.length} of ${input.linked.length} rows would go, over ${Math.round(MAX_SHEET_DELETION_SHARE * 100)}% of the books`,
    );
  }
  return { status: "ok", toDelete: candidates, held };
}

/**
 * Whether a Sheet row still holds any of its own data, so a Sync ID left on it means a
 * half-edited row rather than a cleared one. Formula columns are left out on purpose.
 * @param row - The row's cells.
 * @param dataColumns - 0-based columns the owner types into (date, name, description, amount).
 * @returns True when any of those cells is non-blank.
 */
export function rowHasData(row: readonly string[], dataColumns: readonly number[]): boolean {
  return dataColumns.some((c) => (row[c] ?? "").trim() !== "");
}

/**
 * One line per row for logs and the owner push: "11/07/2026 Yeen Chan $342.25".
 * @param row - The row.
 * @returns The line.
 */
export function describeLedgerRow(row: LinkedLedgerRow): string {
  const d = row.date;
  const day = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  return `${day} ${row.party} $${row.amount.toFixed(2)}`;
}
