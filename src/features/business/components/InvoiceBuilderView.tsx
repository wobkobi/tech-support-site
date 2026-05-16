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

type AddressMode = "name" | "company" | "custom";

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
  /** Picked contact's name; lets the operator switch back to it after editing. */
  pickedContactName: string | null;
  /** Picked contact's company; null when the contact has no company. */
  pickedContactCompany: string | null;
  /** Drives whether clientName is sourced from name/company or freely typed. */
  addressMode: AddressMode;
}

/**
 * Creates a blank line item with default values.
 * @returns Empty line item object
 */
function emptyLine(): LineItem {
  return { description: "", qty: 1, unitPrice: 0, lineTotal: 0 };
}

/**
 * Pre-populated invoice payload used when the builder runs in edit mode for a
 * DRAFT invoice. Mirrors the Prisma row shape after Date columns are stringified
 * to YYYY-MM-DD for the form inputs.
 */
export interface InvoiceBuilderEditPayload {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  clientName: string;
  clientEmail: string;
  lineItems: LineItem[];
  gst: boolean;
  notes: string | null;
  promoTitle: string | null;
  promoDiscount: number | null;
}

/**
 * Invoice builder view with a live preview panel.
 * @param props - Component props
 * @param props.token - Admin auth token used for API requests
 * @param props.editInvoice - When set, the builder runs in edit mode: form is
 *   pre-populated from this payload, the next-invoice-number prefetch is
 *   skipped, and Save PATCHes the existing row instead of creating a new one.
 * @returns Invoice builder element
 */
export function InvoiceBuilderView({
  token,
  editInvoice,
}: {
  token: string;
  editInvoice?: InvoiceBuilderEditPayload;
}): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const headers = { "X-Admin-Secret": token };
  const isEditing = Boolean(editInvoice);

  const [form, setForm] = useState<FormState>(() => {
    // Edit mode: hydrate every field from the existing invoice; no URL params.
    if (editInvoice) {
      return {
        number: editInvoice.number,
        issueDate: editInvoice.issueDate,
        dueDate: editInvoice.dueDate,
        clientName: editInvoice.clientName,
        clientEmail: editInvoice.clientEmail,
        lineItems: editInvoice.lineItems.length ? editInvoice.lineItems : [emptyLine()],
        gst: editInvoice.gst,
        notes: editInvoice.notes ?? "",
        promoTitle: editInvoice.promoTitle,
        promoDiscount: editInvoice.promoDiscount ?? 0,
        pickedContactName: null,
        pickedContactCompany: null,
        addressMode: "custom",
      };
    }
    const clientName = params.get("clientName") ?? "";
    const clientEmail = params.get("clientEmail") ?? "";
    const rawItems = params.get("lineItems");
    const gst = params.get("gst") === "true";
    const notes = params.get("notes") ?? "";
    const promoTitle = params.get("promoTitle");
    const promoDiscountRaw = params.get("promoDiscount");
    const promoDiscount = promoDiscountRaw ? Number.parseFloat(promoDiscountRaw) : 0;
    // Picked contact + address-mode restored from the calculator hand-off so
    // the operator doesn't have to re-pick on arrival.
    const pickedContactName = params.get("pickedContactName");
    const pickedContactCompany = params.get("pickedContactCompany");
    const addressModeParam = params.get("addressMode") as AddressMode | null;
    const addressMode: AddressMode =
      addressModeParam === "name" || addressModeParam === "company" || addressModeParam === "custom"
        ? addressModeParam
        : pickedContactName
          ? "name"
          : "custom";
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
      pickedContactName: pickedContactName || null,
      pickedContactCompany: pickedContactCompany || null,
      addressMode,
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetWarning, setSheetWarning] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);

  // Prefetch next invoice number - skipped in edit mode (number already set).
  useEffect(() => {
    if (isEditing) return;
    fetch("/api/business/sheets/invoice-counter", { headers })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setForm((p) => ({ ...p, number: d.nextFormatted }));
      })
      .catch(() => {});
  }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

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
   * Submits the form. In create mode POSTs to /api/business/invoices and
   * navigates to the new detail page. In edit mode PATCHes the existing row
   * and navigates back to its detail page (no new ID).
   */
  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    const url = editInvoice ? `/api/business/invoices/${editInvoice.id}` : "/api/business/invoices";
    const method = editInvoice ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
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
      const targetId = editInvoice ? editInvoice.id : d.invoice.id;
      router.push(`/admin/business/invoices/${targetId}?token=${encodeURIComponent(token)}`);
    } else {
      setError(d.error ?? "Failed to save");
      setSaving(false);
    }
  }

  /**
   * Downloads the actual customer-facing PDF (same renderer as Drive + email
   * attachment) for the in-progress invoice. POSTs the form state to the
   * preview-pdf route, receives the PDF as a blob, and triggers a download.
   * Browser's window.print() screenshot of the HTML preview is bypassed.
   */
  async function handlePrint(): Promise<void> {
    setError(null);
    try {
      const res = await fetch("/api/business/invoices/preview-pdf", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          number: form.number || "DRAFT",
          clientName: form.clientName || "(no client)",
          clientEmail: form.clientEmail,
          issueDate: form.issueDate,
          dueDate: form.dueDate,
          lineItems: form.lineItems,
          gst: form.gst,
          subtotal: totals.subtotal,
          gstAmount: totals.gstAmount,
          total: totals.total,
          promoTitle: form.promoTitle,
          promoDiscount: form.promoDiscount > 0 ? form.promoDiscount : null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Could not generate PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice ${form.number || "DRAFT"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate PDF");
    }
  }

  /**
   * Applies the selected Google contact to the form. Defaults to address-by-name;
   * the operator can switch to company or custom via the segmented control.
   * @param c - The contact chosen from the picker
   */
  function handleContactSelect(c: GoogleContact): void {
    const company = c.company?.trim() || null;
    setForm((p) => ({
      ...p,
      clientName: c.name,
      clientEmail: c.email,
      pickedContactName: c.name,
      pickedContactCompany: company,
      addressMode: "name",
    }));
  }

  /**
   * Switches the address mode and updates clientName accordingly. Custom mode
   * keeps whatever clientName already has so the operator can keep editing.
   * @param mode - Target mode.
   */
  function setAddressMode(mode: AddressMode): void {
    setForm((p) => {
      if (mode === "name" && p.pickedContactName) {
        return { ...p, addressMode: mode, clientName: p.pickedContactName };
      }
      if (mode === "company" && p.pickedContactCompany) {
        return { ...p, addressMode: mode, clientName: p.pickedContactCompany };
      }
      return { ...p, addressMode: "custom" };
    });
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
            {form.pickedContactName && (
              <div className={cn("flex flex-wrap items-center gap-2")}>
                <span className={cn("text-xs font-medium text-slate-600")}>Address to:</span>
                {(["name", "company", "custom"] as const).map((mode) => {
                  const disabled = mode === "company" && !form.pickedContactCompany;
                  const active = form.addressMode === mode;
                  const label =
                    mode === "name" ? "Name" : mode === "company" ? "Company" : "Custom";
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={disabled}
                      onClick={() => setAddressMode(mode)}
                      title={disabled ? "Picked contact has no company" : undefined}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-russian-violet/40 bg-russian-violet/10 text-russian-violet"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                        disabled && "cursor-not-allowed opacity-40 hover:border-slate-200",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            <div className={cn("grid gap-3 sm:grid-cols-2")}>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>Name</label>
                <input
                  type="text"
                  value={form.clientName}
                  readOnly={form.addressMode !== "custom"}
                  onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                    form.addressMode !== "custom" && "bg-slate-50 text-slate-700",
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
              onClick={() => void handlePrint()}
              className={cn(
                "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50",
              )}
            >
              Save PDF
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
            // Print overrides: defeat the lg: sticky + scroll constraints so
            // the browser captures the FULL invoice rather than just the
            // currently-visible scroll position.
            "print:static print:aspect-auto print:overflow-visible print:rounded-none print:border-0 print:shadow-none",
          )}
        >
          {/* Body: chip-logo header (left) + invoice block (right), then
              bill-to / table / totals / bank-transfer. flex column so the
              bank block stays at the bottom of the A4 sheet on lg+. */}
          <div className={cn("flex flex-1 flex-col px-10 pb-10 pt-10")}>
            {/* Header row: chip + wordmark on the left, INVOICE block on the right. */}
            <div className={cn("mb-8 flex items-start justify-between gap-4")}>
              <Image
                src="/source/logo-wordmark.svg"
                alt="To The Point Tech"
                width={2000}
                height={674}
                className={cn("h-20 w-auto")}
                priority
              />
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

            {/* Bill to (left) + dates (right) - mirrors PDF layout. */}
            <div className={cn("mb-6 flex items-start justify-between gap-6")}>
              <div>
                <p
                  className={cn(
                    "mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400",
                  )}
                >
                  Bill to
                </p>
                <p className={cn("text-sm font-bold text-slate-800")}>
                  {form.clientName || "Client name"}
                </p>
                <p className={cn("text-xs text-slate-500")}>
                  {form.clientEmail || "client@email.com"}
                </p>
              </div>
              <div className={cn("space-y-1 text-[11px]")}>
                <p className={cn("flex justify-between gap-4")}>
                  <span className={cn("text-slate-500")}>Issued:</span>
                  <span className={cn("font-bold text-slate-800")}>
                    {form.issueDate ? formatDateShort(form.issueDate) : "-"}
                  </span>
                </p>
                <p className={cn("flex justify-between gap-4")}>
                  <span className={cn("text-slate-500")}>Due:</span>
                  <span className={cn("font-bold text-slate-800")}>
                    {form.dueDate ? formatDateShort(form.dueDate) : "-"}
                  </span>
                </p>
              </div>
            </div>

            {/* Separator above table - matches the PDF's thin grey line. */}
            <div className={cn("mb-0 h-px bg-slate-300")} />

            {/* Clean table (matches PDF): bold dark headers on white with a brand-coloured
                bottom border. Column widths in % match the PDF: Description 67%, Qty 9%,
                Unit price 11%, Total 13%. */}
            <table className={cn("mb-0 w-full text-xs")}>
              <thead>
                <tr className={cn("border-russian-violet border-b-2 text-slate-800")}>
                  <th className={cn("w-[67%] px-2 py-2 text-left font-bold")}>Description</th>
                  <th className={cn("w-[9%] px-2 py-2 text-center font-bold")}>Qty</th>
                  <th className={cn("w-[11%] px-2 py-2 text-center font-bold")}>Price</th>
                  <th className={cn("w-[13%] px-2 py-2 text-center font-bold")}>Total</th>
                </tr>
              </thead>
              <tbody>
                {form.lineItems.map((item, idx) => (
                  <tr key={idx} className={cn(idx % 2 === 1 ? "bg-slate-50" : "bg-white")}>
                    <td className={cn("px-2 py-2 align-top text-slate-700")}>
                      {item.description || (
                        <span className={cn("italic text-slate-300")}>(line description)</span>
                      )}
                    </td>
                    <td className={cn("px-2 py-2 text-right align-top text-slate-700")}>
                      {item.qty}
                    </td>
                    <td className={cn("px-2 py-2 text-right align-top text-slate-700")}>
                      {formatNZD(item.unitPrice)}
                    </td>
                    <td className={cn("px-2 py-2 text-right align-top font-bold text-slate-700")}>
                      {formatNZD(item.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={cn("mb-4 h-px bg-slate-300")} />

            {/* Totals (right-aligned, matches PDF). */}
            <div className={cn("mb-6 ml-auto w-3/5 space-y-1 text-xs")}>
              <div className={cn("flex justify-between gap-3")}>
                <span className={cn("text-slate-500")}>Subtotal</span>
                <span className={cn("whitespace-nowrap text-slate-700")}>
                  {formatNZD(totals.subtotal)}
                </span>
              </div>
              {form.promoDiscount > 0 && (
                <div className={cn("flex justify-between gap-3 text-amber-700")}>
                  <span>Promo (labor only){form.promoTitle ? `: ${form.promoTitle}` : ""}</span>
                  <span className={cn("whitespace-nowrap")}>-{formatNZD(form.promoDiscount)}</span>
                </div>
              )}
              {form.gst && (
                <div className={cn("flex justify-between gap-3")}>
                  <span className={cn("text-slate-500")}>GST (15%)</span>
                  <span className={cn("whitespace-nowrap text-slate-700")}>
                    {formatNZD(totals.gstAmount)}
                  </span>
                </div>
              )}
              <div className={cn("h-px bg-slate-300")} />
              <div
                className={cn(
                  "text-russian-violet flex justify-between gap-3 text-sm font-extrabold",
                )}
              >
                <span>Total</span>
                <span className={cn("whitespace-nowrap")}>{formatNZD(totals.total)}</span>
              </div>
            </div>

            {/* Bank transfer call-out: tinted box mirrors the PDF's visual emphasis. */}
            <div
              className={cn(
                "mb-4 space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-[11px]",
              )}
            >
              <p className={cn("text-russian-violet text-xs font-bold")}>Bank transfer</p>
              <p className={cn("text-slate-500")}>Payee: {BUSINESS.name}</p>
              <p className={cn("font-semibold text-slate-700")}>Account: {BUSINESS_BANK_ACCOUNT}</p>
              <p className={cn("font-semibold text-slate-700")}>
                Reference: {form.number || "[invoice number]"}
              </p>
              <p className={cn("text-slate-500")}>
                Due within {BUSINESS_PAYMENT_TERMS_DAYS} days of issue
                {form.dueDate ? ` (by ${formatDateShort(form.dueDate)}).` : "."}
              </p>
            </div>

            {form.notes && <p className={cn("mb-6 text-[11px] text-slate-500")}>{form.notes}</p>}

            {/* Sender contact footer (matches the page-bottom footer in the PDF). */}
            <div
              className={cn(
                "mt-auto border-t border-slate-200 pt-3 text-center text-[10px] text-slate-500",
              )}
            >
              {BUSINESS.email} &nbsp;·&nbsp; {BUSINESS.phone} &nbsp;·&nbsp; {BUSINESS.website}
              &nbsp;·&nbsp; {BUSINESS.location}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
