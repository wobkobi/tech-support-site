"use client";
// src/features/business/components/calculator/SaveActions.tsx
// The calculator's "Paid in cash" tick, the Already paid box, its save buttons (invoice,
// save & send, quote, income entry) and the error banners from the last failed save.

import { AlreadyPaidField } from "@/features/business/components/invoice/AlreadyPaidField";
import {
  alreadyPaidAmount,
  type AlreadyPaidState,
} from "@/features/business/lib/already-paid-input";
import type React from "react";

interface Props {
  incomeError: string | null;
  saveInvoiceError: string | null;
  savingInvoice: boolean;
  saveSendMode: boolean;
  saveQuoteMode: boolean;
  savingIncome: boolean;
  parsing: boolean;
  subtotal: number;
  total: number;
  paidCash: boolean;
  onPaidCashChange: (paid: boolean) => void;
  alreadyPaid: AlreadyPaidState;
  onAlreadyPaidChange: (next: AlreadyPaidState) => void;
  onSaveInvoice: (send: boolean, quote?: boolean) => void;
  onSaveIncome: () => void;
}

/**
 * Save buttons for the calculator. Only the in-flight save's button shows
 * "Saving...", driven by the send/quote mode flags.
 * @param props - Component props.
 * @param props.incomeError - Last income-save failure, or null.
 * @param props.saveInvoiceError - Last invoice-save failure or validation message, or null.
 * @param props.savingInvoice - True while an invoice/quote save is in flight.
 * @param props.saveSendMode - True when the in-flight save is a "Save & send".
 * @param props.saveQuoteMode - True when the in-flight save is a "Save as quote".
 * @param props.savingIncome - True while an income save is in flight.
 * @param props.parsing - True while an AI parse is in flight (blocks invoice saves).
 * @param props.subtotal - Job subtotal; zero disables the income save.
 * @param props.total - Job total after discounts; an Already paid amount covering it saves as paid.
 * @param props.paidCash - Whether "Paid in cash" is ticked.
 * @param props.onPaidCashChange - Ticks or unticks "Paid in cash".
 * @param props.alreadyPaid - Already paid amount and method.
 * @param props.onAlreadyPaidChange - Updates the Already paid box.
 * @param props.onSaveInvoice - Saves as an invoice (send = open send step, quote = save as quote).
 * @param props.onSaveIncome - Saves the job as an income entry.
 * @returns Save actions element.
 */
export function SaveActions({
  incomeError,
  saveInvoiceError,
  savingInvoice,
  saveSendMode,
  saveQuoteMode,
  savingIncome,
  parsing,
  subtotal,
  total,
  paidCash,
  onPaidCashChange,
  alreadyPaid,
  onAlreadyPaidChange,
  onSaveInvoice,
  onSaveIncome,
}: Props): React.ReactElement {
  // An Already paid amount that covers the total is a full payment, saved like the tick.
  const paidInFull = paidCash || (total > 0 && alreadyPaidAmount(alreadyPaid) >= total);
  return (
    <div className="space-y-2">
      {incomeError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {incomeError}
        </div>
      )}
      {saveInvoiceError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {saveInvoiceError}
        </p>
      )}
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={paidCash}
          onChange={(e) => onPaidCashChange(e.target.checked)}
          className="h-4 w-4 accent-russian-violet"
        />
        Paid in cash
      </label>
      {paidCash ? (
        <p className="text-xs text-slate-500">
          Saving an invoice marks it paid in cash on the job date and adds it to income. A quote
          stays unpaid.
        </p>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-700">
          <AlreadyPaidField
            value={alreadyPaid}
            onChange={onAlreadyPaidChange}
            total={total}
            inputClassName="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
            coversNote="Covers the total, so the invoice saves as paid."
          />
        </div>
      )}
      <button
        onClick={() => onSaveInvoice(false)}
        disabled={savingInvoice || parsing}
        suppressHydrationWarning
        className="w-full rounded-lg bg-russian-violet px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {savingInvoice && !saveSendMode && !saveQuoteMode
          ? "Saving..."
          : paidInFull
            ? "Save paid invoice"
            : "Save invoice"}
      </button>
      <button
        onClick={() => onSaveInvoice(true)}
        disabled={savingInvoice || parsing}
        suppressHydrationWarning
        title="Save the invoice and jump straight to the send-to-client step."
        className="w-full rounded-lg border border-russian-violet px-4 py-2 text-sm font-semibold text-russian-violet hover:bg-russian-violet/5 disabled:opacity-50"
      >
        {savingInvoice && saveSendMode
          ? "Saving..."
          : paidInFull
            ? "Save paid & send"
            : "Save & send"}
      </button>
      <button
        onClick={() => onSaveInvoice(false, true)}
        disabled={savingInvoice || parsing}
        suppressHydrationWarning
        title="Save as a Q-numbered quote - convert it to an invoice once the client accepts."
        className="w-full rounded-lg border border-russian-violet px-4 py-2 text-sm font-semibold text-russian-violet hover:bg-russian-violet/5 disabled:opacity-50"
      >
        {savingInvoice && saveQuoteMode ? "Saving..." : "Save as quote"}
      </button>
      <button
        onClick={onSaveIncome}
        suppressHydrationWarning
        disabled={savingIncome || subtotal === 0 || savingInvoice}
        title="For jobs handled outside the invoice flow."
        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        {savingIncome
          ? "Saving..."
          : paidCash
            ? "Save as cash income entry"
            : "Save as income entry"}
      </button>
    </div>
  );
}
