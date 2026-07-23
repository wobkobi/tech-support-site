"use client";
// src/features/business/components/invoice/InvoiceForm.tsx
/**
 * @description Presentational edit form for an invoice's client, dates, line
 * items, and notes. It owns the field state and mirrors every change to the
 * parent via `onChange` (so a live preview can render alongside); the PARENT
 * owns submission. Creation stays in the calculator - this form only edits an
 * existing DRAFT. Totals use {@link calcInvoiceTotals} (the same fn the server
 * recomputes with), and the email is checked with the booking `validateEmail`.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { validateEmail } from "@/features/booking/lib/booking";
import { LineItemsEditor } from "@/features/business/components/invoice/LineItemsEditor";
import { calcInvoiceTotals, formatNZD, isValidLineItem } from "@/features/business/lib/business";
import type { LineItem } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";

/** The editable invoice fields this form owns. */
export interface InvoiceFormData {
  clientName: string;
  clientEmail: string;
  /** ISO YYYY-MM-DD. */
  issueDate: string;
  /** ISO YYYY-MM-DD. */
  dueDate: string;
  lineItems: LineItem[];
  notes: string;
}

/** Read-only discount snapshot preserved from invoice creation, shown in totals. */
export interface PreservedDiscounts {
  promoTitle?: string | null;
  promoDiscount?: number;
  unsuccessfulDiscount?: number;
}

/** Props for {@link InvoiceForm}. */
interface InvoiceFormProps {
  /** Initial field values (the invoice being edited). */
  initial: InvoiceFormData;
  /** Discounts carried from creation - displayed in totals, not editable here. */
  preservedDiscounts?: PreservedDiscounts;
  /** Live GST-registration flag (drives the "Includes GST" total line). */
  gstRegistered: boolean;
  /** Payment terms in days - changing the issue date re-derives the due date. */
  paymentTermsDays: number;
  /** Submit button label. */
  submitLabel: string;
  /** Whether a submit is in flight. */
  busy?: boolean;
  /** Submit handler; receives the validated form data. */
  onSubmit: (data: InvoiceFormData) => void;
  /** Called on every field change so the parent can mirror a live preview. */
  onChange?: (data: InvoiceFormData) => void;
}

const INPUT_CLS =
  "w-full rounded-lg border border-admin-border-strong bg-admin-surface px-3 py-2 text-sm text-admin-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet";
const LABEL_CLS = "mb-1 block text-xs font-semibold text-admin-muted uppercase";

/**
 * Adds `days` to an ISO YYYY-MM-DD date, returning ISO YYYY-MM-DD.
 * @param iso - Base date (YYYY-MM-DD).
 * @param days - Days to add.
 * @returns The shifted date, or the input unchanged when unparseable.
 */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Edit form for an invoice's client/dates/line-items/notes.
 * @param props - Component props.
 * @param props.initial - Initial field values.
 * @param props.preservedDiscounts - Read-only discount snapshot for totals.
 * @param props.gstRegistered - Live GST-registration flag.
 * @param props.paymentTermsDays - Net terms; re-derives due date on issue change.
 * @param props.submitLabel - Submit button label.
 * @param props.busy - Whether a submit is in flight.
 * @param props.onSubmit - Submit handler receiving the validated data.
 * @param props.onChange - Change handler for mirroring a live preview.
 * @returns The form element.
 */
export function InvoiceForm({
  initial,
  preservedDiscounts,
  gstRegistered,
  paymentTermsDays,
  submitLabel,
  busy = false,
  onSubmit,
  onChange,
}: InvoiceFormProps): React.ReactElement {
  const [form, setForm] = useState<InvoiceFormData>(initial);
  const [error, setError] = useState<string | null>(null);

  /**
   * Merges a patch into the form and notifies the parent for the live preview.
   * @param patch - Fields to change.
   */
  function update(patch: Partial<InvoiceFormData>): void {
    const next = { ...form, ...patch };
    setForm(next);
    onChange?.(next);
  }

  const promoDiscount = preservedDiscounts?.promoDiscount ?? 0;
  const unsuccessfulDiscount = preservedDiscounts?.unsuccessfulDiscount ?? 0;
  const totals = calcInvoiceTotals(
    form.lineItems,
    promoDiscount + unsuccessfulDiscount,
    gstRegistered,
  );

  /**
   * Validates the form and hands off to the parent on success.
   */
  function submit(): void {
    if (!form.clientName.trim()) {
      setError("Client name is required.");
      return;
    }
    const emailCheck = validateEmail(form.clientEmail);
    if (emailCheck === "empty") {
      setError("Client email is required.");
      return;
    }
    if (emailCheck === "invalid") {
      setError("Enter a valid email address.");
      return;
    }
    if (emailCheck === "too-long") {
      setError("Email is too long.");
      return;
    }
    if (form.lineItems.length === 0) {
      setError("Add at least one line item.");
      return;
    }
    if (!form.lineItems.every(isValidLineItem)) {
      setError("Every line item needs a description and numeric qty/price.");
      return;
    }
    if (totals.subtotal <= 0) {
      setError("The invoice total must be greater than zero.");
      return;
    }
    setError(null);
    onSubmit(form);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={LABEL_CLS}>Client name</span>
          <input
            type="text"
            value={form.clientName}
            onChange={(e) => update({ clientName: e.target.value })}
            disabled={busy}
            className={INPUT_CLS}
          />
        </label>
        <label>
          <span className={LABEL_CLS}>Client email</span>
          <input
            type="email"
            value={form.clientEmail}
            onChange={(e) => update({ clientEmail: e.target.value })}
            disabled={busy}
            className={INPUT_CLS}
          />
        </label>
        <label>
          <span className={LABEL_CLS}>Issue date</span>
          <input
            type="date"
            value={form.issueDate}
            onChange={(e) =>
              // Re-derive the due date off the net terms; the operator can still
              // override it afterwards for a custom due date.
              update({
                issueDate: e.target.value,
                dueDate: addDaysISO(e.target.value, paymentTermsDays),
              })
            }
            disabled={busy}
            className={INPUT_CLS}
          />
        </label>
        <label>
          <span className={LABEL_CLS}>Due date</span>
          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => update({ dueDate: e.target.value })}
            disabled={busy}
            className={INPUT_CLS}
          />
        </label>
      </div>

      <div>
        <span className={LABEL_CLS}>Line items</span>
        <LineItemsEditor
          items={form.lineItems}
          onChange={(lineItems) => update({ lineItems })}
          disabled={busy}
        />
      </div>

      <label className="block">
        <span className={LABEL_CLS}>Notes</span>
        <textarea
          rows={3}
          value={form.notes}
          onChange={(e) => update({ notes: e.target.value })}
          disabled={busy}
          placeholder="Optional note shown on the invoice."
          className={cn(INPUT_CLS, "resize-y")}
        />
      </label>

      {/* Totals - recomputed live; the server recomputes the same way on save. */}
      <div className="ml-auto w-full max-w-xs space-y-1 text-sm sm:w-3/5">
        <div className="flex justify-between gap-3">
          <span className="text-admin-muted">Subtotal</span>
          <span className="font-medium text-admin-text">{formatNZD(totals.subtotal)}</span>
        </div>
        {promoDiscount > 0 && (
          <div className="flex justify-between gap-3 text-amber-700">
            <span>
              Promo{preservedDiscounts?.promoTitle ? `: ${preservedDiscounts.promoTitle}` : ""}
            </span>
            <span>-{formatNZD(promoDiscount)}</span>
          </div>
        )}
        {unsuccessfulDiscount > 0 && (
          <div className="flex justify-between gap-3 text-amber-700">
            <span>Unsuccessful-visit discount</span>
            <span>-{formatNZD(unsuccessfulDiscount)}</span>
          </div>
        )}
        {totals.gstAmount > 0 && (
          <div className="flex justify-between gap-3">
            <span className="text-admin-muted">Includes GST</span>
            <span className="font-medium text-admin-text">{formatNZD(totals.gstAmount)}</span>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-admin-border pt-1">
          <span className="font-semibold text-admin-text">Total</span>
          <span className="font-extrabold text-russian-violet">{formatNZD(totals.total)}</span>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-coquelicot-200 bg-coquelicot-100 px-4 py-3 text-sm text-coquelicot-800">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <AdminButton type="submit" busy={busy}>
          {submitLabel}
        </AdminButton>
      </div>
    </form>
  );
}
