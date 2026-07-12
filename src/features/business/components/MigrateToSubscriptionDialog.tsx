"use client";
// src/features/business/components/MigrateToSubscriptionDialog.tsx
/**
 * @description Turns a repeat expense into a recurring subscription. Prefilled
 * from the expense (supplier, description, category, amount, GST, method, notes).
 * When the same supplier+description recurs across several expenses, the caller
 * passes the whole matching set - the dialog treats them as one subscription,
 * guesses the frequency from the gaps between their dates, and defaults next-due
 * off the most recent one. POSTs the existing subscriptions API - no API change.
 * Sheets-safe: the expense entries and their sheet rows are left untouched; the
 * new subscription is site-only.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { advanceNextDue, formatNZD } from "@/features/business/lib/business";
import { VALID_FREQUENCIES } from "@/features/business/lib/constants";
import type { ExpenseEntry } from "@/features/business/types/business";
import type React from "react";
import { useState } from "react";

/** Props for {@link MigrateToSubscriptionDialog}. */
interface MigrateToSubscriptionDialogProps {
  /** Whether the dialog is shown. */
  open: boolean;
  /** The expense being migrated (prefills the subscription). */
  expense: ExpenseEntry;
  /** All expenses sharing this supplier+description (>= 2 means recurring). */
  matches?: ExpenseEntry[];
  /** Close handler; `migrated` is true when a subscription was created. */
  onClose: (migrated: boolean) => void;
}

const INPUT_CLS =
  "w-full rounded-lg border border-admin-border-strong bg-admin-surface px-3 py-2 text-sm text-admin-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet";

/** Known cadences in days, matched to a frequency label. */
const CADENCES: { days: number; frequency: string }[] = [
  { days: 7, frequency: "weekly" },
  { days: 14, frequency: "fortnightly" },
  { days: 30, frequency: "monthly" },
  { days: 91, frequency: "quarterly" },
  { days: 365, frequency: "annually" },
];

/**
 * Guesses a frequency from the median gap between a set of dates.
 * @param dates - The matching expense dates.
 * @returns The nearest known frequency (defaults to "monthly" for < 2 dates).
 */
function inferFrequency(dates: Date[]): string {
  if (dates.length < 2) return "monthly";
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i].getTime() - sorted[i - 1].getTime()) / 86_400_000);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return CADENCES.reduce((best, c) =>
    Math.abs(c.days - median) < Math.abs(best.days - median) ? c : best,
  ).frequency;
}

/**
 * Advances a date by a frequency and returns it as YYYY-MM-DD.
 * @param isoDate - The base date (ISO string).
 * @param frequency - The subscription frequency.
 * @returns The next-due date as YYYY-MM-DD.
 */
function defaultNextDue(isoDate: string, frequency: string): string {
  return advanceNextDue(new Date(isoDate), frequency).toISOString().slice(0, 10);
}

/**
 * Dialog to migrate an expense (or a recurring set) into a subscription.
 * @param props - Component props.
 * @param props.open - Whether the dialog is shown.
 * @param props.expense - The expense being migrated.
 * @param props.matches - All expenses sharing its supplier+description.
 * @param props.onClose - Close handler; receives whether a subscription was created.
 * @returns The dialog element.
 */
export function MigrateToSubscriptionDialog({
  open,
  expense,
  matches,
  onClose,
}: MigrateToSubscriptionDialogProps): React.ReactElement {
  const { toast } = useToast();
  const matchList = matches && matches.length > 0 ? matches : [expense];
  const recurring = matchList.length >= 2;
  // Most recent match anchors the next-due default; frequency is guessed from
  // the gaps when the expense recurs, else defaults to monthly.
  const latestDate = matchList.reduce(
    (latest, m) => (new Date(m.date) > new Date(latest) ? m.date : latest),
    matchList[0].date,
  );
  const initialFrequency = recurring
    ? inferFrequency(matchList.map((m) => new Date(m.date)))
    : "monthly";

  const [frequency, setFrequency] = useState(initialFrequency);
  const [nextDue, setNextDue] = useState(() => defaultNextDue(latestDate, initialFrequency));
  const [nextDueEdited, setNextDueEdited] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Changes the frequency and re-derives the next-due date unless it was edited.
   * @param f - The new frequency.
   */
  function changeFrequency(f: string): void {
    setFrequency(f);
    if (!nextDueEdited) setNextDue(defaultNextDue(latestDate, f));
  }

  /**
   * Creates the subscription from the expense, then closes on success.
   */
  async function submit(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/business/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: expense.description,
          supplier: expense.supplier,
          category: expense.category,
          amountIncl: expense.amountIncl,
          gstRate: expense.gstAmount > 0 ? 0.15 : 0,
          method: expense.method,
          frequency,
          nextDue,
          notes: expense.notes,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        toast(d.error ?? "Couldn't create the subscription.", { tone: "error" });
        setBusy(false);
        return;
      }
      onClose(true);
    } catch {
      toast("Couldn't create the subscription. Check your connection.", { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose(false)}
      title="Migrate to subscription"
      description="Sets up a recurring subscription from this expense."
      size="md"
      footer={
        <>
          <AdminButton variant="secondary" onClick={() => onClose(false)} disabled={busy}>
            Cancel
          </AdminButton>
          <AdminButton onClick={() => void submit()} busy={busy}>
            Create subscription
          </AdminButton>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-admin-text-secondary">
          <p className="font-medium text-admin-text">{expense.supplier}</p>
          <p className="text-xs">{expense.description}</p>
          <p className="mt-1 text-xs">
            {formatNZD(expense.amountIncl)} incl. · {expense.category} · {expense.method}
          </p>
        </div>

        {recurring && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Found <strong>{matchList.length}</strong> expenses from {expense.supplier} for &ldquo;
            {expense.description}&rdquo; - this looks recurring, so they migrate as one subscription
            (frequency guessed from their dates). The expense entries stay as history.
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="font-medium text-admin-text">Frequency</span>
          <select
            value={frequency}
            onChange={(e) => changeFrequency(e.target.value)}
            className={INPUT_CLS}
          >
            {VALID_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-admin-text">Next due</span>
          <input
            type="date"
            value={nextDue}
            onChange={(e) => {
              setNextDue(e.target.value);
              setNextDueEdited(true);
            }}
            className={INPUT_CLS}
          />
        </label>

        <p className="text-xs text-admin-muted">
          The expense entry is kept as a historical record (and stays on the Expenses sheet). This
          creates a new site-only subscription - nothing on the sheet moves or is deleted.
        </p>
      </div>
    </Modal>
  );
}
