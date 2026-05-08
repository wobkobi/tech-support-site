"use client";

import { useState, useCallback } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import { calcInvoiceTotals, formatNZD } from "@/features/business/lib/business";
import type { Invoice, LineItem } from "@/features/business/types/business";

interface FormState {
  clientName: string;
  clientEmail: string;
  issueDate: string;
  dueDate: string;
  lineItems: LineItem[];
  gst: boolean;
  notes: string;
  status: string;
}

/**
 * Returns a blank line item with default values.
 * @returns Empty LineItem object
 */
function emptyLine(): LineItem {
  return { description: "", qty: 1, unitPrice: 0, lineTotal: 0 };
}

/**
 * Converts a date value to an HTML date input string (YYYY-MM-DD).
 * @param d - Date object or ISO string to convert
 * @returns Date string in YYYY-MM-DD format
 */
function toDateInput(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

interface InvoiceEditViewProps {
  invoice: Invoice;
  token: string;
}

/**
 * Edit form for an existing invoice.
 * @param props - Component props
 * @param props.invoice - Invoice data to edit
 * @param props.token - Admin auth token
 * @returns Invoice edit form element
 */
export function InvoiceEditView({ invoice, token }: InvoiceEditViewProps): React.ReactElement {
  const router = useRouter();
  const headers = { "X-Admin-Secret": token };

  const [form, setForm] = useState<FormState>({
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail,
    issueDate: toDateInput(invoice.issueDate),
    dueDate: toDateInput(invoice.dueDate),
    lineItems: invoice.lineItems.length > 0 ? invoice.lineItems : [emptyLine()],
    gst: invoice.gst,
    notes: invoice.notes ?? "",
    status: invoice.status,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = calcInvoiceTotals(form.lineItems, form.gst);

  const updateLine = useCallback((idx: number, field: keyof LineItem, val: string | number) => {
    setForm((p) => {
      const items = [...p.lineItems];
      const item = { ...items[idx], [field]: val };
      if (field === "qty" || field === "unitPrice") {
        item.lineTotal = Math.round(Number(item.qty) * Number(item.unitPrice) * 100) / 100;
      }
      items[idx] = item;
      return { ...p, lineItems: items };
    });
  }, []);

  /** Submits the edited invoice form and redirects to the detail page on success. */
  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/business/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        clientName: form.clientName,
        clientEmail: form.clientEmail,
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        lineItems: form.lineItems,
        gst: form.gst,
        notes: form.notes || null,
        status: form.status,
      }),
    });
    const d = await res.json();
    if (d.ok) {
      router.push(`/admin/business/invoices/${invoice.id}?token=${encodeURIComponent(token)}`);
    } else {
      setError(d.error ?? "Failed to save");
      setSaving(false);
    }
  }

  const inputCls = cn(
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none",
  );
  const labelCls = cn("mb-1 block text-xs font-semibold text-slate-500");

  return (
    <div className={cn("space-y-6")}>
      {error && (
        <p className={cn("rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600")}>{error}</p>
      )}

      {/* Invoice number (read-only) */}
      <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
        <p className={cn("text-xs text-slate-400")}>
          Invoice number:{" "}
          <span className={cn("font-mono font-semibold text-slate-700")}>{invoice.number}</span>
        </p>
      </div>

      {/* Client */}
      <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
        <h2 className={cn("mb-4 text-sm font-semibold text-slate-700")}>Client</h2>
        <div className={cn("grid grid-cols-2 gap-4")}>
          <div>
            <label className={labelCls}>Name</label>
            <input
              className={inputCls}
              value={form.clientName}
              onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
              placeholder="Client name"
            />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input
              className={inputCls}
              type="email"
              value={form.clientEmail}
              onChange={(e) => setForm((p) => ({ ...p, clientEmail: e.target.value }))}
              placeholder="client@example.com"
            />
          </div>
        </div>
      </div>

      {/* Dates & status */}
      <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
        <h2 className={cn("mb-4 text-sm font-semibold text-slate-700")}>Details</h2>
        <div className={cn("grid grid-cols-3 gap-4")}>
          <div>
            <label className={labelCls}>Issue date</label>
            <input
              className={inputCls}
              type="date"
              value={form.issueDate}
              onChange={(e) => setForm((p) => ({ ...p, issueDate: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelCls}>Due date</label>
            <input
              className={inputCls}
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select
              className={inputCls}
              value={form.status}
              onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
            >
              <option value="DRAFT">Draft</option>
              <option value="SENT">Sent</option>
              <option value="PAID">Paid</option>
            </select>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
        <h2 className={cn("mb-4 text-sm font-semibold text-slate-700")}>Line items</h2>
        <table className={cn("w-full text-sm")}>
          <thead>
            <tr className={cn("border-b border-slate-100")}>
              <th className={cn("pb-2 text-left text-xs font-semibold text-slate-400")}>
                Description
              </th>
              <th className={cn("w-16 pb-2 text-right text-xs font-semibold text-slate-400")}>
                Qty
              </th>
              <th className={cn("w-24 pb-2 text-right text-xs font-semibold text-slate-400")}>
                Unit price
              </th>
              <th className={cn("w-24 pb-2 text-right text-xs font-semibold text-slate-400")}>
                Total
              </th>
              <th className={cn("w-8 pb-2")} />
            </tr>
          </thead>
          <tbody>
            {form.lineItems.map((item, idx) => (
              <tr key={idx} className={cn("border-b border-slate-50")}>
                <td className={cn("py-1 pr-2")}>
                  <input
                    className={inputCls}
                    value={item.description}
                    onChange={(e) => updateLine(idx, "description", e.target.value)}
                    placeholder="Description"
                  />
                </td>
                <td className={cn("py-1 pr-2")}>
                  <input
                    className={cn(inputCls, "text-right")}
                    type="number"
                    min={0}
                    step={0.25}
                    value={item.qty}
                    onChange={(e) => updateLine(idx, "qty", parseFloat(e.target.value) || 0)}
                  />
                </td>
                <td className={cn("py-1 pr-2")}>
                  <input
                    className={cn(inputCls, "text-right")}
                    type="number"
                    min={0}
                    step={0.01}
                    value={item.unitPrice}
                    onChange={(e) => updateLine(idx, "unitPrice", parseFloat(e.target.value) || 0)}
                  />
                </td>
                <td className={cn("py-1 pr-2 text-right text-slate-600")}>
                  {formatNZD(item.lineTotal)}
                </td>
                <td className={cn("py-1 text-center")}>
                  <button
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        lineItems: p.lineItems.filter((_, i) => i !== idx),
                      }))
                    }
                    className={cn("text-slate-300 hover:text-red-400")}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button
          onClick={() => setForm((p) => ({ ...p, lineItems: [...p.lineItems, emptyLine()] }))}
          className={cn("mt-3 text-xs text-slate-400 hover:text-slate-700")}
        >
          + Add line
        </button>

        <div className={cn("mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm")}>
          <div className={cn("flex items-center gap-2")}>
            <input
              type="checkbox"
              id="gst-edit"
              checked={form.gst}
              onChange={(e) => setForm((p) => ({ ...p, gst: e.target.checked }))}
              className={cn("rounded")}
            />
            <label htmlFor="gst-edit" className={cn("text-xs text-slate-500")}>
              Add GST (15%)
            </label>
          </div>
          <div className={cn("flex justify-between text-slate-500")}>
            <span>Subtotal</span>
            <span>{formatNZD(totals.subtotal)}</span>
          </div>
          {form.gst && (
            <div className={cn("flex justify-between text-slate-500")}>
              <span>GST</span>
              <span>{formatNZD(totals.gstAmount)}</span>
            </div>
          )}
          <div className={cn("flex justify-between font-semibold text-slate-800")}>
            <span>Total</span>
            <span>{formatNZD(totals.total)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
        <label className={labelCls}>Notes (optional)</label>
        <textarea
          className={cn(inputCls, "resize-none")}
          rows={3}
          value={form.notes}
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          placeholder="Payment instructions, additional notes..."
        />
      </div>

      {/* Actions */}
      <div className={cn("flex gap-3")}>
        <button
          onClick={() =>
            router.push(`/admin/business/invoices/${invoice.id}?token=${encodeURIComponent(token)}`)
          }
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
          )}
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className={cn(
            "bg-russian-violet rounded-lg px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50",
          )}
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
