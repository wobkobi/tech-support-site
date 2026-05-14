"use client";
// src/features/admin/components/DashboardQuickActions.tsx
/**
 * @file DashboardQuickActions.tsx
 * @description Quick-action panels shown on the admin dashboard:
 * send a review link to a past client, or mark a completed event and send its review.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import {
  SendReviewLinkForm,
  type ContactSuggestion,
} from "@/features/reviews/components/admin/SendReviewLinkForm";
import { formatDateShort } from "@/shared/lib/date-format";

/**
 * A past confirmed booking that is ready to be completed.
 */
export interface PastBookingRow {
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
  /** Admin token for API calls */
  token: string;
  /** Confirmed bookings with a start time in the past */
  pastConfirmedBookings: PastBookingRow[];
  /** Contacts that have never received a review link */
  contactSuggestions: ContactSuggestion[];
}

/**
 * Quick-action panels for the admin dashboard.
 * @param props - Component props.
 * @param props.token - Admin token.
 * @param props.pastConfirmedBookings - Past confirmed bookings awaiting completion.
 * @param props.contactSuggestions - Contacts that have never received a review link.
 * @returns Dashboard quick actions element.
 */
export function DashboardQuickActions({
  token,
  pastConfirmedBookings: initial,
  contactSuggestions,
}: DashboardQuickActionsProps): React.ReactElement {
  const [bookings, setBookings] = useState<PastBookingRow[]>(initial);
  const [completing, setCompleting] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Marks a booking completed and sends its review request email in one action.
   * @param id - Booking ID to complete.
   * @param hasEmail - Whether the booking has an email address for the review.
   */
  async function completeAndSend(id: string, hasEmail: boolean): Promise<void> {
    setCompleting(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      // 1. Mark completed
      const patchRes = await fetch(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-secret": token },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!patchRes.ok) {
        const d = (await patchRes.json()) as { error?: string };
        throw new Error(d.error ?? "Failed to mark completed.");
      }

      // 2. Send review email if possible
      if (hasEmail) {
        const reviewRes = await fetch(`/api/admin/bookings/${id}/resend-review`, {
          method: "POST",
          headers: { "x-admin-secret": token },
        });
        if (!reviewRes.ok) {
          const d = (await reviewRes.json()) as { error?: string };
          throw new Error(d.error ?? "Marked complete but failed to send review.");
        }
      }

      setDone((prev) => new Set(prev).add(id));
      // Remove from list after a short delay so the user sees the success state
      setTimeout(() => {
        setBookings((prev) => prev.filter((b) => b.id !== id));
        setDone((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 1800);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Something went wrong.",
      }));
    } finally {
      setCompleting(null);
    }
  }

  /**
   * Wraps completeAndSend to return void for use as an event handler.
   * @param id - Booking ID.
   * @param hasEmail - Whether the booking has an email.
   */
  function handleComplete(id: string, hasEmail: boolean): void {
    void completeAndSend(id, hasEmail);
  }

  return (
    <div className={cn("mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2")}>
      {/* Send review link */}
      <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
        <h2 className={cn("mb-4 text-sm font-semibold text-slate-700")}>Send review link</h2>
        <SendReviewLinkForm token={token} contactSuggestions={contactSuggestions} defaultOpen />
      </div>

      {/* Complete events */}
      <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm")}>
        <div className={cn("border-b border-slate-100 px-5 py-4")}>
          <h2 className={cn("text-sm font-semibold text-slate-700")}>
            Complete events
            {bookings.length > 0 && (
              <span
                className={cn(
                  "bg-coquelicot-500/15 text-coquelicot-400 ml-2 rounded-full px-2 py-0.5 text-xs font-semibold",
                )}
              >
                {bookings.length}
              </span>
            )}
          </h2>
          <p className={cn("mt-0.5 text-xs text-slate-400")}>
            Past confirmed bookings - mark complete and send review
          </p>
        </div>

        {bookings.length === 0 ? (
          <p className={cn("px-5 py-6 text-sm text-slate-400")}>
            No events waiting to be completed.
          </p>
        ) : (
          <ul className={cn("divide-y divide-slate-100")}>
            {bookings.map((b) => {
              const isDone = done.has(b.id);
              const isRunning = completing === b.id;
              const err = errors[b.id];
              return (
                <li key={b.id} className={cn("flex items-center justify-between gap-3 px-5 py-3")}>
                  <div className={cn("min-w-0")}>
                    <p className={cn("truncate text-sm font-medium text-slate-700")}>{b.name}</p>
                    <p className={cn("text-xs text-slate-400")}>
                      {formatDateShort(b.startAt)}
                      {b.email ? ` · ${b.email}` : " · no email"}
                    </p>
                    {err && <p className={cn("text-coquelicot-400 text-xs")}>{err}</p>}
                  </div>
                  {isDone ? (
                    <span className={cn("text-moonstone-600 shrink-0 text-xs font-semibold")}>
                      Done ✓
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => handleComplete(b.id, !!b.email)}
                      className={cn(
                        "bg-russian-violet hover:bg-russian-violet/90 shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50",
                      )}
                    >
                      {isRunning
                        ? "Working…"
                        : b.email
                          ? "Complete + send review"
                          : "Mark complete"}
                    </button>
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
