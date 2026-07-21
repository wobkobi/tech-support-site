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

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Reads an `{ error }` body, falling back when the response isn't JSON.
 * @param res - The failed response.
 * @param fallback - Message to use when no error field is present.
 * @returns The error message.
 */
async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
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
      try {
        const res = await fetch(`/api/admin/bookings/${id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const error = await readError(res, "Action failed.");
          toast(error, { tone: "error" });
          return { ok: false, error };
        }
        const data = (await res.json().catch(() => ({}))) as { reviewSent?: boolean };
        if (successMsg) toast(successMsg, { tone: "success" });
        return { ok: true, reviewSent: data.reviewSent };
      } catch {
        const error = "Network error - try again.";
        toast(error, { tone: "error" });
        return { ok: false, error };
      }
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
      try {
        const res = await fetch(`/api/admin/bookings/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const error = await readError(res, "Delete failed.");
          toast(error, { tone: "error" });
          return { ok: false, error };
        }
        toast("Booking deleted.", { tone: "success" });
        return { ok: true };
      } catch {
        const error = "Network error - try again.";
        toast(error, { tone: "error" });
        return { ok: false, error };
      }
    },
    [toast],
  );

  const resendReview = useCallback<UseBookingActions["resendReview"]>(
    async (id, alreadySent) => {
      try {
        const res = await fetch(`/api/admin/bookings/${id}/resend-review`, { method: "POST" });
        if (!res.ok) {
          const error = await readError(res, "Failed to send.");
          toast(error, { tone: "error" });
          return { ok: false, error };
        }
        toast(alreadySent ? "Review email re-sent." : "Review email sent.", { tone: "success" });
        return { ok: true };
      } catch {
        const error = "Network error - try again.";
        toast(error, { tone: "error" });
        return { ok: false, error };
      }
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
