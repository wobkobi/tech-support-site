"use client";
// src/features/business/components/InvoicesListRows.tsx
// The current page of invoices, as tap-to-open cards below lg and a sortable table from
// lg. InvoicesListView owns the filtering, sorting, paging and the payment dialog; these
// only render the rows it hands over.

import {
  PINNED_CELL_CLS,
  ROW_CLS,
  TABLE_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_LINK_CLS } from "@/features/admin/components/ui/field-classes";
import { SortableTh } from "@/features/admin/components/ui/SortableTh";
import { InvoiceStatusBadge } from "@/features/business/components/invoice/InvoiceStatusBadge";
import {
  canPay,
  COLUMNS,
  type SortDir,
  type SortKey,
} from "@/features/business/components/invoices-list-options";
import { formatNZD } from "@/features/business/lib/business";
import type { Invoice } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";
import { FaCaretRight } from "react-icons/fa6";

/** Tighter side padding below xl, so the eight columns need less sideways scrolling at lg. */
const CELL_CLS = cn(TD_CLS, "max-xl:px-3");
/** Header cell with the same tighter padding. */
const HEAD_CLS = cn(TH_CLS, "max-xl:px-3");

/**
 * Send (DRAFT) or Record payment (SENT invoice) for one row; never both.
 * @param props - Component props.
 * @param props.inv - The invoice.
 * @param props.onPay - Opens the payment dialog for this invoice.
 * @returns The row actions (fragments; nothing when neither applies).
 */
function InvoiceRowActions({
  inv,
  onPay,
}: {
  inv: Invoice;
  onPay: (inv: Invoice) => void;
}): React.ReactElement {
  return (
    <>
      {inv.status === "DRAFT" && (
        <AdminButton
          size="xs"
          variant="secondary"
          href={`/admin/business/invoices/${inv.id}?send=1`}
          aria-label={`Send ${inv.isQuote ? "quote" : "invoice"} ${inv.number}`}
        >
          {inv.isQuote ? "Send quote" : "Send invoice"}
        </AdminButton>
      )}
      {canPay(inv) && (
        <AdminButton
          size="xs"
          variant="secondary"
          onClick={() => onPay(inv)}
          aria-label={`Record payment for ${inv.number}`}
        >
          Record payment
        </AdminButton>
      )}
    </>
  );
}

/**
 * Phone card list: each invoice as a card with the derived status badge.
 * @param props - Component props.
 * @param props.rows - Invoices on the current page.
 * @param props.onPay - Opens the payment dialog for an invoice.
 * @returns The card list, hidden from lg.
 */
export function InvoicesListCards({
  rows,
  onPay,
}: {
  rows: Invoice[];
  onPay: (inv: Invoice) => void;
}): React.ReactElement {
  return (
    <div className="space-y-2 lg:hidden">
      {rows.map((inv) => (
        <Card
          key={inv.id}
          padding="sm"
          className="transition-colors hover:border-russian-violet/30"
        >
          <div className="flex items-center justify-between gap-2">
            <Link
              href={`/admin/business/invoices/${inv.id}`}
              className="font-mono text-sm font-semibold text-admin-text"
            >
              {inv.number}
            </Link>
            <InvoiceStatusBadge invoice={inv} />
          </div>
          <Link
            href={`/admin/business/invoices/${inv.id}`}
            className="mt-1 block truncate text-[0.9375rem] font-semibold text-admin-text"
          >
            {inv.clientName}
            {inv.attention && (
              <span className="ml-2 text-sm font-normal text-admin-muted">
                attn {inv.attention}
              </span>
            )}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-admin-muted">
            <span>Issued {formatDateShort(inv.issueDate)}</span>
            <span>Due {formatDateShort(inv.dueDate)}</span>
            <span className="font-semibold text-admin-text">{formatNZD(inv.total)}</span>
            {inv.driveWebUrl ? (
              <a
                href={inv.driveWebUrl}
                target="_blank"
                rel="noreferrer"
                className={cn("text-sm", ADMIN_LINK_CLS, "ml-auto inline-flex h-8 items-center")}
              >
                PDF ↗
              </a>
            ) : null}
          </div>
          {(inv.status === "DRAFT" || canPay(inv)) && (
            <div className="mt-2 flex flex-wrap gap-2">
              <InvoiceRowActions inv={inv} onPay={onPay} />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

/**
 * Desktop table: sortable headers, derived status badge, PDF link and row actions.
 * @param props - Component props.
 * @param props.rows - Invoices on the current page.
 * @param props.sortKey - Active sort column.
 * @param props.sortDir - Active sort direction.
 * @param props.onSort - Applies a sort on a column (the list decides what toggling means).
 * @param props.onPay - Opens the payment dialog for an invoice.
 * @returns The table, shown from lg.
 */
export function InvoicesListTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  onPay,
}: {
  rows: Invoice[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onPay: (inv: Invoice) => void;
}): React.ReactElement {
  return (
    <Card padding="none" className="hidden overflow-x-auto lg:block">
      <table className={TABLE_CLS}>
        <thead className={THEAD_CLS}>
          <tr>
            {COLUMNS.map((col) => (
              <SortableTh
                key={col.key}
                label={col.label}
                active={sortKey === col.key}
                dir={sortDir}
                onSort={() => onSort(col.key)}
                className="max-xl:px-3"
              />
            ))}
            <th className={HEAD_CLS}>PDF</th>
            <th className={cn(HEAD_CLS, PINNED_CELL_CLS, "bg-admin-bg")} />
          </tr>
        </thead>
        <tbody className={TBODY_CLS}>
          {rows.map((inv) => (
            <tr key={inv.id} className={cn(ROW_CLS, "group")}>
              <td
                className={cn(
                  CELL_CLS,
                  "font-mono text-sm font-semibold whitespace-nowrap text-admin-text",
                )}
              >
                {inv.number}
              </td>
              <td className={cn(CELL_CLS, "font-medium text-admin-text")}>
                {inv.clientName}
                {inv.attention && (
                  <span className="block text-sm font-normal text-admin-muted">
                    attn {inv.attention}
                  </span>
                )}
              </td>
              <td className={cn(CELL_CLS, "whitespace-nowrap text-admin-text-secondary")}>
                {formatDateShort(inv.issueDate)}
              </td>
              <td className={cn(CELL_CLS, "whitespace-nowrap text-admin-text-secondary")}>
                {formatDateShort(inv.dueDate)}
              </td>
              <td className={cn(CELL_CLS, "font-semibold whitespace-nowrap text-admin-text")}>
                {formatNZD(inv.total)}
              </td>
              <td className={CELL_CLS}>
                <InvoiceStatusBadge invoice={inv} />
              </td>
              <td className={CELL_CLS}>
                {inv.driveWebUrl ? (
                  <a
                    href={inv.driveWebUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn("text-sm", ADMIN_LINK_CLS, "whitespace-nowrap")}
                  >
                    PDF ↗
                  </a>
                ) : (
                  <span className="text-sm text-admin-muted">-</span>
                )}
              </td>
              <td
                className={cn(
                  CELL_CLS,
                  PINNED_CELL_CLS,
                  "bg-admin-surface group-hover:bg-admin-bg",
                )}
              >
                <div className="flex items-center justify-end gap-2">
                  <InvoiceRowActions inv={inv} onPay={onPay} />
                  <Link
                    href={`/admin/business/invoices/${inv.id}`}
                    className={cn("text-sm", ADMIN_LINK_CLS, "inline-flex items-center gap-1")}
                  >
                    View
                    <FaCaretRight className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
