"use client";
// src/features/booking/hooks/use-booking-actions.ts
/**
 * @description Shared booking mutation wrappers around the admin bookings API -
 * PATCH edits, mark-completed, cancel (operator / on-behalf), no-show, delete,
 * and resend-review - each bundled with success/error toasts. The bookings list,
 * the booking detail page, and the schedule's EventActionSheet all mutate
 * bookings through this hook so the endpoints, wording, and error handling live
 * in one place. Every wrapper resolves to a {@link BookingActionResult}; the
 * caller owns busy state and any optimistic update or router refresh.
 */

import { useToast } from "@/features/admin/components/ui/Toast";
import { apiFetch } from "@/shared/lib/api-client";
import { useCallback, useMemo } from "react";

/** Outcome of a booking mutation. */
interface BookingActionResult {
  /** True when the request succeeded. */
  ok: boolean;
  /** Set by the complete path when the review-request email actually went out. */
  reviewSent?: boolean;
  /** Error message when {@link BookingActionResult.ok} is false. */
  error?: string;
}

/** Cancellation policy mode - operator (no fee) vs on-behalf (customer fee rules). */
type CancelMode = "operator" | "on-behalf";

/** The wrappers returned by {@link useBookingActions}. */
export interface UseBookingActions {
  /** Sparse PATCH; toasts `successMsg` on success when provided. */
  patchBooking: (
    id: string,
    body: Record<string, unknown>,
    successMsg?: string,
  ) => Promise<BookingActionResult>;
  /** Marks the booking completed; toast reflects whether a review email was sent. */
  completeBooking: (id: string) => Promise<BookingActionResult>;
  /** Cancels the booking; operator = no fee, on-behalf = customer fee rules. */
  cancelBooking: (id: string, mode: CancelMode) => Promise<BookingActionResult>;
  /** Flags a no-show; drafts the late-cancellation invoice (callout + travel). */
  markNoShow: (id: string) => Promise<BookingActionResult>;
  /** Permanently deletes the booking and its calendar event. */
  deleteBooking: (id: string) => Promise<BookingActionResult>;
  /** Sends (or re-sends) the review-request email; `alreadySent` tunes the toast. */
  resendReview: (id: string, alreadySent?: boolean) => Promise<BookingActionResult>;
}

/**
 * Booking mutation wrappers with built-in toasts. Consumed by the bookings list,
 * the booking detail page, and the schedule action sheet.
 * @returns The {@link UseBookingActions} wrappers (stable across renders).
 */
export function useBookingActions(): UseBookingActions {
  const { toast } = useToast();

  const patchBooking = useCallback<UseBookingActions["patchBooking"]>(
    async (id, body, successMsg) => {
      const res = await apiFetch<{ reviewSent?: boolean }>(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        json: body,
      });
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        return { ok: false, error: res.error };
      }
      if (successMsg) toast(successMsg, { tone: "success" });
      return { ok: true, reviewSent: res.data.reviewSent };
    },
    [toast],
  );

  const completeBooking = useCallback<UseBookingActions["completeBooking"]>(
    async (id) => {
      // No successMsg here: the toast depends on the review-send outcome.
      const result = await patchBooking(id, { status: "completed" });
      if (result.ok) {
        toast(result.reviewSent ? "Marked completed - review email sent." : "Marked completed.", {
          tone: "success",
        });
      }
      return result;
    },
    [patchBooking, toast],
  );

  const cancelBooking = useCallback<UseBookingActions["cancelBooking"]>(
    (id, mode) =>
      patchBooking(
        id,
        { status: "cancelled", cancelMode: mode },
        mode === "operator"
          ? "Booking cancelled - no fee charged."
          : "Booking cancelled for the customer - standard fee rules applied.",
      ),
    [patchBooking],
  );

  const markNoShow = useCallback<UseBookingActions["markNoShow"]>(
    (id) => patchBooking(id, { markNoShow: true }, "Marked no-show - draft invoice created."),
    [patchBooking],
  );

  const deleteBooking = useCallback<UseBookingActions["deleteBooking"]>(
    async (id) => {
      const res = await apiFetch(`/api/admin/bookings/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        return { ok: false, error: res.error };
      }
      toast("Booking deleted.", { tone: "success" });
      return { ok: true };
    },
    [toast],
  );

  const resendReview = useCallback<UseBookingActions["resendReview"]>(
    async (id, alreadySent) => {
      const res = await apiFetch(`/api/admin/bookings/${id}/resend-review`, { method: "POST" });
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        return { ok: false, error: res.error };
      }
      toast(alreadySent ? "Review email re-sent." : "Review email sent.", { tone: "success" });
      return { ok: true };
    },
    [toast],
  );

  return useMemo(
    () => ({
      patchBooking,
      completeBooking,
      cancelBooking,
      markNoShow,
      deleteBooking,
      resendReview,
    }),
    [patchBooking, completeBooking, cancelBooking, markNoShow, deleteBooking, resendReview],
  );
}
