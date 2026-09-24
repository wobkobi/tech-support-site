"use client";
// src/features/business/components/calculator/SaveActions.tsx
// The calculator's save buttons (invoice, save & send, quote, income entry) and the
// error banners from the last failed save.

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
  onSaveInvoice,
  onSaveIncome,
}: Props): React.ReactElement {
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
      <button
        onClick={() => onSaveInvoice(false)}
        disabled={savingInvoice || parsing}
        suppressHydrationWarning
        className="w-full rounded-lg bg-russian-violet px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {savingInvoice && !saveSendMode ? "Saving..." : "Save invoice"}
      </button>
      <button
        onClick={() => onSaveInvoice(true)}
        disabled={savingInvoice || parsing}
        suppressHydrationWarning
        title="Save the invoice and jump straight to the send-to-client step."
        className="w-full rounded-lg border border-russian-violet px-4 py-2 text-sm font-semibold text-russian-violet hover:bg-russian-violet/5 disabled:opacity-50"
      >
        {savingInvoice && saveSendMode ? "Saving..." : "Save & send"}
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
        title="For cash jobs handled outside the invoice flow."
        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        {savingIncome ? "Saving..." : "Save as income entry"}
      </button>
    </div>
  );
}
