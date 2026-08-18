"use client";
// src/features/booking/components/admin/BookingTimesCard.tsx
/**
 * @description Editable start/finish times on the booking detail page. One
 * control, two meanings: moving a job that has already run to another past time
 * is the operator recording what actually happened, and stays silent; anything
 * else is a reschedule, so the customer is emailed. The banner above the inputs
 * says which a save will do, and follows the times as they're typed. Overlaps
 * on the reschedule path come back as a 409 and are re-offered through a
 * {@link ConfirmDialog} rather than blocked. Between them these are why the
 * Google event no longer has to be corrected by hand.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
import { formatMins } from "@/features/business/lib/business";
import { cn } from "@/shared/lib/cn";
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
  status: "held" | "confirmed" | "cancelled" | "completed";
  /** Hours after the end before the past-edit lock closes the window. */
  lockHours: number;
}

const INPUT_CLS = cn(
  "w-full rounded-lg border border-admin-border-strong bg-admin-surface px-3 py-2 text-sm text-admin-text",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-russian-violet",
);
const LABEL_CLS = "text-xs font-semibold text-admin-muted uppercase";

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
  // Stable "now" so the branch copy doesn't trip react-hooks/purity. The lock
  // is read here rather than on the server for the same reason - it's only the
  // edit affordance, and the PATCH route re-checks it before writing anyway.
  const [renderedAt] = useState(() => Date.now());
  const locked = isPastEditWindow(new Date(endAt).getTime(), renderedAt, lockHours);

  // Mirrors the server's rule: silence needs both the stored and the typed
  // start to be past, so correcting a stale row onto a future date still warns
  // that the customer will be emailed. Re-read as the field is typed.
  const typedStart = form.start ? fromNzInputValue(form.start).getTime() : 0;
  const alreadyRun = new Date(startAt).getTime() <= renderedAt && typedStart <= renderedAt;
  const willNotify = !alreadyRun && status !== "cancelled";
  const spanMins = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000);
  const editable = !locked && status !== "cancelled";

  /**
   * Resets the fields to the current props and leaves edit mode.
   */
  function cancel(): void {
    setForm({ start: toNzInputValue(startAt), end: toNzInputValue(endAt) });
    setEditing(false);
  }

  /**
   * Saves the typed times, converting them from NZ wall clock to instants.
   * A first save without `force` may come back with an overlap, which opens the
   * confirm dialog instead of failing outright.
   * @param force - Save through an overlap warning.
   */
  async function save(force = false): Promise<void> {
    if (!form.start || !form.end) return;
    setSaving(true);
    const result = await updateBookingTimes(id, {
      startAt: fromNzInputValue(form.start).toISOString(),
      endAt: fromNzInputValue(form.end).toISOString(),
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
        <div className="flex flex-col gap-0.5">
          <span className={LABEL_CLS}>Start</span>
          <span className="text-sm text-admin-text">{formatDateTimeShort(startAt)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={LABEL_CLS}>Finish</span>
          <span className="text-sm text-admin-text">{formatDateTimeShort(endAt)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={LABEL_CLS}>On site</span>
          <span className="text-sm text-admin-text">{formatMins(spanMins)}</span>
        </div>
        {locked && status !== "cancelled" && (
          <p className="text-xs text-admin-muted">
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
        <p className="text-xs text-admin-muted">
          {willNotify
            ? "This moves the booking and emails the customer the new time."
            : "This records what actually happened. No email is sent."}
        </p>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Start</span>
          <input
            type="datetime-local"
            className={INPUT_CLS}
            value={form.start}
            onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
            disabled={saving}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLS}>Finish</span>
          <input
            type="datetime-local"
            className={INPUT_CLS}
            value={form.end}
            onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
            disabled={saving}
          />
        </label>
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
