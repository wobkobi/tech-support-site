"use client";
// src/features/business/components/RecordSubscriptionDialog.tsx
// Confirms one subscription payment before it hits the ledger, prefilled with the saved amount
// and due date so a charge that came in different (usage pricing, a plan change, FX) goes in
// at what the bank statement says.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatNZD, todayISO } from "@/features/business/lib/business";
import type { Subscription } from "@/features/business/types/business";
import { moneyInputText } from "@/shared/lib/money";
import type React from "react";
import { useId, useState } from "react";

/** Props for {@link RecordSubscriptionDialog}. */
interface RecordSubscriptionDialogProps {
  /** The subscription being recorded. */
  sub: Subscription;
  /** Close handler; `recorded` is true when the payment (or a 409 race) changed the list. */
  onClose: (recorded: boolean) => void;
}

/**
 * Default payment date: the due date, or today when recording ahead of it, so a late record
 * still lands near the real charge and an early one never sits in the future.
 * @param nextDue - The subscription's next due date (ISO).
 * @returns YYYY-MM-DD.
 */
function defaultDate(nextDue: string): string {
  const due = nextDue.slice(0, 10);
  const today = todayISO();
  return due < today ? due : today;
}

/**
 * Dialog that records one subscription payment at the amount and date actually charged.
 * @param props - Component props.
 * @param props.sub - The subscription being recorded.
 * @param props.onClose - Close handler; receives whether the list needs reloading.
 * @returns The dialog element.
 */
export function RecordSubscriptionDialog({
  sub,
  onClose,
}: RecordSubscriptionDialogProps): React.ReactElement {
  const { toast } = useToast();
  const id = useId();
  const [amount, setAmount] = useState(() => moneyInputText(sub.amountIncl));
  const [date, setDate] = useState(() => defaultDate(sub.nextDue));
  const [busy, setBusy] = useState(false);

  const amountNum = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(amountNum) && amountNum >= 0 && date !== "";
  const differs = valid && Math.abs(amountNum - sub.amountIncl) >= 0.005;

  /**
   * Posts the payment, then closes on success or on a lost race.
   */
  async function submit(): Promise<void> {
    if (!valid) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/business/subscriptions/${sub.id}/record`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountIncl: amountNum, date }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        sheetSyncWarning?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) {
        toast(
          data.sheetSyncWarning
            ? "Payment recorded - sheet sync failed, add row manually."
            : "Payment recorded.",
          { tone: data.sheetSyncWarning ? "warning" : "success" },
        );
        onClose(true);
        return;
      }
      // A 409 means a double click already recorded this period: reload rather than retry.
      toast(data.error ?? "Record failed.", { tone: "error" });
      if (res.status === 409) {
        onClose(true);
        return;
      }
      setBusy(false);
    } catch {
      toast("Couldn't record the payment. Check your connection.", { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => !busy && onClose(false)}
      title="Record payment"
      description="Adds this payment to your expenses and moves the subscription to its next due date."
      size="md"
      footer={
        <>
          <AdminButton variant="secondary" onClick={() => onClose(false)} disabled={busy}>
            Cancel
          </AdminButton>
          <AdminButton onClick={() => void submit()} busy={busy} disabled={!valid}>
            Record payment
          </AdminButton>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-admin-text-secondary">
          <p className="font-medium text-admin-text">{sub.supplier}</p>
          <p>{sub.description}</p>
          <p className="mt-1">
            Usually {formatNZD(sub.amountIncl)} {sub.frequency} · {sub.category}
          </p>
        </div>

        <AdminField label="Amount charged (incl. GST)" htmlFor={`${id}-amount`} required>
          <AdminInput
            id={`${id}-amount`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </AdminField>

        <AdminField label="Date charged" htmlFor={`${id}-date`} required>
          <AdminInput
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </AdminField>

        {differs && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            This records {formatNZD(amountNum)} for this payment only. If the price has changed for
            good, edit the subscription too.
          </p>
        )}
      </div>
    </Modal>
  );
}
