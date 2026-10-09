"use client";
// src/features/business/components/invoice/PaymentDialog.tsx
// Records a payment against an invoice via POST /pay. Collects the date, method
// (INCOME_METHODS), an optional reference, whether to write an income-ledger entry (or link
// a matching one typed into the sheet), and - when a reminder went out after the payment
// date - whether to apologise for the chase.
// Shared by the invoices list and the invoice detail page. Mount it fresh per payment
// (conditional render or key by invoice id) so the form resets - it holds no reset
// effect.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { ADMIN_CHECKBOX_CLS } from "@/features/admin/components/ui/field-classes";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatNZD, todayISO } from "@/features/business/lib/business";
import { INCOME_METHODS } from "@/features/business/lib/constants";
import { reminderChasedPaidInvoice } from "@/features/business/lib/invoice-apology";
import { formatDateShort } from "@/shared/lib/date-format";
import type React from "react";
import { useId, useState } from "react";

/** The minimal invoice shape the dialog needs. */
interface PaymentDialogInvoice {
  id: string;
  number: string;
  /** What the client still owes: the total less any amount already paid. */
  balance: number;
  clientName: string;
  status: string;
  paidAt?: string | null;
  /** Most recent overdue reminder; a later date than the payment offers the apology. */
  reminderLastSentAt?: string | null;
  /** Apology already sent for this invoice; suppresses the offer. */
  apologySentAt?: string | null;
}

/** A matched income row the dialog can link instead of adding a new one. */
export interface LikelyIncome {
  id: string;
  amount: number;
  /** ISO date of the row. */
  date: string;
  method: string;
}

/** Props for {@link PaymentDialog}. */
interface PaymentDialogProps {
  /** Whether the dialog is shown. */
  open: boolean;
  /** The invoice being paid. */
  invoice: PaymentDialogInvoice;
  /** Whether the invoice already has a linked income entry (affects the copy). */
  hasLinkedIncome?: boolean;
  /**
   * An unlinked income row (usually typed into the Cashbook sheet) that matches this
   * invoice's customer and balance. Offered for linking so the payment isn't booked twice.
   */
  likelyIncome?: LikelyIncome | null;
  /** Called on close; `recorded` is true when a payment was recorded. */
  onClose: (recorded: boolean) => void;
}

/**
 * Payment-recording dialog. Submits POST /api/business/invoices/[id]/pay.
 * @param props - Component props.
 * @param props.open - Whether the dialog is shown.
 * @param props.invoice - The invoice being paid.
 * @param props.hasLinkedIncome - Whether a linked income entry already exists.
 * @param props.likelyIncome - Unlinked income row matching this invoice, offered for linking.
 * @param props.onClose - Close handler; receives whether a payment was recorded.
 * @returns The dialog element.
 */
export function PaymentDialog({
  open,
  invoice,
  hasLinkedIncome,
  likelyIncome = null,
  onClose,
}: PaymentDialogProps): React.ReactElement {
  const { toast } = useToast();
  const id = useId();
  const alreadyPaid = invoice.status === "PAID";
  // A matched row is the payment the operator is recording, so its date and method
  // are the starting point. Ledger rows sit at UTC midnight, so the ISO day is the NZ day.
  const [date, setDate] = useState(likelyIncome ? likelyIncome.date.slice(0, 10) : todayISO());
  const [method, setMethod] = useState<string>(
    likelyIncome && (INCOME_METHODS as readonly string[]).includes(likelyIncome.method)
      ? likelyIncome.method
      : INCOME_METHODS[0],
  );
  const [adoptLikely, setAdoptLikely] = useState(likelyIncome != null);
  const [reference, setReference] = useState("");
  // Default ON, but OFF when already PAID - a legacy backfill must not create a
  // second ledger row for a payment that was entered by hand.
  const [createIncome, setCreateIncome] = useState(!alreadyPaid);
  const [sendApology, setSendApology] = useState(true);
  const [busy, setBusy] = useState(false);

  // Recomputed as the operator edits the date: backdating the payment past the
  // last reminder is exactly what reveals the wrongly-sent chase. Suppressed on
  // an already-PAID row, where this is a backfill rather than a fresh payment.
  const wronglyChased =
    !alreadyPaid &&
    reminderChasedPaidInvoice({
      reminderLastSentAt: invoice.reminderLastSentAt,
      paidAt: date,
      apologySentAt: invoice.apologySentAt,
    });
  const apologyRequested = wronglyChased && sendApology;
  const adopting = likelyIncome != null && adoptLikely;

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
          createIncome: adopting ? false : createIncome,
          sendApology: apologyRequested,
          adoptIncomeId: adopting ? likelyIncome?.id : undefined,
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
      } else if (apologyRequested && !d.apologySent) {
        toast("Payment recorded, but the apology email didn't go through.", { tone: "warning" });
      } else if (d.apologySent) {
        toast(`Payment recorded for ${invoice.number}, and an apology sent.`, { tone: "success" });
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
          <span className="font-semibold text-admin-text">{formatNZD(invoice.balance)}</span>
        </p>

        <AdminField label="Payment date" htmlFor={`${id}-date`}>
          <AdminInput
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </AdminField>

        <AdminField label="Method" htmlFor={`${id}-method`}>
          <AdminSelect
            id={`${id}-method`}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {INCOME_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </AdminSelect>
        </AdminField>

        <AdminField label="Reference (optional)" htmlFor={`${id}-ref`}>
          <AdminInput
            id={`${id}-ref`}
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. bank ref, cheque no."
          />
        </AdminField>

        {likelyIncome && (
          <label className="flex items-start gap-2 rounded-lg border border-admin-border bg-admin-bg p-3">
            <input
              type="checkbox"
              checked={adoptLikely}
              onChange={(e) => setAdoptLikely(e.target.checked)}
              className={ADMIN_CHECKBOX_CLS}
            />
            <span>
              <span className="font-medium text-admin-text">
                Use the income entry already there
              </span>
              <span className="mt-0.5 block text-sm text-admin-muted">
                {formatNZD(likelyIncome.amount)} by {likelyIncome.method} on{" "}
                {formatDateShort(likelyIncome.date)}. Links it to this invoice instead of adding a
                second one. Untick if that was a different job.
              </span>
            </span>
          </label>
        )}

        {!adopting && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={createIncome}
              onChange={(e) => setCreateIncome(e.target.checked)}
              className={ADMIN_CHECKBOX_CLS}
            />
            <span>
              <span className="font-medium text-admin-text">Record income entry</span>
              {alreadyPaid && (
                <span className="mt-0.5 block text-sm text-admin-muted">
                  {hasLinkedIncome
                    ? "Already linked to a ledger entry; leave unticked to just refresh its date/method."
                    : "Already marked paid; leave unticked unless the income was never recorded, to avoid a duplicate row."}
                </span>
              )}
            </span>
          </label>
        )}

        {wronglyChased && invoice.reminderLastSentAt && (
          <label className="flex items-start gap-2 rounded-lg border border-admin-border bg-admin-bg p-3">
            <input
              type="checkbox"
              checked={sendApology}
              onChange={(e) => setSendApology(e.target.checked)}
              className={ADMIN_CHECKBOX_CLS}
            />
            <span>
              <span className="font-medium text-admin-text">Apologise for the reminder</span>
              <span className="mt-0.5 block text-sm text-admin-muted">
                A reminder went out on {formatDateShort(invoice.reminderLastSentAt)}, after this
                payment date. Emails {invoice.clientName} to say the invoice was already paid and
                sorry for the chase.
              </span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}
