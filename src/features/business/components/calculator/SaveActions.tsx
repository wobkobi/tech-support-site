"use client";
// src/features/business/components/calculator/SaveActions.tsx
// The calculator's "Paid in cash" tick, the Already paid box and the error banners from the
// last failed save, with the right column's copy of the save buttons under them.

import { Card } from "@/features/admin/components/ui/Card";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { savePaymentState } from "@/features/business/components/calculator/SaveButtons";
import { AlreadyPaidField } from "@/features/business/components/invoice/AlreadyPaidField";
import type { AlreadyPaidState } from "@/features/business/lib/already-paid-input";
import type React from "react";

interface Props {
  incomeError: string | null;
  saveInvoiceError: string | null;
  quoteMode: boolean;
  total: number;
  paidCash: boolean;
  onPaidCashChange: (paid: boolean) => void;
  alreadyPaid: AlreadyPaidState;
  onAlreadyPaidChange: (next: AlreadyPaidState) => void;
  /** The column's save buttons, shown under the payment boxes. */
  buttons: React.ReactNode;
}

/**
 * Payment boxes and save errors for the calculator's right column. The errors hide on lg+,
 * where the bottom save bar holds the buttons and shows them beside those.
 * @param props - Component props.
 * @param props.incomeError - Last income-save failure, or null.
 * @param props.saveInvoiceError - Last invoice-save failure or validation message, or null.
 * @param props.quoteMode - Opened from "New quote": no payment boxes, so the block is phone-only.
 * @param props.total - Job total after discounts; an Already paid amount over it blocks saves.
 * @param props.paidCash - Whether "Paid in cash" is ticked.
 * @param props.onPaidCashChange - Ticks or unticks "Paid in cash".
 * @param props.alreadyPaid - Already paid amount and method.
 * @param props.onAlreadyPaidChange - Updates the Already paid box.
 * @param props.buttons - The column's save buttons.
 * @returns Save actions element.
 */
export function SaveActions({
  incomeError,
  saveInvoiceError,
  quoteMode,
  total,
  paidCash,
  onPaidCashChange,
  alreadyPaid,
  onAlreadyPaidChange,
  buttons,
}: Props): React.ReactElement {
  const { overpaid } = savePaymentState(total, paidCash, alreadyPaid);
  if (quoteMode) {
    // Only the error and the buttons, which the save bar shows on lg+.
    return (
      <div className="space-y-2 lg:hidden">
        {saveInvoiceError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {saveInvoiceError}
          </p>
        )}
        {buttons}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {incomeError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 lg:hidden">
          {incomeError}
        </div>
      )}
      {saveInvoiceError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 lg:hidden">
          {saveInvoiceError}
        </p>
      )}
      {/* One payment card: the tick, then either what it means or the Already paid box. */}
      <Card padding="sm" className="space-y-3 text-admin-text">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-admin-text">
          <input
            type="checkbox"
            checked={paidCash}
            onChange={(e) => onPaidCashChange(e.target.checked)}
            className="h-4 w-4 accent-russian-violet"
          />
          Paid in cash
        </label>
        {paidCash ? (
          <p className="text-sm text-admin-muted">
            Saving an invoice marks it paid in cash on the job date and adds it to income. A quote
            stays unpaid.
          </p>
        ) : (
          <div className="border-t border-admin-border pt-3">
            <AlreadyPaidField
              value={alreadyPaid}
              onChange={onAlreadyPaidChange}
              total={total}
              inputClassName={ADMIN_INPUT_CLS}
              coversNote="Covers the total, so the invoice saves as paid."
            />
          </div>
        )}
      </Card>
      {overpaid && (
        <p className="text-sm text-coquelicot-700">
          Fix the job or the Already paid amount to save an invoice.
        </p>
      )}
      {buttons}
    </div>
  );
}
