"use client";
// src/features/business/components/invoice/PaymentDialog.tsx
/**
 * @description Records a payment against an invoice via POST /pay. Collects the
 * date, method (INCOME_METHODS), an optional reference, and whether to write an
 * income-ledger entry. Shared by the invoices list and the invoice detail page.
 * Mount it fresh per payment (conditional render or key by invoice id) so the
 * form resets - it holds no reset effect.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatNZD } from "@/features/business/lib/business";
import { INCOME_METHODS } from "@/features/business/lib/constants";
import type React from "react";
import { useState } from "react";

/** The minimal invoice shape the dialog needs. */
export interface PaymentDialogInvoice {
  id: string;
  number: string;
  total: number;
  clientName: string;
  status: string;
  paidAt?: string | null;
}

/** Props for {@link PaymentDialog}. */
interface PaymentDialogProps {
  /** Whether the dialog is shown. */
  open: boolean;
  /** The invoice being paid. */
  invoice: PaymentDialogInvoice;
  /** Whether the invoice already has a linked income entry (affects the copy). */
  hasLinkedIncome?: boolean;
  /** Called on close; `recorded` is true when a payment was recorded. */
  onClose: (recorded: boolean) => void;
}

/**
 * Today's date as a yyyy-mm-dd string in the local (NZ) timezone.
 * @returns The date string.
 */
function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

const INPUT_CLS =
  "w-full rounded-lg border border-admin-border-strong px-3 py-2 text-sm text-admin-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet";

/**
 * Payment-recording dialog. Submits POST /api/business/invoices/[id]/pay.
 * @param props - Component props.
 * @param props.open - Whether the dialog is shown.
 * @param props.invoice - The invoice being paid.
 * @param props.hasLinkedIncome - Whether a linked income entry already exists.
 * @param props.onClose - Close handler; receives whether a payment was recorded.
 * @returns The dialog element.
 */
export function PaymentDialog({
  open,
  invoice,
  hasLinkedIncome,
  onClose,
}: PaymentDialogProps): React.ReactElement {
  const { toast } = useToast();
  const alreadyPaid = invoice.status === "PAID";
  const [date, setDate] = useState(localToday());
  const [method, setMethod] = useState<string>(INCOME_METHODS[0]);
  const [reference, setReference] = useState("");
  // Default ON, but OFF when already PAID - a legacy backfill must not create a
  // second ledger row for a payment that was entered by hand.
  const [createIncome, setCreateIncome] = useState(!alreadyPaid);
  const [busy, setBusy] = useState(false);

  /**
   * Submits the payment to the /pay route, toasts the result, and closes.
   */
  async function submit(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/business/invoices/${invoice.id}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paidAt: date,
          method,
          reference: reference.trim() || undefined,
          createIncome,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        toast(d.error ?? "Couldn't record the payment.", { tone: "error" });
        setBusy(false);
        return;
      }
      if (d.sheetWarning) {
        toast("Payment recorded, but the Cashbook sheet update didn't go through.", {
          tone: "warning",
        });
      } else {
        toast(`Payment recorded for ${invoice.number}.`, { tone: "success" });
      }
      onClose(true);
    } catch {
      toast("Couldn't record the payment. Check your connection.", { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose(false)}
      title={`Record payment - ${invoice.number}`}
      size="sm"
      footer={
        <>
          <AdminButton variant="secondary" onClick={() => onClose(false)} disabled={busy}>
            Cancel
          </AdminButton>
          <AdminButton onClick={() => void submit()} busy={busy}>
            {busy ? "Recording payment and updating PDF..." : "Record payment"}
          </AdminButton>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-admin-text-secondary">
          {invoice.clientName} -{" "}
          <span className="font-semibold text-admin-text">{formatNZD(invoice.total)}</span>
        </p>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-admin-text">Payment date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={INPUT_CLS}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-admin-text">Method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={INPUT_CLS}>
            {INCOME_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-admin-text">Reference (optional)</span>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. bank ref, cheque no."
            className={INPUT_CLS}
          />
        </label>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={createIncome}
            onChange={(e) => setCreateIncome(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-admin-text">Record income entry</span>
            {alreadyPaid && (
              <span className="mt-0.5 block text-xs text-admin-muted">
                {hasLinkedIncome
                  ? "Already linked to a ledger entry; leave unticked to just refresh its date/method."
                  : "Already marked paid; leave unticked unless the income was never recorded, to avoid a duplicate row."}
              </span>
            )}
          </span>
        </label>
      </div>
    </Modal>
  );
}
