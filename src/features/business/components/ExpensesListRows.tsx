"use client";
// src/features/business/components/ExpensesListRows.tsx
// The visible expense entries, as cards below lg and a sortable table from lg, with the
// recurring and missing-receipt markers and the row actions (asset link, Migrate, Edit,
// Delete). ExpensesView owns the filtering, sorting, paging, the form and the dialogs;
// these only render the rows it hands over.

import {
  PINNED_CELL_CLS,
  ROW_CLS,
  TABLE_CLS,
  TBODY_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_LINK_CLS } from "@/features/admin/components/ui/field-classes";
import { SortableTh } from "@/features/admin/components/ui/SortableTh";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import {
  groupKey,
  matchCount,
  MIGRATE_MIN_MATCHES,
} from "@/features/business/components/expenses-recurrence";
import { LEDGER_TD_CLS, LEDGER_TH_CLS } from "@/features/business/components/ledger-classes";
import { formatNZD } from "@/features/business/lib/business";
import { expenseTaxBasis } from "@/features/business/lib/tax/gst-basis";
import type { GstStatus } from "@/features/business/lib/tax/types";
import type { ExpenseEntry } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";

/** Sortable column keys. */
export type ExpenseSortKey = "date" | "supplier" | "amount";
/** Sort direction. */
export type ExpenseSortDir = "asc" | "desc";

/** Props shared by the card list and the table. */
interface ExpenseRowsProps {
  /** Entries on screen (the pager's visible slice). */
  rows: ExpenseEntry[];
  /** Supplier+description groups, for the recurring marker. */
  recurringGroups: Map<string, ExpenseEntry[]>;
  /** Group keys with an active subscription, or null until loaded. */
  subscribedKeys: Set<string> | null;
  /** Whether a row offers Migrate. */
  canMigrate: (e: ExpenseEntry) => boolean;
  /** GST registration status, for the asset link's cost basis. */
  gst: GstStatus;
  /** Low-value write-off threshold. */
  assetThreshold: number;
  /** Expenses already linked to an asset. */
  linkedSet: Set<string>;
  /** Opens the migrate dialog for a row. */
  onMigrate: (e: ExpenseEntry) => void;
  /** Loads a row into the edit form. */
  onEdit: (e: ExpenseEntry) => void;
  /** Opens the delete confirm for a row. */
  onDelete: (id: string) => void;
}

/**
 * "Turn into an asset" for an expense over the low-value threshold, or "View asset" once
 * an asset links it; nothing for smaller rows. Both open the Assets page, which fills a
 * new asset from the expense or opens the linked one. The cost compared is the GST basis
 * (incl. GST before registration, excl. after), the same figure the write-off test uses.
 * @param props - Component props.
 * @param props.entry - The expense row.
 * @param props.gst - GST registration status, for the expense's cost basis.
 * @param props.threshold - Low-value write-off threshold.
 * @param props.linked - Whether an asset already links this expense.
 * @param props.className - Classes matching the row's other actions.
 * @returns The link, or null.
 */
function AssetLink({
  entry,
  gst,
  threshold,
  linked,
  className,
}: {
  entry: ExpenseEntry;
  gst: GstStatus;
  threshold: number;
  linked: boolean;
  className: string;
}): React.ReactElement | null {
  if (!linked && expenseTaxBasis(entry, gst) <= threshold) return null;
  return (
    <Link
      href={`/admin/business/assets?fromExpense=${entry.id}`}
      className={cn(className, "max-md:hidden")}
    >
      {linked ? "View asset" : "Turn into an asset"}
    </Link>
  );
}

/**
 * The "subscription" / "recurring ×N" text for a repeat cost, or null for a one-off.
 * @param props - Component props.
 * @param props.entry - The expense row.
 * @param props.recurringGroups - Supplier+description groups.
 * @param props.subscribedKeys - Group keys with an active subscription.
 * @returns The marker, or null.
 */
function RecurringMarker({
  entry,
  recurringGroups,
  subscribedKeys,
}: {
  entry: ExpenseEntry;
  recurringGroups: Map<string, ExpenseEntry[]>;
  subscribedKeys: Set<string> | null;
}): React.ReactElement | null {
  if (matchCount(recurringGroups, entry) < MIGRATE_MIN_MATCHES) return null;
  return (
    <StatusPill tone="violet" className="ml-2 font-semibold">
      {subscribedKeys?.has(groupKey(entry))
        ? "subscription"
        : `recurring ×${matchCount(recurringGroups, entry)}`}
    </StatusPill>
  );
}

/**
 * The asset link, Migrate, Edit and Delete for one row.
 * @param props - Component props.
 * @param props.entry - The expense row.
 * @param props.canMigrate - Whether the row offers Migrate.
 * @param props.gst - GST registration status.
 * @param props.assetThreshold - Low-value write-off threshold.
 * @param props.linkedSet - Expenses already linked to an asset.
 * @param props.onMigrate - Opens the migrate dialog.
 * @param props.onEdit - Loads the row into the edit form.
 * @param props.onDelete - Opens the delete confirm.
 * @returns The actions (fragments).
 */
function ExpenseRowActions({
  entry,
  canMigrate,
  gst,
  assetThreshold,
  linkedSet,
  onMigrate,
  onEdit,
  onDelete,
}: Pick<
  ExpenseRowsProps,
  "canMigrate" | "gst" | "assetThreshold" | "linkedSet" | "onMigrate" | "onEdit" | "onDelete"
> & { entry: ExpenseEntry }): React.ReactElement {
  return (
    <>
      <AssetLink
        entry={entry}
        gst={gst}
        threshold={assetThreshold}
        linked={linkedSet.has(entry.id)}
        className={cn("text-sm", ADMIN_LINK_CLS, "inline-flex h-8 items-center whitespace-nowrap")}
      />
      {canMigrate(entry) && (
        <AdminButton size="xs" variant="secondary" onClick={() => onMigrate(entry)}>
          Migrate
        </AdminButton>
      )}
      {/* Edit and Delete wrap as a pair, so a wrapped row never splits them. */}
      <span className="flex gap-2">
        <AdminButton size="xs" variant="secondary" onClick={() => onEdit(entry)}>
          Edit
        </AdminButton>
        <AdminButton size="xs" variant="danger" onClick={() => onDelete(entry.id)}>
          Delete
        </AdminButton>
      </span>
    </>
  );
}

/**
 * Phone card list.
 * @param props - Component props.
 * @param props.rows - Entries on screen.
 * @param props.recurringGroups - Supplier+description groups.
 * @param props.subscribedKeys - Group keys with an active subscription.
 * @param props.canMigrate - Whether a row offers Migrate.
 * @param props.gst - GST registration status.
 * @param props.assetThreshold - Low-value write-off threshold.
 * @param props.linkedSet - Expenses already linked to an asset.
 * @param props.onMigrate - Opens the migrate dialog.
 * @param props.onEdit - Loads a row into the edit form.
 * @param props.onDelete - Opens the delete confirm.
 * @returns The cards, hidden from lg.
 */
export function ExpensesListCards({
  rows,
  recurringGroups,
  subscribedKeys,
  ...actions
}: ExpenseRowsProps): React.ReactElement {
  return (
    <div className="space-y-2 lg:hidden">
      {rows.map((e) => (
        <Card key={e.id} padding="sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.9375rem] font-semibold text-admin-text">
                {e.supplier}
              </p>
              <p className="flex flex-wrap items-center gap-y-1 text-sm text-admin-muted">
                <span className="min-w-0 truncate">{e.category}</span>
                <RecurringMarker
                  entry={e}
                  recurringGroups={recurringGroups}
                  subscribedKeys={subscribedKeys}
                />
                {!e.receipt && (
                  <span className="ml-2 whitespace-nowrap text-amber-700">no receipt</span>
                )}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[0.9375rem] font-semibold text-admin-text">
                {formatNZD(e.amountExcl)}
              </p>
              <p className="text-sm text-admin-muted">{formatNZD(e.amountIncl)} incl.</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-admin-muted">
            <span>{formatDateShort(e.date)}</span>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <ExpenseRowActions entry={e} {...actions} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Desktop table with sortable Date, Supplier and Excl. GST columns. The actions column is
 * pinned right, so the row actions stay reachable when the table scrolls sideways.
 * @param props - Component props.
 * @param props.rows - Entries on screen.
 * @param props.recurringGroups - Supplier+description groups.
 * @param props.subscribedKeys - Group keys with an active subscription.
 * @param props.canMigrate - Whether a row offers Migrate.
 * @param props.gst - GST registration status.
 * @param props.assetThreshold - Low-value write-off threshold.
 * @param props.linkedSet - Expenses already linked to an asset.
 * @param props.onMigrate - Opens the migrate dialog.
 * @param props.onEdit - Loads a row into the edit form.
 * @param props.onDelete - Opens the delete confirm.
 * @param props.sortKey - Active sort column.
 * @param props.sortDir - Active sort direction.
 * @param props.onSort - Toggles the sort on a column.
 * @returns The table, shown from lg.
 */
export function ExpensesListTable({
  rows,
  recurringGroups,
  subscribedKeys,
  sortKey,
  sortDir,
  onSort,
  ...actions
}: ExpenseRowsProps & {
  sortKey: ExpenseSortKey;
  sortDir: ExpenseSortDir;
  onSort: (key: ExpenseSortKey) => void;
}): React.ReactElement {
  return (
    <Card padding="none" className="hidden overflow-x-auto lg:block">
      <table className={TABLE_CLS}>
        <thead className={THEAD_CLS}>
          <tr>
            <SortableTh
              label="Date"
              active={sortKey === "date"}
              dir={sortDir}
              onSort={() => onSort("date")}
              className="max-xl:px-3"
            />
            <SortableTh
              label="Supplier"
              active={sortKey === "supplier"}
              dir={sortDir}
              onSort={() => onSort("supplier")}
              className="max-xl:px-3"
            />
            <th className={LEDGER_TH_CLS}>Category</th>
            <th className={LEDGER_TH_CLS}>Incl. GST</th>
            <SortableTh
              label="Excl. GST"
              active={sortKey === "amount"}
              dir={sortDir}
              onSort={() => onSort("amount")}
              className="max-xl:px-3"
            />
            <th className={cn(LEDGER_TH_CLS, PINNED_CELL_CLS, "bg-admin-bg")} />
          </tr>
        </thead>
        <tbody className={TBODY_CLS}>
          {rows.map((e) => (
            <tr key={e.id} className={cn(ROW_CLS, "group")}>
              <td className={cn(LEDGER_TD_CLS, "whitespace-nowrap text-admin-text-secondary")}>
                {formatDateShort(e.date)}
              </td>
              <td className={cn(LEDGER_TD_CLS, "font-medium text-admin-text")}>
                {e.supplier}
                <RecurringMarker
                  entry={e}
                  recurringGroups={recurringGroups}
                  subscribedKeys={subscribedKeys}
                />
                {!e.receipt && (
                  <span className="ml-2 text-sm font-normal whitespace-nowrap text-amber-700">
                    no receipt
                  </span>
                )}
              </td>
              <td className={cn(LEDGER_TD_CLS, "text-admin-text-secondary")}>{e.category}</td>
              <td className={cn(LEDGER_TD_CLS, "whitespace-nowrap text-admin-text-secondary")}>
                {formatNZD(e.amountIncl)}
              </td>
              <td className={cn(LEDGER_TD_CLS, "font-semibold whitespace-nowrap text-admin-text")}>
                {formatNZD(e.amountExcl)}
              </td>
              <td
                className={cn(
                  LEDGER_TD_CLS,
                  PINNED_CELL_CLS,
                  "bg-admin-surface group-hover:bg-admin-bg max-xl:w-44",
                )}
              >
                {/* Below xl the column stays narrow and a row's extra actions (asset link,
                    Migrate) wrap onto a second line, so Excl. GST isn't hidden under it. */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <ExpenseRowActions entry={e} {...actions} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
