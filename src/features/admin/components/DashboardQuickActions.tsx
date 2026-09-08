"use client";
// src/features/admin/components/DashboardQuickActions.tsx
/**
 * @description Quick-action panels shown on the admin dashboard: send a review
 * link to a past client, or clear the past-confirmed bookings. Completing offers
 * both doors - with the review email or without - so neither needs a dialog.
 */

import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
import {
  SendReviewLinkForm,
  type ContactSuggestion,
} from "@/features/reviews/components/admin/SendReviewLinkForm";
import { formatDateShort } from "@/shared/lib/date-format";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { FaCheck } from "react-icons/fa6";

/**
 * A past confirmed booking that is ready to be completed.
 */
interface PastBookingRow {
  /** Booking database ID */
  id: string;
  /** Customer name */
  name: string;
  /** Customer email - null for phone-only bookings */
  email: string | null;
  /** Start time as ISO string */
  startAt: string;
  /** ISO string of when review was last sent, or null */
  reviewSentAt: string | null;
}

/**
 * Props for DashboardQuickActions.
 */
interface DashboardQuickActionsProps {
  /** Confirmed bookings with a start time in the past */
  pastConfirmedBookings: PastBookingRow[];
  /** Contacts that have never received a review link */
  contactSuggestions: ContactSuggestion[];
}

/**
 * Quick-action panels for the admin dashboard.
 * @param props - Component props.
 * @param props.pastConfirmedBookings - Past confirmed bookings awaiting completion.
 * @param props.contactSuggestions - Contacts that have never received a review link.
 * @returns Dashboard quick actions element.
 */
export function DashboardQuickActions({
  pastConfirmedBookings: initial,
  contactSuggestions,
}: DashboardQuickActionsProps): React.ReactElement {
  const router = useRouter();
  const actions = useBookingActions();
  const [bookings, setBookings] = useState<PastBookingRow[]>(initial);
  const [completing, setCompleting] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Marks a booking completed. Sending the review request is the caller's call:
   * the row offers a button either way, which is why this list has no confirm
   * dialog. The send itself is atomically guarded against the cron, so a
   * completed booking can never be emailed twice.
   * @param id - Booking ID to complete.
   * @param sendReview - Whether to send the review-request email with it.
   */
  async function complete(id: string, sendReview: boolean): Promise<void> {
    setCompleting(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    // Toasts (success and failure alike) come from the shared hook; the inline
    // message is what keeps a failed row explaining itself after one fades.
    const result = await actions.completeBooking(id, sendReview);
    setCompleting(null);
    if (!result.ok) {
      setErrors((prev) => ({ ...prev, [id]: result.error ?? "Something went wrong." }));
      return;
    }

    setDone((prev) => new Set(prev).add(id));
    // Re-render the server components so the dashboard stat cards (Confirmed
    // bookings, Pending reviews) reflect the completion.
    router.refresh();
    // Remove from list after a short delay so the user sees the success state
    setTimeout(() => {
      setBookings((prev) => prev.filter((b) => b.id !== id));
      setDone((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 1800);
  }

  /**
   * Wraps complete to return void for use as an event handler.
   * @param id - Booking ID.
   * @param sendReview - Whether to send the review-request email.
   */
  function handleComplete(id: string, sendReview: boolean): void {
    void complete(id, sendReview);
  }

  return (
    <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Send review link */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Send review link</h2>
        <SendReviewLinkForm contactSuggestions={contactSuggestions} defaultOpen />
      </div>

      {/* Complete events */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-700">
            Complete events
            {bookings.length > 0 && (
              <span className="ml-2 rounded-full bg-coquelicot-500/15 px-2 py-0.5 text-xs font-semibold text-coquelicot-600">
                {bookings.length}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Past confirmed bookings - complete them, with or without the review email
          </p>
        </div>

        {bookings.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">No events waiting to be completed.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {bookings.map((b) => {
              const isDone = done.has(b.id);
              const isRunning = completing === b.id;
              const err = errors[b.id];
              return (
                <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">{b.name}</p>
                    <p className="text-xs text-slate-400">
                      {formatDateShort(b.startAt)}
                      {b.email ? ` · ${b.email}` : " · no email"}
                    </p>
                    {err && <p className="text-xs text-coquelicot-600">{err}</p>}
                  </div>
                  {isDone ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-moonstone-400">
                      Done
                      <FaCheck className="h-3 w-3" aria-hidden />
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={isRunning}
                        onClick={() => handleComplete(b.id, b.email !== null)}
                        className="rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-russian-violet/90 disabled:opacity-50"
                      >
                        {isRunning
                          ? "Working…"
                          : b.email
                            ? "Complete + send review"
                            : "Mark complete"}
                      </button>
                      {/* Only worth offering where there is an email to withhold. */}
                      {b.email && (
                        <button
                          type="button"
                          disabled={isRunning}
                          onClick={() => handleComplete(b.id, false)}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                        >
                          Complete only
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
