"use client";
// src/features/business/components/IncomeListRows.tsx
// The visible income entries, as cards below lg and a sortable table from lg. IncomeView
// owns the filtering, sorting, paging, the edit form and the delete confirm; these only
// render the rows it hands over.

import {
  ROW_CLS,
  TABLE_CLS,
  TBODY_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { SortableTh } from "@/features/admin/components/ui/SortableTh";
import {
  LEDGER_LINK_CLS,
  LEDGER_TD_CLS,
  LEDGER_TH_CLS,
  ROW_BUTTON_CLS,
} from "@/features/business/components/ledger-classes";
import { formatNZD } from "@/features/business/lib/business";
import type { IncomeEntry } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";

/** Sortable column keys. */
export type IncomeSortKey = "date" | "customer" | "amount";
/** Sort direction. */
export type IncomeSortDir = "asc" | "desc";

/** Props shared by the card list and the table. */
interface IncomeRowsProps {
  /** Entries on screen (the pager's visible slice). */
  rows: IncomeEntry[];
  /** Loads an entry into the edit form. */
  onEdit: (entry: IncomeEntry) => void;
  /** Opens the delete confirm for an entry. */
  onDelete: (id: string) => void;
}

/**
 * Edit and Delete for one entry.
 * @param props - Component props.
 * @param props.entry - The income entry.
 * @param props.onEdit - Loads it into the edit form.
 * @param props.onDelete - Opens the delete confirm.
 * @returns The two buttons.
 */
function IncomeRowActions({
  entry,
  onEdit,
  onDelete,
}: {
  entry: IncomeEntry;
  onEdit: (entry: IncomeEntry) => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  return (
    <>
      <AdminButton
        size="xs"
        variant="secondary"
        onClick={() => onEdit(entry)}
        className={ROW_BUTTON_CLS}
      >
        Edit
      </AdminButton>
      <AdminButton
        size="xs"
        variant="danger"
        onClick={() => onDelete(entry.id)}
        className={ROW_BUTTON_CLS}
      >
        Delete
      </AdminButton>
    </>
  );
}

/**
 * Phone card list.
 * @param props - Component props.
 * @param props.rows - Entries on screen.
 * @param props.onEdit - Loads an entry into the edit form.
 * @param props.onDelete - Opens the delete confirm for an entry.
 * @returns The cards, hidden from lg.
 */
export function IncomeListCards({ rows, onEdit, onDelete }: IncomeRowsProps): React.ReactElement {
  return (
    <div className="space-y-2 lg:hidden">
      {rows.map((e) => (
        <Card key={e.id} padding="sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.9375rem] font-semibold text-admin-text">
                {e.customer}
              </p>
              <p className="truncate text-sm text-admin-muted">{e.description}</p>
            </div>
            <p className="shrink-0 text-[0.9375rem] font-semibold text-green-700">
              {formatNZD(e.amount)}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-admin-muted">
            <span>{formatDateShort(e.date)}</span>
            <span>{e.method}</span>
            {e.invoiceId && (
              <Link href={`/admin/business/invoices/${e.invoiceId}`} className={LEDGER_LINK_CLS}>
                Invoice ↗
              </Link>
            )}
            <div className="ml-auto flex gap-2">
              <IncomeRowActions entry={e} onEdit={onEdit} onDelete={onDelete} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Desktop table with sortable Date, Customer and Amount columns.
 * @param props - Component props.
 * @param props.rows - Entries on screen.
 * @param props.onEdit - Loads an entry into the edit form.
 * @param props.onDelete - Opens the delete confirm for an entry.
 * @param props.sortKey - Active sort column.
 * @param props.sortDir - Active sort direction.
 * @param props.onSort - Toggles the sort on a column.
 * @returns The table, shown from lg.
 */
export function IncomeListTable({
  rows,
  onEdit,
  onDelete,
  sortKey,
  sortDir,
  onSort,
}: IncomeRowsProps & {
  sortKey: IncomeSortKey;
  sortDir: IncomeSortDir;
  onSort: (key: IncomeSortKey) => void;
}): React.ReactElement {
  return (
    <Card padding="none" className="hidden overflow-x-auto lg:block">
      <table className={TABLE_CLS}>
        <thead className={THEAD_CLS}>
          <tr>
            {(
              [
                { key: "date", label: "Date" },
                { key: "customer", label: "Customer" },
              ] as { key: IncomeSortKey; label: string }[]
            ).map((col) => (
              <SortableTh
                key={col.key}
                label={col.label}
                active={sortKey === col.key}
                dir={sortDir}
                onSort={() => onSort(col.key)}
                className="max-xl:px-3"
              />
            ))}
            <th className={LEDGER_TH_CLS}>Description</th>
            <SortableTh
              label="Amount"
              active={sortKey === "amount"}
              dir={sortDir}
              onSort={() => onSort("amount")}
              className="max-xl:px-3"
            />
            <th className={LEDGER_TH_CLS}>Method</th>
            <th className={LEDGER_TH_CLS} />
          </tr>
        </thead>
        <tbody className={TBODY_CLS}>
          {rows.map((e) => (
            <tr key={e.id} className={ROW_CLS}>
              <td className={cn(LEDGER_TD_CLS, "whitespace-nowrap text-admin-text-secondary")}>
                {formatDateShort(e.date)}
              </td>
              <td className={cn(LEDGER_TD_CLS, "font-medium text-admin-text")}>{e.customer}</td>
              <td className={cn(LEDGER_TD_CLS, "text-admin-text-secondary")}>
                {e.description}
                {e.invoiceId && (
                  <Link
                    href={`/admin/business/invoices/${e.invoiceId}`}
                    className={cn(LEDGER_LINK_CLS, "ml-2 whitespace-nowrap")}
                  >
                    Invoice ↗
                  </Link>
                )}
              </td>
              <td className={cn(LEDGER_TD_CLS, "font-semibold whitespace-nowrap text-green-700")}>
                {formatNZD(e.amount)}
              </td>
              <td className={cn(LEDGER_TD_CLS, "text-admin-text-secondary")}>{e.method}</td>
              <td className={LEDGER_TD_CLS}>
                <div className="flex items-center justify-end gap-2">
                  <IncomeRowActions entry={e} onEdit={onEdit} onDelete={onDelete} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
