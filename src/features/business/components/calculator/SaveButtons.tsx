"use client";
// src/features/business/components/calculator/SaveButtons.tsx
// The calculator's save buttons (invoice, save & send, quote, income entry): stacked in the
// right column below lg, in a row in the bottom save bar on lg+.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import {
  alreadyPaidAmount,
  type AlreadyPaidState,
} from "@/features/business/lib/already-paid-input";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** How the Paid in cash tick and the Already paid box bear on a save. */
interface SavePaymentState {
  /** The invoice saves as paid: cash was ticked, or Already paid covers the total. */
  paidInFull: boolean;
  /** Already paid is more than the total, which blocks every save but a quote. */
  overpaid: boolean;
}

/**
 * Works out whether a save books the invoice as paid, or is blocked by an overpayment.
 * @param total - Job total after discounts.
 * @param paidCash - Whether "Paid in cash" is ticked.
 * @param alreadyPaid - Already paid amount and method.
 * @returns The paid-in-full and overpaid flags.
 */
export function savePaymentState(
  total: number,
  paidCash: boolean,
  alreadyPaid: AlreadyPaidState,
): SavePaymentState {
  // An Already paid amount that covers the total is a full payment, saved like the tick.
  const prepaid = paidCash ? 0 : alreadyPaidAmount(alreadyPaid);
  return {
    paidInFull: paidCash || (total > 0 && prepaid >= total),
    // More than the total means the job or the amount is wrong, and saving would book the
    // extra as paid against nothing. A quote ignores Already paid, so it can still save.
    overpaid: Math.round((prepaid - total) * 100) > 0,
  };
}

/** Props for {@link SaveButtons}. */
interface SaveButtonsProps {
  savingInvoice: boolean;
  saveSendMode: boolean;
  saveQuoteMode: boolean;
  quoteMode: boolean;
  savingIncome: boolean;
  parsing: boolean;
  subtotal: number;
  total: number;
  paidCash: boolean;
  alreadyPaid: AlreadyPaidState;
  onSaveInvoice: (send: boolean, quote?: boolean) => void;
  onSaveIncome: () => void;
  /** Lay the buttons out in a row at their own width, for the desktop save bar. */
  inline?: boolean;
  className?: string;
}

/**
 * Save buttons for the calculator. Only the in-flight save's button shows "Saving...",
 * driven by the send/quote mode flags.
 * @param props - Component props.
 * @param props.savingInvoice - True while an invoice/quote save is in flight.
 * @param props.saveSendMode - True when the in-flight save is a "Save & send".
 * @param props.saveQuoteMode - True when the in-flight save is a "Save as quote".
 * @param props.quoteMode - Opened from "New quote": Save quote leads, with Save as invoice
 * instead after it, and Save & send and the income save are left out.
 * @param props.savingIncome - True while an income save is in flight.
 * @param props.parsing - True while an AI parse is in flight (blocks invoice saves).
 * @param props.subtotal - Job subtotal; zero disables the income save.
 * @param props.total - Job total after discounts; an Already paid amount covering it saves as paid.
 * @param props.paidCash - Whether "Paid in cash" is ticked.
 * @param props.alreadyPaid - Already paid amount and method.
 * @param props.onSaveInvoice - Saves as an invoice (send = open send step, quote = save as quote).
 * @param props.onSaveIncome - Saves the job as an income entry.
 * @param props.inline - Row of auto-width buttons instead of a full-width stack.
 * @param props.className - Extra classes on the wrapper.
 * @returns Save buttons element.
 */
export function SaveButtons({
  savingInvoice,
  saveSendMode,
  saveQuoteMode,
  quoteMode,
  savingIncome,
  parsing,
  subtotal,
  total,
  paidCash,
  alreadyPaid,
  onSaveInvoice,
  onSaveIncome,
  inline = false,
  className,
}: SaveButtonsProps): React.ReactElement {
  const { paidInFull, overpaid } = savePaymentState(total, paidCash, alreadyPaid);
  const buttonCls = inline ? undefined : "w-full";
  const wrapperCls = cn(inline ? "flex flex-wrap items-center gap-2" : "space-y-2", className);

  if (quoteMode) {
    return (
      <div className={wrapperCls}>
        <AdminButton
          variant="primary"
          className={buttonCls}
          onClick={() => onSaveInvoice(false, true)}
          disabled={savingInvoice || parsing}
          suppressHydrationWarning
          title="Save as a Q-numbered quote - convert it to an invoice once the client accepts."
        >
          {savingInvoice && saveQuoteMode ? "Saving..." : "Save quote"}
        </AdminButton>
        <AdminButton
          variant="outline"
          className={buttonCls}
          onClick={() => onSaveInvoice(false)}
          disabled={savingInvoice || parsing || overpaid}
          suppressHydrationWarning
        >
          {savingInvoice && !saveQuoteMode ? "Saving..." : "Save as invoice instead"}
        </AdminButton>
      </div>
    );
  }
  return (
    <div className={wrapperCls}>
      <AdminButton
        variant="primary"
        className={buttonCls}
        onClick={() => onSaveInvoice(false)}
        disabled={savingInvoice || parsing || overpaid}
        suppressHydrationWarning
      >
        {savingInvoice && !saveSendMode && !saveQuoteMode
          ? "Saving..."
          : paidInFull
            ? "Save paid invoice"
            : "Save invoice"}
      </AdminButton>
      <AdminButton
        variant="outline"
        className={buttonCls}
        onClick={() => onSaveInvoice(true)}
        disabled={savingInvoice || parsing || overpaid}
        suppressHydrationWarning
        title="Save the invoice and jump straight to the send-to-client step."
      >
        {savingInvoice && saveSendMode
          ? "Saving..."
          : paidInFull
            ? "Save paid & send"
            : "Save & send"}
      </AdminButton>
      <AdminButton
        variant="outline"
        className={buttonCls}
        onClick={() => onSaveInvoice(false, true)}
        disabled={savingInvoice || parsing}
        suppressHydrationWarning
        title="Save as a Q-numbered quote - convert it to an invoice once the client accepts."
      >
        {savingInvoice && saveQuoteMode ? "Saving..." : "Save as quote"}
      </AdminButton>
      <AdminButton
        variant="secondary"
        className={buttonCls}
        onClick={onSaveIncome}
        suppressHydrationWarning
        disabled={savingIncome || subtotal === 0 || savingInvoice || overpaid}
        title="For jobs handled outside the invoice flow."
      >
        {savingIncome
          ? "Saving..."
          : paidCash
            ? "Save as cash income entry"
            : "Save as income entry"}
      </AdminButton>
    </div>
  );
}
