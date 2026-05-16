"use client";

import { useState, useEffect, useCallback } from "react";
import type React from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import { calcInvoiceTotals, formatNZD, todayISO } from "@/features/business/lib/business";
import { formatDateShort } from "@/shared/lib/date-format";
import { ContactPickerModal } from "@/features/business/components/ContactPickerModal";
import type { LineItem, GoogleContact } from "@/features/business/types/business";
import {
  BUSINESS,
  BUSINESS_BANK_ACCOUNT,
  BUSINESS_GST_NUMBER,
  BUSINESS_PAYMENT_TERMS_DAYS,
} from "@/shared/lib/business-identity";

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
  notes: string;
  /** Promo title shown on the invoice; null when no promo. */
  promoTitle: string | null;
  /** Promo discount in dollars, applied before GST. */
  promoDiscount: number;
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
    const promoTitle = params.get("promoTitle");
    const promoDiscountRaw = params.get("promoDiscount");
    const promoDiscount = promoDiscountRaw ? Number.parseFloat(promoDiscountRaw) : 0;
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
      notes,
      promoTitle: promoTitle && promoDiscount > 0 ? promoTitle : null,
      promoDiscount: promoDiscount > 0 ? promoDiscount : 0,
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

  const totals = calcInvoiceTotals(form.lineItems, form.gst, form.promoDiscount);

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
        promoTitle: form.promoTitle,
        promoDiscount: form.promoDiscount > 0 ? form.promoDiscount : null,
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

      <div
        className={cn("grid gap-8 lg:grid-cols-[minmax(360px,1fr)_minmax(0,1.3fr)] print:block")}
      >
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

        {/* RIGHT - Live preview (mirrors invoice-pdf.ts so the operator sees
            the same layout they'll get when they download / email the PDF).
            Locked to A4 portrait proportions on lg+ so the preview renders as
            a recognisable sheet of paper rather than a squashed card. Long
            line-item lists scroll inside the sheet. */}
        <div
          className={cn(
            "flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm",
            "lg:aspect-210/297 lg:sticky lg:top-4 lg:overflow-y-auto",
            "print:aspect-auto print:rounded-none print:border-0 print:shadow-none",
          )}
        >
          {/* Branded header band, capped at ~65% of the content width to
              match the PDF letterhead (HEADER_WIDTH_RATIO in invoice-pdf.ts).
              Left-aligned so it reads as a header rather than a banner. */}
          <div className={cn("shrink-0 px-10 pt-10")}>
            <Image
              src="/assets/document-header-800x270.png"
              alt="To The Point"
              width={800}
              height={270}
              className={cn("h-auto w-2/3")}
              priority
            />
          </div>

          {/* Body: flex column so the footer stays pinned to the bottom of the
              A4 sheet even when line items don't fill the page. */}
          <div className={cn("flex flex-1 flex-col px-10 pb-10 pt-4")}>
            {/* Bill to (left) + INVOICE title / number / status / GST# (right) */}
            <div className={cn("mb-6 grid grid-cols-2 gap-4")}>
              <div>
                <p
                  className={cn(
                    "mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-300",
                  )}
                >
                  Bill to
                </p>
                <p className={cn("text-sm font-bold text-slate-700")}>
                  {form.clientName || "Client name"}
                </p>
                <p className={cn("text-xs text-slate-500")}>
                  {form.clientEmail || "client@email.com"}
                </p>
                <div className={cn("mt-3 flex gap-6 text-[11px] text-slate-500")}>
                  <p>
                    <span className={cn("text-slate-400")}>Issued:</span>{" "}
                    <span className={cn("font-bold text-slate-700")}>
                      {form.issueDate ? formatDateShort(form.issueDate) : "-"}
                    </span>
                  </p>
                  <p>
                    <span className={cn("text-slate-400")}>Due:</span>{" "}
                    <span className={cn("font-bold text-slate-700")}>
                      {form.dueDate ? formatDateShort(form.dueDate) : "-"}
                    </span>
                  </p>
                </div>
              </div>
              <div className={cn("text-right")}>
                <p className={cn("text-russian-violet text-2xl font-extrabold leading-none")}>
                  {BUSINESS_GST_NUMBER ? "TAX INVOICE" : "INVOICE"}
                </p>
                <p className={cn("mt-2 font-mono text-sm text-slate-700")}>
                  {form.number || "TTP-XXXX-0000"}
                </p>
                <p className={cn("mt-1 text-[11px] font-bold uppercase text-slate-400")}>DRAFT</p>
                {BUSINESS_GST_NUMBER && (
                  <p className={cn("mt-1 text-[11px] text-slate-500")}>
                    GST# {BUSINESS_GST_NUMBER}
                  </p>
                )}
              </div>
            </div>

            {/* Separator above table - matches the PDF's thin grey line. */}
            <div className={cn("mb-0 h-px bg-slate-300")} />

            {/* Branded table: russian-violet header + alternating row backgrounds. */}
            <table className={cn("mb-0 w-full text-xs")}>
              <thead>
                <tr className={cn("bg-russian-violet text-white")}>
                  <th className={cn("px-2 py-2 text-left font-bold")}>Description</th>
                  <th className={cn("px-2 py-2 text-right font-bold")}>Qty</th>
                  <th className={cn("px-2 py-2 text-right font-bold")}>Unit price</th>
                  <th className={cn("px-2 py-2 text-right font-bold")}>Total</th>
                </tr>
              </thead>
              <tbody>
                {form.lineItems.map((item, idx) => (
                  <tr key={idx} className={cn(idx % 2 === 1 ? "bg-slate-50" : "bg-white")}>
                    <td className={cn("px-2 py-2 text-slate-700")}>
                      {item.description || (
                        <span className={cn("italic text-slate-300")}>(line description)</span>
                      )}
                    </td>
                    <td className={cn("px-2 py-2 text-right text-slate-700")}>{item.qty}</td>
                    <td className={cn("px-2 py-2 text-right text-slate-700")}>
                      {formatNZD(item.unitPrice)}
                    </td>
                    <td className={cn("px-2 py-2 text-right font-bold text-slate-700")}>
                      {formatNZD(item.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={cn("mb-4 h-px bg-slate-300")} />

            {/* Totals (right-aligned, matches PDF). */}
            <div className={cn("mb-6 ml-auto w-1/2 space-y-1 text-xs")}>
              <div className={cn("flex justify-between")}>
                <span className={cn("text-slate-500")}>Subtotal</span>
                <span className={cn("text-slate-700")}>{formatNZD(totals.subtotal)}</span>
              </div>
              {form.promoDiscount > 0 && (
                <div className={cn("flex justify-between text-amber-700")}>
                  <span>Promo{form.promoTitle ? `: ${form.promoTitle}` : ""}</span>
                  <span>-{formatNZD(form.promoDiscount)}</span>
                </div>
              )}
              {form.gst && (
                <div className={cn("flex justify-between")}>
                  <span className={cn("text-slate-500")}>GST (15%)</span>
                  <span className={cn("text-slate-700")}>{formatNZD(totals.gstAmount)}</span>
                </div>
              )}
              <div className={cn("h-px bg-slate-300")} />
              <div
                className={cn("text-russian-violet flex justify-between text-sm font-extrabold")}
              >
                <span>Total</span>
                <span>{formatNZD(totals.total)}</span>
              </div>
            </div>

            <div className={cn("mb-3 h-px bg-slate-300")} />

            {/* Bank transfer section with payee, account, reference, payment terms. */}
            <div className={cn("mb-4 space-y-1 text-[11px]")}>
              <p className={cn("font-bold text-slate-700")}>Bank transfer</p>
              <p className={cn("text-slate-500")}>Payee: {BUSINESS.name}</p>
              <p className={cn("text-slate-500")}>Account: {BUSINESS_BANK_ACCOUNT}</p>
              <p className={cn("text-slate-500")}>Reference: {form.number || "[invoice number]"}</p>
              <p className={cn("text-slate-500")}>
                Due within {BUSINESS_PAYMENT_TERMS_DAYS} days of issue
                {form.dueDate ? ` (by ${formatDateShort(form.dueDate)}).` : "."}
              </p>
            </div>

            {form.notes && <p className={cn("mb-6 text-[11px] text-slate-500")}>{form.notes}</p>}

            {/* Footer: logo (left) + contact strip (right). mt-auto pushes
                this to the bottom of the A4 sheet on lg+ where the parent has
                a fixed aspect ratio. */}
            <div className={cn("mt-auto flex items-end justify-between gap-4 pt-8")}>
              <Image
                src="/source/profile.svg"
                alt="To The Point logo"
                width={70}
                height={70}
                className={cn("h-12 w-auto")}
              />
              <div className={cn("text-right text-[11px]")}>
                <p className={cn("text-russian-violet text-sm font-bold")}>{BUSINESS.company}</p>
                <p className={cn("text-slate-500")}>
                  {BUSINESS.phone} &middot; {BUSINESS.email} &middot; {BUSINESS.website}
                </p>
                <p className={cn("text-slate-300")}>Thanks for your business.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
