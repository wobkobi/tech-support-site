"use client";
// src/features/admin/components/EventActionSheet.tsx
/**
 * @description Bottom-sheet of quick mutations for a booking event, opened by
 * a long-press on a booking card in DayAgendaView: view details, complete,
 * cancel, no-show, reschedule, bill in calculator, resend review email, delete
 * (test bookings only). Mutations route through the shared
 * {@link useBookingActions} hook, with toasts from the global admin toaster.
 */

import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import type {
  BookingStatus,
  WeekEvent,
  WeekEventBooking,
} from "@/features/admin/lib/schedule-types";
import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
import { isPastEditWindow } from "@/shared/lib/edit-window";
import type React from "react";
import { useEffect, useRef, useState } from "react";

/** Which mutation a pending confirmation will run once accepted. */
type PendingTarget =
  { kind: "cancel"; mode: "operator" | "on-behalf" } | { kind: "no-show" } | { kind: "delete" };

/** A mutation awaiting confirmation, with the dialog copy to show for it. */
interface PendingAction {
  title: string;
  body: string;
  confirmLabel: string;
  tone: "default" | "danger";
  target: PendingTarget;
}

interface EventActionSheetProps {
  /**
   * The booking event being acted on. Caller is responsible for only
   * opening the sheet when `ev.kind === "booking"` and `ev.booking` exists.
   */
  event: WeekEvent & { booking: WeekEventBooking };
  /** Live past-edit lock window (hours) - scheduling.pastEditLockHours. */
  lockHours: number;
  /** Called after a successful mutation - parent should refresh data. */
  onChanged: () => void;
  /** Closes the sheet without changing anything. */
  onClose: () => void;
}

/**
 * Renders the action sheet and runs its mutations through
 * {@link useBookingActions} (the same wrappers the bookings list and detail
 * page use) so the schedule view stays behaviourally identical to them.
 * @param props - Component props.
 * @param props.event - Event with attached booking data.
 * @param props.lockHours - Live past-edit lock window (hours).
 * @param props.onChanged - Parent callback after a successful mutation.
 * @param props.onClose - Closes the sheet.
 * @returns Action sheet element.
 */
export function EventActionSheet({
  event,
  lockHours,
  onChanged,
  onClose,
}: EventActionSheetProps): React.ReactElement {
  const actions = useBookingActions();
  const [busy, setBusy] = useState(false);
  // Stable "now" so the past/future booking checks don't get flagged for
  // calling an impure function during render.
  const [renderedAt] = useState(() => Date.now());
  const [pending, setPending] = useState<PendingAction | null>(null);

  // Keep the latest onClose without re-running the dialog effect (parent passes
  // a fresh closure each render). Updated in an effect so the ref is never
  // written during render.
  const onCloseRef = useRef(onClose);
  // Mirrors `pending` so the Escape handler can defer to the confirm dialog
  // without the effect depending on it.
  const pendingRef = useRef<PendingAction | null>(pending);
  useEffect(() => {
    onCloseRef.current = onClose;
    pendingRef.current = pending;
  });

  // Close on Escape and restore focus to the opener when the sheet unmounts.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    /**
     * Closes the sheet when Escape is pressed. While a confirm dialog is open
     * the key belongs to that dialog, so the sheet stays put.
     * @param e - Keydown event.
     */
    function onKey(e: KeyboardEvent): void {
      if (e.key !== "Escape" || pendingRef.current) return;
      onCloseRef.current();
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
  const isEditLocked = isPastEditWindow(new Date(event.endAt).getTime(), renderedAt, lockHours);

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
    setPending({
      title: mode === "operator" ? "Cancel this booking?" : "Cancel for the customer?",
      body:
        mode === "operator"
          ? "Cancelled on your end - no fee will be charged to the customer."
          : "The standard cancellation fee rules will apply (call-out + travel inside the fee windows).",
      confirmLabel: "Cancel booking",
      tone: "danger",
      target: { kind: "cancel", mode },
    });
  }

  /** Flags the booking as a no-show; drafts the late-cancellation invoice. */
  function handleNoShow(): void {
    setPending({
      title: "Mark as no-show?",
      body: "A draft invoice will be created for the call-out fee plus round-trip travel.",
      confirmLabel: "Mark no-show",
      tone: "danger",
      target: { kind: "no-show" },
    });
  }

  /** Re-sends (or first-sends) the review email. */
  function handleResendReview(): void {
    void act(() => actions.resendReview(booking.id));
  }

  /** Permanently deletes the booking (test bookings only). */
  function handleDelete(): void {
    setPending({
      title: "Delete this test booking?",
      body: "This permanently deletes the booking and cannot be undone.",
      confirmLabel: "Delete booking",
      tone: "danger",
      target: { kind: "delete" },
    });
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
        className="w-full max-w-lg rounded-xl bg-admin-surface p-4 shadow-xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-admin-text">{booking.name}</p>
            <p className="truncate text-xs text-admin-muted">{event.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-admin-faint hover:bg-admin-bg hover:text-admin-text"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <a
            href={`/admin/bookings/${booking.id}`}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-russian-violet/10 px-4 text-sm font-semibold text-russian-violet select-none hover:bg-russian-violet/20"
          >
            View details
          </a>

          {isEditLocked && !isCancelled && (
            <p className="px-1 text-center text-xs text-admin-faint">
              Status changes lock {lockHours}h after a booking ends.
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
                className="inline-flex h-11 items-center justify-center rounded-lg bg-admin-border px-4 text-sm font-semibold text-admin-text hover:bg-admin-border-strong disabled:opacity-50"
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
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-russian-violet/10 px-4 text-sm font-semibold text-russian-violet select-none hover:bg-russian-violet/20"
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
                className="inline-flex h-11 items-center justify-center rounded-lg bg-russian-violet/10 px-4 text-sm font-semibold text-russian-violet select-none hover:bg-russian-violet/20"
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

        {/* Sits inside the stop-propagation container so dialog clicks don't
            bubble to the sheet backdrop and close it mid-confirm. */}
        <ConfirmDialog
          open={pending !== null}
          title={pending?.title ?? ""}
          body={pending?.body}
          confirmLabel={pending?.confirmLabel}
          tone={pending?.tone}
          busy={busy}
          onConfirm={() => {
            const target = pending?.target;
            setPending(null);
            if (!target) return;
            void act(() => {
              if (target.kind === "cancel") return actions.cancelBooking(booking.id, target.mode);
              if (target.kind === "no-show") return actions.markNoShow(booking.id);
              return actions.deleteBooking(booking.id);
            });
          }}
          onCancel={() => setPending(null)}
        />
      </div>
    </div>
  );
}
