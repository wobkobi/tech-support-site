"use client";
// src/features/admin/components/EventActionSheet.tsx
/**
 * @description Bottom-sheet of quick mutations for a booking event, opened by
 * a long-press on a booking card in DayAgendaView: view details, complete,
 * cancel (operator/on-behalf), no-show, reschedule, bill in calculator, resend
 * review email, delete (test bookings only). Mutations route through the shared
 * {@link useBookingActions} hook so the schedule view and the bookings list stay
 * behaviourally identical, with toasts surfaced by the global admin toaster.
 */

import type {
  BookingStatus,
  WeekEvent,
  WeekEventBooking,
} from "@/features/admin/lib/schedule-types";
import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
import { isPastEditWindow, MAX_PAST_EDIT_HOURS } from "@/shared/lib/edit-window";
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

/**
 * Renders the action sheet + handles its API calls. Reuses {@link useBookingActions}
 * (the same wrappers the bookings list and detail page use) so the schedule view
 * and the bookings list stay behaviourally identical.
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
  const actions = useBookingActions();
  const [busy, setBusy] = useState(false);
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
  // State changes (complete / cancel / no-show) lock 18h after the booking ends,
  // mirroring the server guard - disable them here so the operator sees it up
  // front instead of firing a request that bounces back as a rejection toast.
  // Billing, review resend, reschedule (future-only), and delete stay available.
  const isEditLocked = isPastEditWindow(new Date(event.endAt).getTime(), renderedAt);

  /**
   * Runs a mutation, then closes + refreshes on success. Toasts (including
   * errors) come from {@link useBookingActions}.
   * @param run - The action wrapper to invoke.
   */
  async function act(run: () => Promise<{ ok: boolean }>): Promise<void> {
    setBusy(true);
    const result = await run();
    setBusy(false);
    if (result.ok) {
      onChanged();
      onClose();
    }
  }

  /** Marks the booking as completed and triggers the review email. */
  function handleComplete(): void {
    void act(() => actions.completeBooking(booking.id));
  }

  /**
   * Cancels the booking. operator = no customer fee; on-behalf = standard
   * cancellation-fee rules (same wording as BookingAdminList for parity).
   * @param mode - Cancellation policy mode.
   */
  function handleCancel(mode: "operator" | "on-behalf"): void {
    const confirmMsg =
      mode === "operator"
        ? "Cancel this booking on my end? No fee will be charged to the customer."
        : "Cancel for the customer? The standard cancellation fee rules will apply (callout + travel inside the fee windows).";
    if (!window.confirm(confirmMsg)) return;
    void act(() => actions.cancelBooking(booking.id, mode));
  }

  /** Flags the booking as a no-show; drafts the late-cancellation invoice. */
  function handleNoShow(): void {
    if (
      !window.confirm(
        "Mark as no-show? A draft invoice will be created for the call-out fee plus round-trip travel.",
      )
    )
      return;
    void act(() => actions.markNoShow(booking.id));
  }

  /** Re-sends (or first-sends) the review email. */
  function handleResendReview(): void {
    void act(() => actions.resendReview(booking.id));
  }

  /** Permanently deletes the booking (test bookings only). */
  function handleDelete(): void {
    if (!window.confirm("Permanently delete this test booking? This cannot be undone.")) return;
    void act(() => actions.deleteBooking(booking.id));
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

        <div className="flex flex-col gap-2">
          <a
            href={`/admin/bookings/${booking.id}`}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-russian-violet/10 px-4 text-sm font-semibold text-russian-violet hover:bg-russian-violet/20"
          >
            View details
          </a>

          {isEditLocked && !isCancelled && (
            <p className="px-1 text-center text-xs text-slate-400">
              Status changes lock {MAX_PAST_EDIT_HOURS}h after a booking ends.
            </p>
          )}

          {isConfirmed && (
            <button
              type="button"
              onClick={handleComplete}
              disabled={busy || isEditLocked}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-green-500/20 px-4 text-sm font-semibold text-green-700 hover:bg-green-500/30 disabled:opacity-50"
            >
              Mark completed
            </button>
          )}

          {isConfirmed && isPast && (
            <button
              type="button"
              onClick={handleNoShow}
              disabled={busy || isEditLocked}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-amber-500/20 px-4 text-sm font-semibold text-amber-700 hover:bg-amber-500/30 disabled:opacity-50"
            >
              Mark no-show
            </button>
          )}

          {!isCancelled && (
            <>
              <button
                type="button"
                onClick={() => handleCancel("operator")}
                disabled={busy || isEditLocked}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
              >
                Cancel - my call
              </button>
              <button
                type="button"
                onClick={() => handleCancel("on-behalf")}
                disabled={busy || isEditLocked}
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
            <>
              {/* Deep-link into the calculator with the event's (operator-corrected)
                  times, client, and address pre-filled - see calculator/page.tsx. */}
              <a
                href={`/admin/business/calculator?eventId=${encodeURIComponent(event.id)}`}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-russian-violet/10 px-4 text-sm font-semibold text-russian-violet hover:bg-russian-violet/20"
              >
                Bill in calculator
              </a>
              <button
                type="button"
                onClick={handleResendReview}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-moonstone-600/15 px-4 text-sm font-semibold text-moonstone-700 hover:bg-moonstone-600/25 disabled:opacity-50"
              >
                Send review email
              </button>
            </>
          )}

          {isTestBooking && (
            <button
              type="button"
              onClick={handleDelete}
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
