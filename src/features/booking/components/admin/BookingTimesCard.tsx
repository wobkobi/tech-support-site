"use client";
// src/features/booking/components/admin/BookingTimesCard.tsx
// Editable booking times. Past-to-past moves silently record what happened; anything
// else is a reschedule that emails the customer. Overlaps (409) re-offer via a confirm.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminDateTimeInput } from "@/features/admin/components/ui/AdminDateTimeInput";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { ADMIN_META_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
import { formatMins } from "@/features/business/lib/business";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { isPastEditWindow } from "@/shared/lib/edit-window";
import { fromNzInputValue, toNzInputValue } from "@/shared/lib/timezone-utils";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** Props for {@link BookingTimesCard}. */
interface BookingTimesCardProps {
  /** Booking id. */
  id: string;
  /** Appointment start (ISO). */
  startAt: string;
  /** Appointment finish (ISO). */
  endAt: string;
  /** Booking lifecycle status - a cancelled booking has no times worth moving. */
  status: "confirmed" | "cancelled" | "completed";
  /** Hours after the end before the past-edit lock closes the window. */
  lockHours: number;
}

/**
 * Editable appointment times card.
 * @param props - Component props.
 * @param props.id - Booking id.
 * @param props.startAt - Appointment start (ISO).
 * @param props.endAt - Appointment finish (ISO).
 * @param props.status - Booking lifecycle status.
 * @param props.lockHours - Hours after the end before the past-edit lock closes.
 * @returns The times card element.
 */
export function BookingTimesCard({
  id,
  startAt,
  endAt,
  status,
  lockHours,
}: BookingTimesCardProps): React.ReactElement {
  const router = useRouter();
  const { updateBookingTimes } = useBookingActions();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [form, setForm] = useState({
    start: toNzInputValue(startAt),
    end: toNzInputValue(endAt),
  });
  // Ticked by default; only used on the reschedule branch.
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  // Stable "now" for react-hooks/purity; the PATCH route re-checks the lock.
  const [renderedAt] = useState(() => Date.now());
  const locked = isPastEditWindow(new Date(endAt).getTime(), renderedAt, lockHours);

  // Mirrors the server: silence needs both the stored and typed starts in the past.
  const typedStart = form.start ? fromNzInputValue(form.start).getTime() : 0;
  const alreadyRun = new Date(startAt).getTime() <= renderedAt && typedStart <= renderedAt;
  const willNotify = !alreadyRun && status !== "cancelled";
  const spanMins = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000);
  const editable = !locked && status !== "cancelled";

  /** Resets the fields to the current props and leaves edit mode. */
  function cancel(): void {
    setForm({ start: toNzInputValue(startAt), end: toNzInputValue(endAt) });
    setNotifyCustomer(true);
    setEditing(false);
  }

  /**
   * Sets the start and shifts the finish by the same amount, so the booking keeps its length.
   * Moving the finish leaves the start where it is.
   * @param start - The new NZ start value, or "" when cleared.
   */
  function moveStart(start: string): void {
    setForm((f) => {
      if (!start || !f.start || !f.end) return { ...f, start };
      const shift = fromNzInputValue(start).getTime() - fromNzInputValue(f.start).getTime();
      return { start, end: toNzInputValue(new Date(fromNzInputValue(f.end).getTime() + shift)) };
    });
  }

  /**
   * Saves the typed NZ times; an overlap without `force` opens the confirm dialog.
   * @param force - Save through an overlap warning.
   */
  async function save(force = false): Promise<void> {
    if (!form.start || !form.end) return;
    setSaving(true);
    const result = await updateBookingTimes(id, {
      startAt: fromNzInputValue(form.start).toISOString(),
      endAt: fromNzInputValue(form.end).toISOString(),
      notifyCustomer,
      ...(force ? { force: true } : {}),
    });
    setSaving(false);
    if (result.conflict) {
      setConflict(result.conflict);
      return;
    }
    setConflict(null);
    if (result.ok) {
      setEditing(false);
      router.refresh();
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-admin-text">Times</h2>
          {editable && (
            <AdminButton variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </AdminButton>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <span className={ADMIN_META_LABEL_CLS}>Start</span>
            <span className="text-sm text-admin-text">{formatDateTimeShort(startAt)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className={ADMIN_META_LABEL_CLS}>Finish</span>
            <span className="text-sm text-admin-text">{formatDateTimeShort(endAt)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className={ADMIN_META_LABEL_CLS}>On site</span>
            <span className="text-sm text-admin-text">{formatMins(spanMins)}</span>
          </div>
        </div>
        {locked && status !== "cancelled" && (
          <p className="text-sm text-admin-muted">
            Locked - this ended over {lockHours}h ago. Raise the past-edit window in Settings to
            reopen it.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-admin-text">Edit times</h2>
        {willNotify ? (
          <AdminCheckbox
            checked={notifyCustomer}
            onChange={setNotifyCustomer}
            disabled={saving}
            label="Email the customer the new time"
          />
        ) : (
          <p className="text-sm text-admin-muted">
            This records what actually happened. No email is sent.
          </p>
        )}
        <AdminField label="Start" htmlFor={`edit-start-${id}`}>
          <AdminDateTimeInput
            id={`edit-start-${id}`}
            timeLabel="Start time"
            value={form.start}
            onChange={moveStart}
            disabled={saving}
          />
        </AdminField>
        <AdminField label="Finish" htmlFor={`edit-end-${id}`}>
          <AdminDateTimeInput
            id={`edit-end-${id}`}
            timeLabel="Finish time"
            value={form.end}
            onChange={(end) => setForm((f) => ({ ...f, end }))}
            disabled={saving}
          />
        </AdminField>
        <div className="flex flex-wrap gap-2">
          <AdminButton
            onClick={() => void save()}
            busy={saving}
            disabled={!form.start || !form.end}
          >
            Save times
          </AdminButton>
          <AdminButton variant="secondary" onClick={cancel} disabled={saving}>
            Cancel
          </AdminButton>
        </div>
      </div>

      <ConfirmDialog
        open={conflict !== null}
        title="That time is already taken"
        body={`${conflict} Save it anyway?`}
        confirmLabel="Save anyway"
        tone="danger"
        busy={saving}
        onConfirm={() => void save(true)}
        onCancel={() => !saving && setConflict(null)}
      />
    </>
  );
}
