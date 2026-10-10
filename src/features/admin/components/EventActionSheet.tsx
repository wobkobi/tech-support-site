"use client";
// src/features/admin/components/EventActionSheet.tsx
// Bottom-sheet of quick mutations for a booking event, opened by a long-press on a
// booking card in DayAgendaView: view details, complete, cancel, no-show, reschedule,
// bill in calculator, resend review email, delete (test bookings only). Mutations route
// through the shared useBookingActions hook, with toasts from the global admin toaster.
// Built on the kit Modal in its sheet placement: pinned to the bottom edge on phones,
// centred from sm.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { adminButtonClass } from "@/features/admin/components/ui/button-classes";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { Modal } from "@/features/admin/components/ui/Modal";
import type {
  BookingStatus,
  WeekEvent,
  WeekEventBooking,
} from "@/features/admin/lib/schedule-types";
import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
import { cn } from "@/shared/lib/cn";
import { isPastEditWindow } from "@/shared/lib/edit-window";
import type React from "react";
import { useState } from "react";

/** Which mutation a pending confirmation will run once accepted. */
type PendingTarget =
  | { kind: "complete" }
  | { kind: "cancel"; mode: "operator" | "on-behalf" }
  | { kind: "no-show" }
  | { kind: "delete" };

/** A mutation awaiting confirmation, with the dialog copy to show for it. */
interface PendingAction {
  title: string;
  /** Omitted by the dialogs that render a checkbox body from live state instead. */
  body?: string;
  confirmLabel: string;
  tone: "default" | "danger";
  target: PendingTarget;
}

/** Full-width sheet action height: a 44px finger target on every screen. */
const SHEET_BUTTON_CLS = "h-11 w-full";

/**
 * Amber warning tint laid over the secondary variant for Mark no-show, so it stands apart
 * from the neutral cancel when the sheet is used one-handed on a job.
 */
const SHEET_NO_SHOW_CLS =
  "border-amber-300 bg-amber-100 text-amber-900 hover:border-amber-500 hover:bg-amber-200";

/**
 * Plain links styled as the secondary AdminButton at sheet size. They stay native anchors
 * because Reschedule opens a new tab and the others do a full page load, which the
 * AdminButton link form (a client-side Next Link) would change.
 */
const SHEET_LINK_CLS = cn(adminButtonClass({ variant: "secondary" }), SHEET_BUTTON_CLS);

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
  // Ticked by default: a no-show is normally chased for the call-out fee.
  const [draftInvoice, setDraftInvoice] = useState(true);

  const booking = event.booking;
  const status: BookingStatus = booking.status;
  const isPast = new Date(event.startAt).getTime() < renderedAt;
  const isCancelled = status === "cancelled";
  const isCompleted = status === "completed";
  const isConfirmed = status === "confirmed";
  // A completed job already happened, so cancelling it would only send the
  // customer a Google "cancelled" email for a visit they had.
  const isOpen = !isCancelled && !isCompleted;
  const isTestBooking = booking.name.toLowerCase().includes("test");
  // Cancel / no-show lock 18h after the booking ends, mirroring the server
  // guard, so the operator sees it up front rather than via a rejection toast.
  // Completing stays available at any age - it is the expected terminal state
  // and moves no money, so locking it would only leave the booking unfinishable.
  // Billing, review resend, reschedule (future-only) and delete stay available.
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

  /** Confirms completing the booking. */
  function handleComplete(): void {
    setPending({
      title: "Mark this booking completed?",
      confirmLabel: "Mark completed",
      tone: "default",
      target: { kind: "complete" },
    });
  }

  /**
   * Cancels the booking. operator = no customer fee; on-behalf = standard
   * cancellation-fee rules. Keep the wording in step with BookingActions.
   * @param mode - Cancellation policy mode.
   */
  function handleCancel(mode: "operator" | "on-behalf"): void {
    setPending({
      title: mode === "operator" ? "Cancel this booking on my end?" : "Cancel for the customer?",
      body:
        mode === "operator"
          ? "No fee will be charged to the customer."
          : "The standard cancellation fee rules apply (call-out + travel inside the fee windows).",
      confirmLabel: "Cancel booking",
      tone: "danger",
      target: { kind: "cancel", mode },
    });
  }

  /** Confirms the no-show, with the draft invoice as an opt-out. */
  function handleNoShow(): void {
    setDraftInvoice(true);
    setPending({
      title: "Mark as no-show?",
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

  // Rendered from live state rather than stored on `pending`, so a stored
  // element can't freeze the tick.
  const confirmBody =
    pending?.target.kind === "complete" ? (
      "This only changes the status. The review request goes out with the invoice."
    ) : pending?.target.kind === "no-show" ? (
      <div className="flex flex-col gap-2">
        <p>The call-out fee plus round-trip travel is charged for a no-show.</p>
        <p>The calendar event is removed without emailing the customer.</p>
        <AdminCheckbox
          checked={draftInvoice}
          onChange={setDraftInvoice}
          disabled={busy}
          label="Draft the invoice for it"
        />
      </div>
    ) : pending?.target.kind === "cancel" ? (
      // Every booking on the schedule has its Google event, and deleting it is
      // the only notice the customer gets - the site sends none of its own.
      <div className="flex flex-col gap-2">
        <p>{pending.body}</p>
        <p className="font-medium text-admin-text">
          Google Calendar emails the customer that the visit is cancelled.
        </p>
      </div>
    ) : (
      pending?.body
    );

  return (
    <Modal
      open
      onClose={onClose}
      placement="sheet"
      title={
        // The hidden prefix keeps the dialog's accessible name "Actions for <name>".
        <span className="block truncate">
          <span className="sr-only">Actions for </span>
          {booking.name}
        </span>
      }
      description={<span className="block truncate">{event.title}</span>}
    >
      <div className="flex flex-col gap-2">
        <a href={`/admin/bookings/${booking.id}`} className={SHEET_LINK_CLS}>
          View details
        </a>

        {isEditLocked && isOpen && (
          <p className="px-1 text-center text-sm text-admin-faint">
            Cancelling locks {lockHours}h after a booking ends. Completing stays open.
          </p>
        )}

        {isConfirmed && (
          <AdminButton
            variant="outline"
            onClick={handleComplete}
            disabled={busy}
            className={SHEET_BUTTON_CLS}
          >
            Mark completed
          </AdminButton>
        )}

        {isConfirmed && isPast && (
          <AdminButton
            variant="secondary"
            onClick={handleNoShow}
            disabled={busy || isEditLocked}
            className={cn(SHEET_BUTTON_CLS, SHEET_NO_SHOW_CLS)}
          >
            Mark no-show
          </AdminButton>
        )}

        {isOpen && (
          <>
            <AdminButton
              variant="secondary"
              onClick={() => handleCancel("operator")}
              disabled={busy || isEditLocked}
              className={SHEET_BUTTON_CLS}
            >
              Cancel - my call
            </AdminButton>
            <AdminButton
              variant="danger"
              onClick={() => handleCancel("on-behalf")}
              disabled={busy || isEditLocked}
              className={SHEET_BUTTON_CLS}
            >
              Cancel - for customer
            </AdminButton>
            {new Date(event.startAt).getTime() > renderedAt && (
              <a
                href={`/booking/edit?token=${booking.cancelToken}`}
                target="_blank"
                rel="noreferrer"
                className={SHEET_LINK_CLS}
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
              className={SHEET_LINK_CLS}
            >
              Bill in calculator
            </a>
            <AdminButton
              variant="secondary"
              onClick={handleResendReview}
              disabled={busy}
              className={SHEET_BUTTON_CLS}
            >
              Send review email
            </AdminButton>
          </>
        )}

        {isTestBooking && (
          <AdminButton
            variant="danger"
            onClick={handleDelete}
            disabled={busy}
            className={SHEET_BUTTON_CLS}
          >
            Delete booking
          </AdminButton>
        )}
      </div>

      {/* Sits inside the Modal panel, whose click handler stops propagation, so
          dialog clicks don't bubble to the sheet backdrop and close it mid-confirm. */}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ""}
        body={confirmBody}
        confirmLabel={pending?.confirmLabel}
        tone={pending?.tone}
        busy={busy}
        onConfirm={() => {
          const target = pending?.target;
          setPending(null);
          if (!target) return;
          void act(() => {
            if (target.kind === "complete") {
              return actions.completeBooking(booking.id);
            }
            if (target.kind === "cancel") return actions.cancelBooking(booking.id, target.mode);
            if (target.kind === "no-show") return actions.markNoShow(booking.id, draftInvoice);
            return actions.deleteBooking(booking.id);
          });
        }}
        onCancel={() => setPending(null)}
      />
    </Modal>
  );
}
