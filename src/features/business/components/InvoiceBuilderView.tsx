"use client";

import { useState, useEffect, useCallback } from "react";
import type React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import {
  calcInvoiceTotals,
  formatNZD,
  formatNZDate,
  todayISO,
} from "@/features/business/lib/business";
import { ContactPickerModal } from "@/features/business/components/ContactPickerModal";
import type { LineItem, GoogleContact } from "@/features/business/types/business";

const BUSINESS_DETAILS = {
  name: "Harrison Raynes",
  company: "To The Point",
  email: "harrison@tothepoint.co.nz",
  phone: "0212971237",
  bank: "12-3077-0191830-00",
};

/**
 * Returns a date string (YYYY-MM-DD) for the date that is n days from today.
 * @param n - Number of days to add to today's date
 * @returns Future date string
 */
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

interface FormState {
  number: string;
  issueDate: string;
  dueDate: string;
  clientName: string;
  clientEmail: string;
  lineItems: LineItem[];
  gst: boolean;
  paymentTerms: string;
  notes: string;
}

/**
 * Creates a blank line item with default values.
 * @returns Empty line item object
 */
function emptyLine(): LineItem {
  return { description: "", qty: 1, unitPrice: 0, lineTotal: 0 };
}

/**
 * Invoice builder view with a live preview panel.
 * @param props - Component props
 * @param props.token - Admin auth token used for API requests
 * @returns Invoice builder element
 */
export function InvoiceBuilderView({ token }: { token: string }): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const headers = { "X-Admin-Secret": token };

  const [form, setForm] = useState<FormState>(() => {
    const clientName = params.get("clientName") ?? "";
    const clientEmail = params.get("clientEmail") ?? "";
    const rawItems = params.get("lineItems");
    const gst = params.get("gst") === "true";
    const notes = params.get("notes") ?? "";
    let lineItems: LineItem[] = [emptyLine()];
    try {
      if (rawItems) lineItems = JSON.parse(rawItems) as LineItem[];
    } catch {}
    return {
      number: "",
      issueDate: todayISO(),
      dueDate: inDays(7),
      clientName,
      clientEmail,
      lineItems: clientName || clientEmail || rawItems ? lineItems : [emptyLine()],
      gst,
      paymentTerms: "7 days",
      notes,
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetWarning, setSheetWarning] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);

  // Prefetch next invoice number
  useEffect(() => {
    fetch("/api/business/sheets/invoice-counter", { headers })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setForm((p) => ({ ...p, number: d.nextFormatted }));
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Updates a single field on a line item and recalculates its total when qty or unitPrice changes.
   * @param idx - Zero-based index of the line item to update
   * @param field - The LineItem field to update
   * @param val - New value for the field
   */
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

  const totals = calcInvoiceTotals(form.lineItems, form.gst);

  /**
   * Submits the invoice form to the API and redirects to the new invoice detail page on success.
   */
  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/business/invoices", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        number: form.number,
        clientName: form.clientName,
        clientEmail: form.clientEmail,
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        lineItems: form.lineItems,
        gst: form.gst,
        notes: form.notes || null,
      }),
    });
    const d = await res.json();
    if (d.ok) {
      if (d.sheetSyncWarning) setSheetWarning(true);
      router.push(`/admin/business/invoices/${d.invoice.id}?token=${encodeURIComponent(token)}`);
    } else {
      setError(d.error ?? "Failed to save");
      setSaving(false);
    }
  }

  /**
   * Triggers the browser print dialog so the invoice preview can be saved as a PDF.
   */
  function handlePrint(): void {
    window.print();
  }

  /**
   * Applies the selected Google contact's name and email to the form.
   * @param c - The contact chosen from the picker
   */
  function handleContactSelect(c: GoogleContact): void {
    setForm((p) => ({ ...p, clientName: c.name, clientEmail: c.email }));
  }

  return (
    <>
      {showContactPicker && (
        <ContactPickerModal
          token={token}
          onSelect={handleContactSelect}
          onClose={() => setShowContactPicker(false)}
        />
      )}

      {sheetWarning && (
        <div
          className={cn(
            "mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800",
          )}
        >
          Invoice saved - sheet sync failed. Update SETTINGS!B17 manually.
        </div>
      )}

      <div className={cn("grid gap-8 lg:grid-cols-2 print:block")}>
        {/* LEFT - Form */}
        <div className={cn("space-y-5 print:hidden")}>
          <div
            className={cn("space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
          >
            <h2 className={cn("text-russian-violet text-sm font-semibold")}>Invoice details</h2>
            <div className={cn("grid gap-3 sm:grid-cols-2")}>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                  Invoice number
                </label>
                <input
                  type="text"
                  value={form.number}
                  onChange={(e) => setForm((p) => ({ ...p, number: e.target.value }))}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2",
                  )}
                />
              </div>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                  Issue date
                </label>
                <input
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => setForm((p) => ({ ...p, issueDate: e.target.value }))}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                  )}
                />
              </div>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                  Due date
                </label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                  )}
                />
              </div>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
                  Payment terms
                </label>
                <input
                  type="text"
                  value={form.paymentTerms}
                  onChange={(e) => setForm((p) => ({ ...p, paymentTerms: e.target.value }))}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                  )}
                />
              </div>
            </div>
          </div>

          <div
            className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
          >
            <div className={cn("flex items-center justify-between")}>
              <h2 className={cn("text-russian-violet text-sm font-semibold")}>Client</h2>
              <button
                onClick={() => setShowContactPicker(true)}
                className={cn("hover:text-russian-violet text-xs text-slate-500 underline")}
              >
                Pick from contacts
              </button>
            </div>
            <div className={cn("grid gap-3 sm:grid-cols-2")}>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>Name</label>
                <input
                  type="text"
                  value={form.clientName}
                  onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                  )}
                />
              </div>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>Email</label>
                <input
                  type="email"
                  value={form.clientEmail}
                  onChange={(e) => setForm((p) => ({ ...p, clientEmail: e.target.value }))}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                  )}
                />
              </div>
            </div>
          </div>

          <div
            className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
          >
            <h2 className={cn("text-russian-violet text-sm font-semibold")}>Line items</h2>
            {form.lineItems.map((item, idx) => (
              <div
                key={idx}
                className={cn("grid grid-cols-[1fr_60px_80px_80px_24px] items-center gap-2")}
              >
                <input
                  type="text"
                  placeholder="Description"
                  value={item.description}
                  onChange={(e) => updateLine(idx, "description", e.target.value)}
                  className={cn(
                    "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2",
                  )}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Qty"
                  value={item.qty}
                  onChange={(e) => updateLine(idx, "qty", parseFloat(e.target.value) || 0)}
                  className={cn(
                    "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2",
                  )}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Price"
                  value={item.unitPrice}
                  onChange={(e) => updateLine(idx, "unitPrice", parseFloat(e.target.value) || 0)}
                  className={cn(
                    "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2",
                  )}
                />
                <p className={cn("text-right text-sm font-medium text-slate-700")}>
                  {formatNZD(item.lineTotal)}
                </p>
                <button
                  onClick={() =>
                    setForm((p) => ({ ...p, lineItems: p.lineItems.filter((_, i) => i !== idx) }))
                  }
                  className={cn("text-lg leading-none text-slate-300 hover:text-red-500")}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() => setForm((p) => ({ ...p, lineItems: [...p.lineItems, emptyLine()] }))}
              className={cn("hover:text-russian-violet text-xs text-slate-500 underline")}
            >
              + Add line
            </button>

            <div className={cn("flex items-center gap-2 pt-1")}>
              <input
                type="checkbox"
                id="gst"
                checked={form.gst}
                onChange={(e) => setForm((p) => ({ ...p, gst: e.target.checked }))}
                className={cn("h-4 w-4 rounded border-slate-300")}
              />
              <label htmlFor="gst" className={cn("text-sm text-slate-600")}>
                Add GST (15%)
              </label>
            </div>
          </div>

          <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>
              Notes to client
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              rows={3}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </div>

          {error && <p className={cn("text-xs text-red-600")}>{error}</p>}

          <div className={cn("flex gap-3")}>
            <button
              onClick={handleSave}
              disabled={saving}
              className={cn(
                "bg-russian-violet rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50",
              )}
            >
              {saving ? "Saving..." : "Save as draft"}
            </button>
            <button
              onClick={handlePrint}
              className={cn(
                "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
              )}
            >
              Print / save PDF
            </button>
          </div>
        </div>

        {/* RIGHT - Live preview */}
        <div
          className={cn(
            "rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:shadow-none",
          )}
        >
          <div className={cn("mb-6 flex items-start justify-between")}>
            <div>
              <p className={cn("text-lg font-bold text-slate-800")}>{BUSINESS_DETAILS.company}</p>
              <p className={cn("text-sm text-slate-500")}>{BUSINESS_DETAILS.name}</p>
              <p className={cn("text-sm text-slate-500")}>{BUSINESS_DETAILS.email}</p>
              <p className={cn("text-sm text-slate-500")}>{BUSINESS_DETAILS.phone}</p>
            </div>
            <div className={cn("text-right")}>
              <p className={cn("text-russian-violet text-xl font-extrabold")}>INVOICE</p>
              <p className={cn("font-mono text-sm font-semibold text-slate-700")}>
                {form.number || "TTP-XXXX-0000"}
              </p>
            </div>
          </div>

          <div className={cn("mb-6 grid grid-cols-2 gap-4 text-sm")}>
            <div>
              <p className={cn("text-xs font-semibold uppercase tracking-wide text-slate-400")}>
                Bill to
              </p>
              <p className={cn("font-medium text-slate-700")}>{form.clientName || "Client name"}</p>
              <p className={cn("text-slate-500")}>{form.clientEmail || "client@email.com"}</p>
            </div>
            <div className={cn("text-right")}>
              <p className={cn("text-xs text-slate-400")}>
                Issued: {form.issueDate ? formatNZDate(form.issueDate) : "-"}
              </p>
              <p className={cn("text-xs text-slate-400")}>
                Due: {form.dueDate ? formatNZDate(form.dueDate) : "-"}
              </p>
              <p className={cn("text-xs text-slate-400")}>Terms: {form.paymentTerms}</p>
            </div>
          </div>

          <table className={cn("mb-4 w-full text-sm")}>
            <thead>
              <tr className={cn("border-b border-slate-200")}>
                <th className={cn("pb-2 text-left text-xs font-semibold text-slate-400")}>
                  Description
                </th>
                <th className={cn("pb-2 text-right text-xs font-semibold text-slate-400")}>Qty</th>
                <th className={cn("pb-2 text-right text-xs font-semibold text-slate-400")}>
                  Price
                </th>
                <th className={cn("pb-2 text-right text-xs font-semibold text-slate-400")}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {form.lineItems.map((item, idx) => (
                <tr key={idx} className={cn("border-b border-slate-100")}>
                  <td className={cn("py-2 text-slate-700")}>{item.description || "-"}</td>
                  <td className={cn("py-2 text-right text-slate-500")}>{item.qty}</td>
                  <td className={cn("py-2 text-right text-slate-500")}>
                    {formatNZD(item.unitPrice)}
                  </td>
                  <td className={cn("py-2 text-right font-medium text-slate-700")}>
                    {formatNZD(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={cn("max-w-50 ml-auto space-y-1 text-sm")}>
            <div className={cn("flex justify-between")}>
              <span className={cn("text-slate-500")}>Subtotal</span>
              <span className={cn("font-medium text-slate-700")}>{formatNZD(totals.subtotal)}</span>
            </div>
            {form.gst && (
              <div className={cn("flex justify-between")}>
                <span className={cn("text-slate-500")}>GST (15%)</span>
                <span className={cn("font-medium text-slate-700")}>
                  {formatNZD(totals.gstAmount)}
                </span>
              </div>
            )}
            <div className={cn("flex justify-between border-t border-slate-200 pt-1")}>
              <span className={cn("font-semibold text-slate-800")}>Total</span>
              <span className={cn("text-russian-violet font-extrabold")}>
                {formatNZD(totals.total)}
              </span>
            </div>
          </div>

          <div className={cn("mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500")}>
            <p className={cn("mb-1 font-semibold text-slate-600")}>Bank transfer</p>
            <p>Bank: {BUSINESS_DETAILS.bank}</p>
            <p>Reference: {form.number || "Invoice number"}</p>
            {form.notes && <p className={cn("mt-3 italic")}>{form.notes}</p>}
          </div>
        </div>
      </div>
    </>
  );
}
