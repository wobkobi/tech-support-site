"use client";
// src/features/admin/components/EventActionSheet.tsx
/**
 * @description Bottom-sheet of quick mutations for a booking event, opened by
 * a long-press on a booking card in DayAgendaView: complete, cancel
 * (operator/on-behalf), no-show, reschedule, resend review email, delete
 * (test bookings only).
 */

import type {
  BookingStatus,
  WeekEvent,
  WeekEventBooking,
} from "@/features/admin/lib/schedule-types";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useRef, useState } from "react";

interface EventActionSheetProps {
  /**
   * The booking event being acted on. Caller is responsible for only
   * opening the sheet when `ev.kind === "booking"` and `ev.booking` exists.
   */
  event: WeekEvent & { booking: WeekEventBooking };
  /** Called after a successful mutation - parent should refresh data. */
  onChanged: () => void;
  /** Closes the sheet without changing anything. */
  onClose: () => void;
}

type ToastState = { msg: string; kind: "ok" | "warn" } | null;

/**
 * Renders the action sheet + handles its API calls. Reuses the same
 * endpoints as BookingAdminList so the schedule view and the bookings list
 * stay behaviourally identical.
 * @param props - Component props.
 * @param props.event - Event with attached booking data.
 * @param props.onChanged - Parent callback after a successful mutation.
 * @param props.onClose - Closes the sheet.
 * @returns Action sheet element.
 */
export function EventActionSheet({
  event,
  onChanged,
  onClose,
}: EventActionSheetProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  // Stable "now" so the past/future booking checks don't get flagged for
  // calling an impure function during render.
  const [renderedAt] = useState(() => Date.now());

  // Keep the latest onClose without re-running the dialog effect (parent passes
  // a fresh closure each render). Updated in an effect so the ref is never
  // written during render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Close on Escape and restore focus to the opener when the sheet unmounts.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    /**
     * Closes the sheet when Escape is pressed.
     * @param e - Keydown event.
     */
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  const booking = event.booking;
  const status: BookingStatus = booking.status;
  const isPast = new Date(event.startAt).getTime() < renderedAt;
  const isCancelled = status === "cancelled";
  const isCompleted = status === "completed";
  const isConfirmed = status === "confirmed";
  const isTestBooking = booking.name.toLowerCase().includes("test");

  /**
   * Surfaces a toast for 4s, then clears it.
   * @param msg - Toast message.
   * @param kind - Toast kind for colour.
   */
  function showToast(msg: string, kind: "ok" | "warn" = "ok"): void {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 4000);
  }

  /**
   * Generic PATCH wrapper around /api/admin/bookings/[id]. Returns true on
   * success so callers can decide whether to close + refresh.
   * @param body - PATCH body.
   * @returns Whether the request succeeded.
   */
  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(data.error ?? "Action failed.", "warn");
        return false;
      }
      return true;
    } catch (err) {
      console.error("[EventActionSheet] PATCH failed", err);
      showToast("Network error - try again.", "warn");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Marks the booking as completed and triggers the review email. */
  async function handleComplete(): Promise<void> {
    const ok = await patch({ status: "completed" });
    if (ok) {
      onChanged();
      onClose();
    }
  }

  /**
   * Cancels the booking. operator = no customer fee; on-behalf = standard
   * cancellation-fee rules (same wording as BookingAdminList for parity).
   * @param mode - Cancellation policy mode.
   */
  async function handleCancel(mode: "operator" | "on-behalf"): Promise<void> {
    const confirmMsg =
      mode === "operator"
        ? "Cancel this booking on my end? No fee will be charged to the customer."
        : "Cancel for the customer? The standard cancellation fee rules will apply (callout + travel inside the fee windows).";
    if (!window.confirm(confirmMsg)) return;
    const ok = await patch({ status: "cancelled", cancelMode: mode });
    if (ok) {
      onChanged();
      onClose();
    }
  }

  /** Flags the booking as a no-show; drafts the late-cancellation invoice. */
  async function handleNoShow(): Promise<void> {
    if (
      !window.confirm(
        "Mark as no-show? A draft invoice will be created for the call-out fee plus round-trip travel.",
      )
    )
      return;
    const ok = await patch({ markNoShow: true });
    if (ok) {
      onChanged();
      onClose();
    }
  }

  /** Re-sends (or first-sends) the review email. */
  async function handleResendReview(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/resend-review`, {
        method: "POST",
        headers: {},
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(data.error ?? "Failed to send.", "warn");
        return;
      }
      onChanged();
      onClose();
    } catch (err) {
      console.error("[EventActionSheet] resend-review failed", err);
      showToast("Network error - try again.", "warn");
    } finally {
      setBusy(false);
    }
  }

  /** Permanently deletes the booking (test bookings only). */
  async function handleDelete(): Promise<void> {
    if (!window.confirm("Permanently delete this test booking? This cannot be undone.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: "DELETE",
        headers: {},
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(data.error ?? "Delete failed.", "warn");
        return;
      }
      onChanged();
      onClose();
    } catch (err) {
      console.error("[EventActionSheet] DELETE failed", err);
      showToast("Network error - try again.", "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Actions for ${booking.name}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-700">{booking.name}</p>
            <p className="truncate text-xs text-slate-500">{event.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </div>

        {toast && (
          <p
            className={cn(
              "mb-3 rounded-md border px-3 py-2 text-xs font-medium",
              toast.kind === "ok"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-amber-200 bg-amber-50 text-amber-800",
            )}
          >
            {toast.msg}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {isConfirmed && (
            <button
              type="button"
              onClick={() => void handleComplete()}
              disabled={busy}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-green-500/20 px-4 text-sm font-semibold text-green-700 hover:bg-green-500/30 disabled:opacity-50"
            >
              Mark completed
            </button>
          )}

          {isConfirmed && isPast && (
            <button
              type="button"
              onClick={() => void handleNoShow()}
              disabled={busy}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-amber-500/20 px-4 text-sm font-semibold text-amber-700 hover:bg-amber-500/30 disabled:opacity-50"
            >
              Mark no-show
            </button>
          )}

          {!isCancelled && (
            <>
              <button
                type="button"
                onClick={() => void handleCancel("operator")}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
              >
                Cancel - my call
              </button>
              <button
                type="button"
                onClick={() => void handleCancel("on-behalf")}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-red-500/20 px-4 text-sm font-semibold text-red-600 hover:bg-red-500/30 disabled:opacity-50"
              >
                Cancel - for customer
              </button>
              {new Date(event.startAt).getTime() > renderedAt && (
                <a
                  href={`/booking/edit?token=${booking.cancelToken}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-russian-violet/10 px-4 text-sm font-semibold text-russian-violet hover:bg-russian-violet/20"
                >
                  Reschedule
                </a>
              )}
            </>
          )}

          {(isConfirmed || isCompleted) && (
            <button
              type="button"
              onClick={() => void handleResendReview()}
              disabled={busy}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-moonstone-600/15 px-4 text-sm font-semibold text-moonstone-700 hover:bg-moonstone-600/25 disabled:opacity-50"
            >
              Send review email
            </button>
          )}

          {isTestBooking && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-red-500/20 px-4 text-sm font-semibold text-red-600 hover:bg-red-500/30 disabled:opacity-50"
            >
              Delete booking
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
