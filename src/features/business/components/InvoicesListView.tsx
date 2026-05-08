"use client";

import { useState, useEffect } from "react";
import type React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import { formatNZD } from "@/features/business/lib/business";
import type { Invoice, InvoiceStatus } from "@/features/business/types/business";

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENT: "bg-blue-100 text-blue-700",
  PAID: "bg-green-100 text-green-700",
};

/**
 * Client component listing all invoices with inline status controls.
 * @param props - Component props
 * @param props.token - Admin auth token
 * @returns Invoices list element
 */
export function InvoicesListView({ token }: { token: string }): React.ReactElement {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const headers = { "X-Admin-Secret": token };

  useEffect(() => {
    fetch("/api/business/invoices", { headers })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setInvoices(d.invoices);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Sends a PATCH request to update an invoice status and reflects the change locally.
   * @param id - Invoice ID to update
   * @param status - New invoice status
   */
  async function updateStatus(id: string, status: InvoiceStatus): Promise<void> {
    const res = await fetch(`/api/business/invoices/${id}`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const d = await res.json();
    if (d.ok) setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
  }

  /** Imports new invoices from Google Drive PDFs and refreshes the list. */
  async function handleImportDrive(): Promise<void> {
    setSyncing(true);
    setSyncToast(null);
    try {
      const res = await fetch("/api/business/invoices/import-drive", {
        method: "POST",
        headers,
      });
      const d = await res.json();
      if (d.ok) {
        setSyncToast(
          `Imported ${d.created} invoice${d.created !== 1 ? "s" : ""} from Drive.${d.errors ? ` ${d.errors} errors.` : ""}`,
        );
        const r2 = await fetch("/api/business/invoices", { headers });
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
        headers,
      });
      const d = await res.json();
      if (d.ok) {
        setSyncToast(`Synced ${d.matched} invoice${d.matched !== 1 ? "s" : ""} from Drive.`);
        // Reload invoices to pick up newly populated driveWebUrl values
        const r2 = await fetch("/api/business/invoices", { headers });
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
      <div className={cn("mb-4 flex items-center justify-between gap-3")}>
        <div className={cn("flex gap-2")}>
          {syncToast && (
            <span className={cn("self-center text-xs text-slate-500")}>{syncToast}</span>
          )}
        </div>
        <div className={cn("flex gap-2")}>
          <button
            onClick={() => void handleImportDrive()}
            disabled={syncing}
            className={cn(
              "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50",
            )}
          >
            {syncing ? "Working..." : "Import from Drive"}
          </button>
          <button
            onClick={() => void handleSyncDrive()}
            disabled={syncing}
            className={cn(
              "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50",
            )}
          >
            {syncing ? "Syncing..." : "Sync Drive"}
          </button>
          <Link
            href={`/admin/business/invoices/new?token=${encodeURIComponent(token)}`}
            className={cn(
              "bg-russian-violet rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90",
            )}
          >
            New invoice
          </Link>
        </div>
      </div>

      <div className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm")}>
        {loading ? (
          <p className={cn("px-5 py-6 text-sm text-slate-400")}>Loading...</p>
        ) : invoices.length === 0 ? (
          <p className={cn("px-5 py-6 text-sm text-slate-400")}>No invoices yet.</p>
        ) : (
          <table className={cn("w-full text-sm")}>
            <thead className={cn("border-b border-slate-100 bg-slate-50")}>
              <tr>
                {["Number", "Client", "Date", "Total", "Status", "PDF", ""].map((h) => (
                  <th
                    key={h}
                    className={cn("px-4 py-3 text-left text-xs font-semibold text-slate-500")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={cn("divide-y divide-slate-100")}>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() =>
                    router.push(
                      `/admin/business/invoices/${inv.id}?token=${encodeURIComponent(token)}`,
                    )
                  }
                  className={cn("cursor-pointer hover:bg-slate-50")}
                >
                  <td className={cn("px-4 py-3 font-mono text-xs font-semibold text-slate-700")}>
                    {inv.number}
                  </td>
                  <td className={cn("px-4 py-3 font-medium text-slate-700")}>{inv.clientName}</td>
                  <td className={cn("whitespace-nowrap px-4 py-3 text-xs text-slate-500")}>
                    {new Date(inv.issueDate).toLocaleDateString("en-NZ")}
                  </td>
                  <td className={cn("whitespace-nowrap px-4 py-3 font-semibold text-slate-700")}>
                    {formatNZD(inv.total)}
                  </td>
                  <td className={cn("px-4 py-3")} onClick={(e) => e.stopPropagation()}>
                    <select
                      value={inv.status}
                      onChange={(e) => updateStatus(inv.id, e.target.value as InvoiceStatus)}
                      className={cn(
                        "cursor-pointer rounded-full border-0 px-2 py-0.5 text-xs font-semibold",
                        STATUS_COLORS[inv.status],
                      )}
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="SENT">Sent</option>
                      <option value="PAID">Paid</option>
                    </select>
                  </td>
                  <td className={cn("px-4 py-3")} onClick={(e) => e.stopPropagation()}>
                    {inv.driveWebUrl ? (
                      <a
                        href={inv.driveWebUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={cn("text-xs text-blue-500 hover:text-blue-700")}
                      >
                        PDF ↗
                      </a>
                    ) : (
                      <span className={cn("text-xs text-slate-300")}>-</span>
                    )}
                  </td>
                  <td className={cn("px-4 py-3")}>
                    <Link
                      href={`/admin/business/invoices/${inv.id}?token=${encodeURIComponent(token)}`}
                      onClick={(e) => e.stopPropagation()}
                      className={cn("text-xs text-slate-400 hover:text-slate-700")}
                    >
                      View →
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
