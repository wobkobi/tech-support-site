"use client";
// src/features/business/components/InvoicesListView.tsx
// Lists every invoice with client-side search, status/date filtering, sortable columns,
// and clickable summary cards. Status is shown as a derived badge (SENT-past-due surfaces
// as OVERDUE) - there is no inline status dropdown; a payment is recorded through
// PaymentDialog (POST /pay), and voiding lives on the invoice detail page so a client
// notification can be sent. Filters, sort and page live in the URL (?status=overdue),
// so Back from an invoice and the dashboard's deep links land on the same view.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { useToast } from "@/features/admin/components/ui/Toast";
import { type PageQuery, queryValue, useQuerySync } from "@/features/admin/hooks/use-query-sync";
import { PaymentDialog } from "@/features/business/components/invoice/PaymentDialog";
import {
  COLUMNS,
  FILTER_OPTIONS,
  type FilterKey,
  type SortDir,
  type SortKey,
} from "@/features/business/components/invoices-list-options";
import {
  InvoicesListCards,
  InvoicesListTable,
} from "@/features/business/components/InvoicesListRows";
import { InvoicesListToolbar } from "@/features/business/components/InvoicesListToolbar";
import {
  type InvoicesSummary,
  InvoicesSummaryCards,
} from "@/features/business/components/InvoicesSummaryCards";
import { balanceDue } from "@/features/business/lib/business";
import {
  deriveInvoiceDisplayStatus,
  isInvoiceOverdue,
} from "@/features/business/lib/invoice-status";
import type { Invoice } from "@/features/business/types/business";
import { nzDateKey } from "@/shared/lib/timezone-utils";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

/** Which Drive action (if any) is currently running. */
type SyncMode = "import" | "sync" | null;

/** Rows shown per page before pagination kicks in. */
const PAGE_SIZE = 25;

/**
 * Fetches the full invoice list.
 * @returns The invoices.
 */
async function fetchInvoices(): Promise<Invoice[]> {
  const r = await fetch("/api/business/invoices");
  const d = (await r.json().catch(() => null)) as { ok?: boolean; invoices?: Invoice[] } | null;
  if (!d?.ok || !d.invoices) throw new Error(`Invoice list failed to load (${r.status})`);
  return d.invoices;
}

/**
 * Client component listing all invoices with search, filters, sortable columns,
 * summary cards, and a payment-recording action.
 * @param props - Component props.
 * @param props.query - The page's searchParams, the starting filters.
 * @returns The invoices list element.
 */
export function InvoicesListView({ query }: { query: PageQuery }): React.ReactElement {
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>(null);

  // The URL carries statuses in lower case (?status=overdue).
  const [search, setSearch] = useState(() => queryValue(query, "q"));
  const [statusFilter, setStatusFilter] = useState<FilterKey>(() => {
    const v = queryValue(query, "status").toUpperCase();
    return FILTER_OPTIONS.find((o) => o.value === v)?.value ?? "all";
  });
  const [fromDate, setFromDate] = useState(() => queryValue(query, "from"));
  const [toDate, setToDate] = useState(() => queryValue(query, "to"));
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const v = queryValue(query, "sort");
    return COLUMNS.find((c) => c.key === v)?.key ?? "issued";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    queryValue(query, "dir") === "asc" ? "asc" : "desc",
  );
  const [page, setPage] = useState(() => Math.max(1, Number(queryValue(query, "page")) || 1));
  useQuerySync({
    q: search,
    status: statusFilter === "all" ? "" : statusFilter.toLowerCase(),
    from: fromDate,
    to: toDate,
    sort: sortKey === "issued" && sortDir === "desc" ? "" : sortKey,
    dir: sortKey === "issued" && sortDir === "desc" ? "" : sortDir,
    page: page > 1 ? String(page) : "",
  });
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);

  // One "now" per mount so the OVERDUE derivation stays stable across renders.
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    fetchInvoices()
      .then(setInvoices)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  /**
   * Reloads the full invoice list from the server. A failure keeps the rows
   * already on screen and raises the banner, so an outage never reads as an
   * empty ledger.
   */
  async function reload(): Promise<void> {
    setRetrying(true);
    try {
      setInvoices(await fetchInvoices());
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setRetrying(false);
    }
  }

  /**
   * Refreshes a single invoice row after a payment (picks up paidAt + method).
   * @param id - Invoice ID to refresh.
   */
  async function refreshInvoice(id: string): Promise<void> {
    try {
      const r = await fetch(`/api/business/invoices/${id}`);
      const d = await r.json();
      if (!d.ok) throw new Error(`refresh failed (${r.status})`);
      // The single-invoice endpoint carries no contact fields; keep the list's.
      setInvoices((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...d.invoice,
                contactName: i.contactName,
                contactCompany: i.contactCompany,
                attention: i.attention,
              }
            : i,
        ),
      );
    } catch {
      // The payment itself saved; only this row is stale.
      setLoadError(true);
    }
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

  // Summary across ALL invoices, not the filtered view. Legacy PAID rows with no paidAt
  // are excluded from "paid this month" (unknown pay date), and quotes are not money owed,
  // so they get their own counter and stay out of every dollar stat.
  const summary = useMemo<InvoicesSummary>(() => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let outstanding = 0;
    let overdue = 0;
    let overdueCount = 0;
    let paidThisMonth = 0;
    let paidCount = 0;
    let draftCount = 0;
    let draftSum = 0;
    let quoteCount = 0;
    let quoteSum = 0;
    for (const inv of invoices) {
      if (inv.isQuote) {
        if (inv.status !== "VOIDED") {
          quoteCount += 1;
          quoteSum += inv.total;
        }
        continue;
      }
      if (inv.status === "SENT") {
        // Money handed over on the day is already in, so only the balance is outstanding.
        outstanding += balanceDue(inv);
        if (isInvoiceOverdue(inv, now)) {
          overdue += balanceDue(inv);
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
    return {
      outstanding,
      overdue,
      overdueCount,
      paidThisMonth,
      paidCount,
      draftCount,
      draftSum,
      quoteCount,
      quoteSum,
    };
  }, [invoices, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      // The linked contact's name and company count too, so "michael" finds the
      // invoices addressed to 68 Ltd and "68" finds the ones addressed to him.
      const haystack = [inv.number, inv.clientName, inv.contactName, inv.contactCompany];
      if (q && !haystack.some((field) => field?.toLowerCase().includes(q))) {
        return false;
      }
      if (statusFilter === "OVERDUE") {
        if (!isInvoiceOverdue(inv, now)) return false;
      } else if (statusFilter === "QUOTE") {
        if (!inv.isQuote) return false;
      } else if (statusFilter !== "all" && (inv.status !== statusFilter || inv.isQuote)) {
        // Stored-status buckets are invoice-only: a quote is DRAFT/SENT under
        // the hood but must not surface under those filters.
        return false;
      }
      // Compare NZ calendar days as strings. Parsing an input's YYYY-MM-DD as a
      // Date gives UTC midnight, midday in NZ, which cuts the morning off the
      // first day.
      const issued = nzDateKey(new Date(inv.issueDate));
      if (fromDate && issued < fromDate) return false;
      if (toDate && issued > toDate) return false;
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
  const emptyText =
    invoices.length > 0
      ? "No invoices match your filters."
      : loadError
        ? "Invoices didn't load."
        : "No invoices yet.";

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

      <InvoicesSummaryCards summary={summary} statusFilter={statusFilter} onToggle={toggleFilter} />

      {/* Every filter change goes back to page 1. */}
      <InvoicesListToolbar
        search={search}
        statusFilter={statusFilter}
        fromDate={fromDate}
        toDate={toDate}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        onStatusChange={(v) => {
          setStatusFilter(v);
          setPage(1);
        }}
        onFromChange={(v) => {
          setFromDate(v);
          setPage(1);
        }}
        onToChange={(v) => {
          setToDate(v);
          setPage(1);
        }}
        anyFilterActive={anyFilterActive}
        onClear={() => {
          setSearch("");
          setStatusFilter("all");
          setFromDate("");
          setToDate("");
          setPage(1);
        }}
      />

      {loadError && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>
            {invoices.length === 0
              ? "Couldn't load invoices."
              : "Couldn't refresh invoices - the list may be out of date."}
          </span>
          <AdminButton size="xs" variant="secondary" onClick={() => void reload()} busy={retrying}>
            Try again
          </AdminButton>
        </div>
      )}

      {/* Phone cards below lg (the table is hard to read there), the sortable table from lg. */}
      {loading ? (
        <Card>
          <p className="text-sm text-admin-muted">Loading...</p>
        </Card>
      ) : sorted.length === 0 ? (
        <Card padding="none">
          <EmptyState title={emptyText} />
        </Card>
      ) : (
        <>
          <InvoicesListCards rows={paged} onPay={setPayTarget} />
          <InvoicesListTable
            rows={paged}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            onPay={setPayTarget}
          />
        </>
      )}

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
            balance: balanceDue(payTarget),
            clientName: payTarget.clientName,
            status: payTarget.status,
            paidAt: payTarget.paidAt,
            reminderLastSentAt: payTarget.reminderLastSentAt,
            apologySentAt: payTarget.apologySentAt,
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
