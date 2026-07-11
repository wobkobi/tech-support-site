"use client";
// src/features/business/components/InvoicesListView.tsx
/**
 * @description Lists every invoice with client-side search, status/date
 * filtering, sortable columns, and clickable summary cards. Status is shown as a
 * derived badge (SENT-past-due surfaces as OVERDUE) - there is no inline status
 * dropdown; a payment is recorded through {@link PaymentDialog} (POST /pay), and
 * voiding lives on the invoice detail page so a client notification can be sent.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { useToast } from "@/features/admin/components/ui/Toast";
import { InvoiceStatusBadge } from "@/features/business/components/invoice/InvoiceStatusBadge";
import { PaymentDialog } from "@/features/business/components/invoice/PaymentDialog";
import { formatNZD } from "@/features/business/lib/business";
import {
  deriveInvoiceDisplayStatus,
  isInvoiceOverdue,
} from "@/features/business/lib/invoice-status";
import type { Invoice } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { FaCaretRight } from "react-icons/fa6";

/** Status filter buckets (OVERDUE is derived, not a stored status). */
type FilterKey = "all" | "DRAFT" | "SENT" | "OVERDUE" | "PAID" | "VOIDED";
/** Sortable column keys. */
type SortKey = "number" | "client" | "issued" | "due" | "total" | "status";
/** Sort direction. */
type SortDir = "asc" | "desc";
/** Which Drive action (if any) is currently running. */
type SyncMode = "import" | "sync" | null;

/** Sortable columns, in table order. */
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "number", label: "Number" },
  { key: "client", label: "Client" },
  { key: "issued", label: "Issued" },
  { key: "due", label: "Due" },
  { key: "total", label: "Total" },
  { key: "status", label: "Status" },
];

/** Status-filter dropdown options. */
const FILTER_OPTIONS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "PAID", label: "Paid" },
  { value: "VOIDED", label: "Voided" },
];

const CONTROL_CLS =
  "h-9 rounded-lg border border-admin-border-strong bg-admin-surface px-3 text-sm text-admin-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet";

/** Rows shown per page before pagination kicks in. */
const PAGE_SIZE = 25;

/**
 * Whether a payment can be recorded from the list: DRAFT or SENT only (PAID is
 * already settled, VOIDED can't be paid).
 * @param inv - The invoice.
 * @returns True when the Record-payment action should show.
 */
function canPay(inv: Invoice): boolean {
  return inv.status === "DRAFT" || inv.status === "SENT";
}

/**
 * Client component listing all invoices with search, filters, sortable columns,
 * summary cards, and a payment-recording action.
 * @returns The invoices list element.
 */
export function InvoicesListView(): React.ReactElement {
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncMode, setSyncMode] = useState<SyncMode>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterKey>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("issued");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);

  // One "now" per mount so the OVERDUE derivation stays stable across renders.
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    fetch("/api/business/invoices")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setInvoices(d.invoices);
      })
      .catch(() => toast("Couldn't load invoices. Refresh to try again.", { tone: "error" }))
      .finally(() => setLoading(false));
  }, [toast]);

  /** Reloads the full invoice list from the server. */
  async function reload(): Promise<void> {
    const r = await fetch("/api/business/invoices");
    const d = await r.json();
    if (d.ok) setInvoices(d.invoices);
  }

  /**
   * Refreshes a single invoice row after a payment (picks up paidAt + method).
   * @param id - Invoice ID to refresh.
   */
  async function refreshInvoice(id: string): Promise<void> {
    const r = await fetch(`/api/business/invoices/${id}`);
    const d = await r.json();
    if (d.ok) setInvoices((prev) => prev.map((i) => (i.id === id ? d.invoice : i)));
  }

  /** Imports new invoices from Google Drive PDFs and refreshes the list. */
  async function handleImportDrive(): Promise<void> {
    setSyncMode("import");
    try {
      const res = await fetch("/api/business/invoices/import-drive", { method: "POST" });
      const d = await res.json();
      if (d.ok) {
        toast(
          `Imported ${d.created} invoice${d.created !== 1 ? "s" : ""} from Drive.${
            d.errors ? ` ${d.errors} error${d.errors !== 1 ? "s" : ""}.` : ""
          }`,
          { tone: d.errors ? "warning" : "success" },
        );
        await reload();
      } else {
        toast("Import from Drive failed.", { tone: "error" });
      }
    } catch {
      toast("Import from Drive failed. Check your connection.", { tone: "error" });
    }
    setSyncMode(null);
  }

  /** Syncs Drive PDF links onto existing invoice records and refreshes the list. */
  async function handleSyncDrive(): Promise<void> {
    setSyncMode("sync");
    try {
      const res = await fetch("/api/business/invoices/sync-drive", { method: "POST" });
      const d = await res.json();
      if (d.ok) {
        toast(`Synced ${d.matched} invoice${d.matched !== 1 ? "s" : ""} from Drive.`, {
          tone: "success",
        });
        await reload();
      } else {
        toast("Drive sync failed.", { tone: "error" });
      }
    } catch {
      toast("Drive sync failed. Check your connection.", { tone: "error" });
    }
    setSyncMode(null);
  }

  /**
   * Applies a sort: toggles direction on the active column, else switches column
   * (dates + totals default to descending, text to ascending).
   * @param key - Column to sort by.
   */
  function toggleSort(key: SortKey): void {
    setPage(1);
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "issued" || key === "due" || key === "total" ? "desc" : "asc");
    }
  }

  /**
   * Toggles a summary-card filter: clicking the active bucket clears it.
   * @param key - Filter bucket the card represents.
   */
  function toggleFilter(key: FilterKey): void {
    setPage(1);
    setStatusFilter((s) => (s === key ? "all" : key));
  }

  // Summary across ALL invoices (not the filtered view). Legacy PAID rows with no
  // paidAt are excluded from "paid this month" - their pay date is unknown.
  const summary = useMemo(() => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let outstanding = 0;
    let overdue = 0;
    let overdueCount = 0;
    let paidThisMonth = 0;
    let paidCount = 0;
    let draftCount = 0;
    let draftSum = 0;
    for (const inv of invoices) {
      if (inv.status === "SENT") {
        outstanding += inv.total;
        if (isInvoiceOverdue(inv, now)) {
          overdue += inv.total;
          overdueCount += 1;
        }
      }
      if (inv.status === "PAID" && inv.paidAt && new Date(inv.paidAt) >= monthStart) {
        paidThisMonth += inv.total;
        paidCount += 1;
      }
      if (inv.status === "DRAFT") {
        draftCount += 1;
        draftSum += inv.total;
      }
    }
    return { outstanding, overdue, overdueCount, paidThisMonth, paidCount, draftCount, draftSum };
  }, [invoices, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = fromDate ? new Date(fromDate) : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`) : null;
    return invoices.filter((inv) => {
      if (q && !inv.number.toLowerCase().includes(q) && !inv.clientName.toLowerCase().includes(q)) {
        return false;
      }
      if (statusFilter === "OVERDUE") {
        if (!isInvoiceOverdue(inv, now)) return false;
      } else if (statusFilter !== "all" && inv.status !== statusFilter) {
        return false;
      }
      const issued = new Date(inv.issueDate);
      if (from && issued < from) return false;
      if (to && issued > to) return false;
      return true;
    });
  }, [invoices, search, statusFilter, fromDate, toDate, now]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "number":
          return a.number.localeCompare(b.number) * dir;
        case "client":
          return a.clientName.localeCompare(b.clientName) * dir;
        case "issued":
          return (new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime()) * dir;
        case "due":
          return (new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()) * dir;
        case "total":
          return (a.total - b.total) * dir;
        case "status":
          return (
            deriveInvoiceDisplayStatus(a, now).localeCompare(deriveInvoiceDisplayStatus(b, now)) *
            dir
          );
      }
    });
  }, [filtered, sortKey, sortDir, now]);

  const anyFilterActive =
    search !== "" || statusFilter !== "all" || fromDate !== "" || toDate !== "";

  // Pagination. currentPage clamps defensively so a filter change that shrinks
  // the result set can never leave us slicing past the end (page state may lag
  // one render behind the filter handlers that reset it).
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [sorted, currentPage],
  );
  const rangeStart = sorted.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, sorted.length);

  return (
    <div>
      <PageHeader
        title="Invoices"
        actions={
          <>
            <AdminButton
              variant="secondary"
              onClick={() => void handleImportDrive()}
              busy={syncMode === "import"}
              disabled={syncMode !== null}
            >
              Import from Drive
            </AdminButton>
            <AdminButton
              variant="secondary"
              onClick={() => void handleSyncDrive()}
              busy={syncMode === "sync"}
              disabled={syncMode !== null}
            >
              Sync Drive
            </AdminButton>
            <AdminButton href="/admin/business/calculator">New invoice</AdminButton>
          </>
        }
      />

      {/* Summary cards double as one-click status filters. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Outstanding"
          value={formatNZD(summary.outstanding)}
          sub="Sent, awaiting payment"
          tone="violet"
          onClick={() => toggleFilter("SENT")}
          active={statusFilter === "SENT"}
        />
        <StatCard
          label="Overdue"
          value={formatNZD(summary.overdue)}
          sub={`${summary.overdueCount} invoice${summary.overdueCount !== 1 ? "s" : ""} past due`}
          tone="critical"
          onClick={() => toggleFilter("OVERDUE")}
          active={statusFilter === "OVERDUE"}
        />
        <StatCard
          label="Paid this month"
          value={formatNZD(summary.paidThisMonth)}
          sub={`${summary.paidCount} invoice${summary.paidCount !== 1 ? "s" : ""}`}
          tone="success"
          onClick={() => toggleFilter("PAID")}
          active={statusFilter === "PAID"}
        />
        <StatCard
          label="Drafts"
          value={summary.draftCount}
          sub={formatNZD(summary.draftSum)}
          onClick={() => toggleFilter("DRAFT")}
          active={statusFilter === "DRAFT"}
        />
      </div>

      {/* Filter controls. */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Number or client name"
            className={CONTROL_CLS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as FilterKey);
              setPage(1);
            }}
            className={CONTROL_CLS}
          >
            {FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">Issued from</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            className={CONTROL_CLS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-admin-muted">Issued to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            className={CONTROL_CLS}
          />
        </label>
        {anyFilterActive && (
          <AdminButton
            variant="ghost"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
              setFromDate("");
              setToDate("");
              setPage(1);
            }}
          >
            Clear
          </AdminButton>
        )}
      </div>

      {/* Mobile card list - below lg the table is hard to read; stack each row
          as a tap-to-open card with the derived status badge. */}
      <div className="space-y-2 lg:hidden">
        {loading ? (
          <p className="rounded-xl border border-admin-border bg-admin-surface px-5 py-6 text-sm text-admin-faint shadow-sm">
            Loading...
          </p>
        ) : sorted.length === 0 ? (
          <p className="rounded-xl border border-admin-border bg-admin-surface px-5 py-6 text-sm text-admin-faint shadow-sm">
            {invoices.length === 0 ? "No invoices yet." : "No invoices match your filters."}
          </p>
        ) : (
          paged.map((inv) => (
            <div
              key={inv.id}
              className={cn(
                "rounded-xl border border-admin-border bg-admin-surface p-3 shadow-sm",
                "transition-colors hover:border-russian-violet/30",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/admin/business/invoices/${inv.id}`}
                  className="font-mono text-xs font-semibold text-admin-text"
                >
                  {inv.number}
                </Link>
                <InvoiceStatusBadge invoice={inv} />
              </div>
              <Link
                href={`/admin/business/invoices/${inv.id}`}
                className="mt-1 block truncate text-sm font-medium text-admin-text"
              >
                {inv.clientName}
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-admin-muted">
                <span>Issued {formatDateShort(inv.issueDate)}</span>
                <span>Due {formatDateShort(inv.dueDate)}</span>
                <span className="font-semibold text-admin-text">{formatNZD(inv.total)}</span>
                {inv.driveWebUrl ? (
                  <a
                    href={inv.driveWebUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex h-8 items-center text-blue-500 hover:text-blue-700"
                  >
                    PDF ↗
                  </a>
                ) : null}
              </div>
              {canPay(inv) && (
                <div className="mt-2">
                  <AdminButton
                    size="xs"
                    variant="secondary"
                    onClick={() => setPayTarget(inv)}
                    aria-label={`Record payment for ${inv.number}`}
                  >
                    Record payment
                  </AdminButton>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Desktop table - sortable headers, derived status badge, row-click opens
          the invoice. */}
      <div className="hidden overflow-x-auto rounded-xl border border-admin-border bg-admin-surface shadow-sm lg:block">
        {loading ? (
          <p className="px-5 py-6 text-sm text-admin-faint">Loading...</p>
        ) : sorted.length === 0 ? (
          <p className="px-5 py-6 text-sm text-admin-faint">
            {invoices.length === 0 ? "No invoices yet." : "No invoices match your filters."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-admin-border bg-admin-bg">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-left text-xs font-semibold text-admin-muted"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-admin-text"
                    >
                      {col.label}
                      {sortKey === col.key && (
                        <span aria-hidden className="text-[0.6rem] text-admin-text">
                          {sortDir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-semibold text-admin-muted">PDF</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {paged.map((inv) => (
                <tr key={inv.id} className="hover:bg-admin-bg">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-admin-text">
                    {inv.number}
                  </td>
                  <td className="px-4 py-3 font-medium text-admin-text">{inv.clientName}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-admin-muted">
                    {formatDateShort(inv.issueDate)}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-admin-muted">
                    {formatDateShort(inv.dueDate)}
                  </td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap text-admin-text">
                    {formatNZD(inv.total)}
                  </td>
                  <td className="px-4 py-3">
                    <InvoiceStatusBadge invoice={inv} />
                  </td>
                  <td className="px-4 py-3">
                    {inv.driveWebUrl ? (
                      <a
                        href={inv.driveWebUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-500 hover:text-blue-700"
                      >
                        PDF ↗
                      </a>
                    ) : (
                      <span className="text-xs text-admin-faint">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {canPay(inv) && (
                        <AdminButton
                          size="xs"
                          variant="secondary"
                          onClick={() => setPayTarget(inv)}
                          aria-label={`Record payment for ${inv.number}`}
                        >
                          Record payment
                        </AdminButton>
                      )}
                      <Link
                        href={`/admin/business/invoices/${inv.id}`}
                        className="inline-flex items-center gap-1 text-xs text-admin-faint hover:text-admin-text"
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
        )}
      </div>

      {/* Pagination - only when the filtered set spills past one page. */}
      {!loading && sorted.length > PAGE_SIZE && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-admin-muted">
          <span>
            Showing {rangeStart}-{rangeEnd} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <AdminButton
              variant="secondary"
              size="xs"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              Previous
            </AdminButton>
            <span className="px-1 font-medium text-admin-text">
              Page {currentPage} of {totalPages}
            </span>
            <AdminButton
              variant="secondary"
              size="xs"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              Next
            </AdminButton>
          </div>
        </div>
      )}

      {payTarget && (
        <PaymentDialog
          open
          invoice={{
            id: payTarget.id,
            number: payTarget.number,
            total: payTarget.total,
            clientName: payTarget.clientName,
            status: payTarget.status,
            paidAt: payTarget.paidAt,
          }}
          onClose={(recorded) => {
            const id = payTarget.id;
            setPayTarget(null);
            if (recorded) void refreshInvoice(id);
          }}
        />
      )}
    </div>
  );
}
