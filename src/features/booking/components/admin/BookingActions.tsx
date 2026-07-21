"use client";
// src/features/booking/components/admin/BookingActions.tsx
/**
 * @description Lifecycle actions for the booking detail page: mark completed,
 * cancel (my call / for customer), mark no-show (past bookings only), send /
 * resend the review email, reschedule (magic link), and delete (test bookings
 * only). Every mutating action routes through {@link useBookingActions} and is
 * gated by a {@link ConfirmDialog}; on success the page refreshes so the info,
 * timeline, and linked-records cards reflect the new state. Delete redirects back
 * to the bookings list.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** Props for {@link BookingActions}. */
interface BookingActionsProps {
  /** Booking id. */
  id: string;
  /** Booking lifecycle status. */
  status: "held" | "confirmed" | "cancelled" | "completed";
  /** Appointment start (ISO) - gates the no-show + reschedule actions. */
  startAt: string;
  /** Cancel/reschedule magic-link token. */
  cancelToken: string;
  /** Whether a review email has already gone out (tunes the button label + toast). */
  reviewAlreadySent: boolean;
  /** Whether this is a test booking (only test bookings can be deleted). */
  isTest: boolean;
}

/** Which confirm dialog is open. */
type ConfirmKind =
  "complete" | "noshow" | "cancel-operator" | "cancel-onbehalf" | "review" | "delete";

/** Copy + tone for each confirm dialog. */
const CONFIRM_COPY: Record<
  ConfirmKind,
  { title: string; body: string; confirmLabel: string; tone?: "danger" }
> = {
  complete: {
    title: "Mark this booking completed?",
    body: "This also sends the review-request email if one hasn't gone out yet.",
    confirmLabel: "Mark completed",
  },
  noshow: {
    title: "Mark as no-show?",
    body: "A draft invoice will be created for the call-out fee plus round-trip travel.",
    confirmLabel: "Mark no-show",
    tone: "danger",
  },
  "cancel-operator": {
    title: "Cancel this booking on my end?",
    body: "No fee will be charged to the customer.",
    confirmLabel: "Cancel booking",
  },
  "cancel-onbehalf": {
    title: "Cancel for the customer?",
    body: "The standard cancellation fee rules apply (callout + travel inside the fee windows).",
    confirmLabel: "Cancel for customer",
    tone: "danger",
  },
  review: {
    title: "Send the review email?",
    body: "Emails the customer a link to leave a review for this booking.",
    confirmLabel: "Send email",
  },
  delete: {
    title: "Permanently delete this test booking?",
    body: "This cannot be undone and removes the calendar event too.",
    confirmLabel: "Delete",
    tone: "danger",
  },
};

/**
 * Renders the booking lifecycle action buttons + their confirm dialogs.
 * @param props - Component props.
 * @param props.id - Booking id.
 * @param props.status - Booking lifecycle status.
 * @param props.startAt - Appointment start (ISO).
 * @param props.cancelToken - Cancel/reschedule magic-link token.
 * @param props.reviewAlreadySent - Whether a review email already went out.
 * @param props.isTest - Whether this is a deletable test booking.
 * @returns The actions element.
 */
export function BookingActions({
  id,
  status,
  startAt,
  cancelToken,
  reviewAlreadySent,
  isTest,
}: BookingActionsProps): React.ReactElement {
  const router = useRouter();
  const actions = useBookingActions();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  // Stable "now" so the past-booking check doesn't trip react-hooks/purity.
  const [renderedAt] = useState(() => Date.now());

  const isCancelled = status === "cancelled";
  const isConfirmed = status === "confirmed";
  const isCompleted = status === "completed";
  const isPast = new Date(startAt).getTime() < renderedAt;
  const isFuture = !isPast;

  /**
   * Runs the mutation for the confirmed action, then refreshes (or, for delete,
   * navigates back to the list). Closes the dialog either way.
   * @param kind - Which action was confirmed.
   */
  async function run(kind: ConfirmKind): Promise<void> {
    setBusy(true);
    const result = await (async () => {
      switch (kind) {
        case "complete":
          return actions.completeBooking(id);
        case "noshow":
          return actions.markNoShow(id);
        case "cancel-operator":
          return actions.cancelBooking(id, "operator");
        case "cancel-onbehalf":
          return actions.cancelBooking(id, "on-behalf");
        case "review":
          return actions.resendReview(id, reviewAlreadySent);
        case "delete":
          return actions.deleteBooking(id);
      }
    })();
    setBusy(false);
    setConfirm(null);
    if (!result.ok) return;
    if (kind === "delete") {
      router.push("/admin/bookings");
    } else {
      router.refresh();
    }
  }

  const copy = confirm ? CONFIRM_COPY[confirm] : null;

  return (
    <>
      <div className="flex flex-col gap-2">
        {isConfirmed && (
          <AdminButton variant="secondary" onClick={() => setConfirm("complete")} disabled={busy}>
            Mark completed
          </AdminButton>
        )}
        {isConfirmed && isPast && (
          <AdminButton variant="secondary" onClick={() => setConfirm("noshow")} disabled={busy}>
            Mark no-show
          </AdminButton>
        )}
        {(isConfirmed || isCompleted) && (
          <AdminButton variant="secondary" onClick={() => setConfirm("review")} disabled={busy}>
            {reviewAlreadySent ? "Resend review email" : "Send review email"}
          </AdminButton>
        )}
        {!isCancelled && isFuture && (
          <AdminButton
            variant="secondary"
            href={`/booking/edit?token=${cancelToken}`}
            prefetch={false}
          >
            Reschedule ↗
          </AdminButton>
        )}
        {!isCancelled && (
          <>
            <AdminButton
              variant="secondary"
              onClick={() => setConfirm("cancel-operator")}
              disabled={busy}
            >
              Cancel - my call
            </AdminButton>
            <AdminButton
              variant="danger"
              onClick={() => setConfirm("cancel-onbehalf")}
              disabled={busy}
            >
              Cancel - for customer
            </AdminButton>
          </>
        )}
        {isTest && (
          <AdminButton variant="danger" onClick={() => setConfirm("delete")} disabled={busy}>
            Delete booking
          </AdminButton>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={copy?.title ?? ""}
        body={copy?.body}
        confirmLabel={copy?.confirmLabel ?? "Confirm"}
        tone={copy?.tone}
        busy={busy}
        onConfirm={() => confirm && void run(confirm)}
        onCancel={() => !busy && setConfirm(null)}
      />
    </>
  );
}
