"use client";
// src/features/booking/hooks/use-booking-actions.ts
/**
 * @description Shared booking mutation wrappers around the admin bookings API -
 * PATCH edits, mark-completed, cancel (operator / on-behalf), no-show, delete,
 * resend-review, and time edits - each bundled with success/error toasts. The bookings list,
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

/** Outcome of a time edit - {@link BookingActionResult} plus its own failure mode. */
interface BookingTimesResult extends BookingActionResult {
  /**
   * Set when the new window overlaps another booking or calendar event. The
   * caller is expected to show it and offer to save anyway; no toast is raised
   * for this case, unlike every other failure.
   */
  conflict?: string;
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
  /** Moves a booking's start/end; `force` saves through an overlap warning. */
  updateBookingTimes: (
    id: string,
    times: { startAt: string; endAt: string; force?: boolean },
  ) => Promise<BookingTimesResult>;
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

  const updateBookingTimes = useCallback<UseBookingActions["updateBookingTimes"]>(
    async (id, times) => {
      const res = await apiFetch<{ notified?: boolean; calendarWarning?: string }>(
        `/api/admin/bookings/${id}`,
        { method: "PATCH", json: times },
      );
      if (!res.ok) {
        // 409 on an unforced save is the overlap warning, which belongs in the
        // caller's confirm dialog rather than a toast that dismisses itself.
        if (res.status === 409 && !times.force) {
          return { ok: false, error: res.error, conflict: res.error };
        }
        toast(res.error, { tone: "error" });
        return { ok: false, error: res.error };
      }
      toast(res.data.notified ? "Times updated - customer notified." : "Times updated.", {
        tone: "success",
      });
      if (res.data.calendarWarning) {
        // Held longer than the default: this one needs acting on in Google.
        toast(res.data.calendarWarning, { tone: "warning", duration: 10_000 });
      }
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
      updateBookingTimes,
    }),
    [
      patchBooking,
      completeBooking,
      cancelBooking,
      markNoShow,
      deleteBooking,
      resendReview,
      updateBookingTimes,
    ],
  );
}
