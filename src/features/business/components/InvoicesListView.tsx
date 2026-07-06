"use client";
// src/features/business/components/InvoicesListView.tsx
/**
 * @description Lists all invoices with inline status controls. Status changes
 * PATCH /api/business/invoices/{id}; voiding here is a silent status change and
 * emails no client notification (use the invoice page for that).
 */

import { formatNZD } from "@/features/business/lib/business";
import type { Invoice, InvoiceStatus } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import { FaCaretRight } from "react-icons/fa6";

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENT: "bg-blue-100 text-blue-700",
  PAID: "bg-green-100 text-green-700",
  VOIDED: "bg-[#5a2a82]/15 text-[#5a2a82] line-through",
};

/**
 * Client component listing all invoices with inline status controls.
 * @returns Invoices list element
 */
export function InvoicesListView(): React.ReactElement {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/business/invoices")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setInvoices(d.invoices);
      })
      .catch(() => setSyncToast("Couldn't load invoices. Check your connection and refresh."))
      .finally(() => setLoading(false));
  }, []);

  /**
   * Sends a PATCH request to update an invoice status and reflects the change locally.
   * @param id - Invoice ID to update
   * @param status - New invoice status
   */
  async function updateStatus(id: string, status: InvoiceStatus): Promise<void> {
    // Voiding is destructive, so confirm first. This list-side void is a silent
    // status change - no client notification is sent (use the invoice page for that).
    if (
      status === "VOIDED" &&
      !window.confirm(
        "Void this invoice? It'll be marked as voided. No notification is emailed from here - open the invoice to notify the client.",
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/business/invoices/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const d = await res.json();
      if (d.ok) {
        setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
      } else {
        // Server rejects illegal transitions (e.g. anything out of VOIDED); the
        // select snaps back to the persisted status since state never changed.
        setSyncToast(d.error ?? "Couldn't update status.");
        setTimeout(() => setSyncToast(null), 5000);
      }
    } catch {
      setSyncToast("Couldn't update status. Check your connection and try again.");
      setTimeout(() => setSyncToast(null), 5000);
    }
  }

  /** Imports new invoices from Google Drive PDFs and refreshes the list. */
  async function handleImportDrive(): Promise<void> {
    setSyncing(true);
    setSyncToast(null);
    try {
      const res = await fetch("/api/business/invoices/import-drive", {
        method: "POST",
      });
      const d = await res.json();
      if (d.ok) {
        setSyncToast(
          `Imported ${d.created} invoice${d.created !== 1 ? "s" : ""} from Drive.${d.errors ? ` ${d.errors} errors.` : ""}`,
        );
        const r2 = await fetch("/api/business/invoices");
        const d2 = await r2.json();
        if (d2.ok) setInvoices(d2.invoices);
      } else {
        setSyncToast("Import failed.");
      }
    } catch {
      setSyncToast("Import failed.");
    }
    setSyncing(false);
    setTimeout(() => setSyncToast(null), 5000);
  }

  /** Syncs Drive PDF links onto existing invoice records. */
  async function handleSyncDrive(): Promise<void> {
    setSyncing(true);
    setSyncToast(null);
    try {
      const res = await fetch("/api/business/invoices/sync-drive", {
        method: "POST",
      });
      const d = await res.json();
      if (d.ok) {
        setSyncToast(`Synced ${d.matched} invoice${d.matched !== 1 ? "s" : ""} from Drive.`);
        // Reload invoices to pick up newly populated driveWebUrl values
        const r2 = await fetch("/api/business/invoices");
        const d2 = await r2.json();
        if (d2.ok) setInvoices(d2.invoices);
      } else {
        setSyncToast("Drive sync failed.");
      }
    } catch {
      setSyncToast("Drive sync failed.");
    }
    setSyncing(false);
    setTimeout(() => setSyncToast(null), 4000);
  }

  return (
    <div>
      {/* flex-wrap: the three action buttons exceed a narrow phone's width;
          let them wrap instead of clipping at the right edge. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {syncToast && <span className="self-center text-xs text-slate-500">{syncToast}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void handleImportDrive()}
            disabled={syncing}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {syncing ? "Working..." : "Import from Drive"}
          </button>
          <button
            onClick={() => void handleSyncDrive()}
            disabled={syncing}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync Drive"}
          </button>
          <Link
            href={`/admin/business/calculator`}
            className="rounded-lg bg-russian-violet px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            New invoice
          </Link>
        </div>
      </div>

      {/* Mobile card list - below lg the table is hard to read; stack each row
          as a tap-to-open card with the same status select inline. */}
      <div className="space-y-2 lg:hidden">
        {loading ? (
          <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-400 shadow-sm">
            Loading...
          </p>
        ) : invoices.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-400 shadow-sm">
            No invoices yet.
          </p>
        ) : (
          invoices.map((inv) => (
            <div
              key={inv.id}
              className={cn(
                "rounded-xl border border-slate-200 bg-white p-3 shadow-sm",
                "transition-colors hover:border-russian-violet/30",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/admin/business/invoices/${inv.id}`}
                  className="font-mono text-xs font-semibold text-slate-700"
                >
                  {inv.number}
                </Link>
                <select
                  value={inv.status}
                  onChange={(e) => void updateStatus(inv.id, e.target.value as InvoiceStatus)}
                  className={cn(
                    "cursor-pointer rounded-full border-0 px-2 py-1 text-xs font-semibold",
                    STATUS_COLORS[inv.status],
                  )}
                >
                  <option value="DRAFT">Draft</option>
                  <option value="SENT">Sent</option>
                  <option value="PAID">Paid</option>
                  <option value="VOIDED">Voided</option>
                </select>
              </div>
              <Link
                href={`/admin/business/invoices/${inv.id}`}
                className="mt-1 block truncate text-sm font-medium text-slate-700"
              >
                {inv.clientName}
              </Link>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-500">{formatDateShort(inv.issueDate)}</span>
                <span className="font-semibold text-slate-700">{formatNZD(inv.total)}</span>
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
            </div>
          ))
        )}
      </div>

      {/* Desktop table - unchanged column set; hidden below lg. */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm lg:block">
        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-400">Loading...</p>
        ) : invoices.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                {["Number", "Client", "Date", "Total", "Status", "PDF", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => router.push(`/admin/business/invoices/${inv.id}`)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">
                    {inv.number}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700">{inv.clientName}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500">
                    {formatDateShort(inv.issueDate)}
                  </td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap text-slate-700">
                    {formatNZD(inv.total)}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={inv.status}
                      onChange={(e) => void updateStatus(inv.id, e.target.value as InvoiceStatus)}
                      className={cn(
                        "cursor-pointer rounded-full border-0 px-2 py-0.5 text-xs font-semibold",
                        STATUS_COLORS[inv.status],
                      )}
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="SENT">Sent</option>
                      <option value="PAID">Paid</option>
                      <option value="VOIDED">Voided</option>
                    </select>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
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
                      <span className="text-xs text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/business/invoices/${inv.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700"
                    >
                      View
                      <FaCaretRight className="h-3 w-3" aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
