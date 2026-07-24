"use client";
// src/features/admin/components/DashboardQuickActions.tsx
/**
 * @description Quick-action panels shown on the admin dashboard:
 * send a review link to a past client, or mark a completed event and send its review.
 */

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
  const [bookings, setBookings] = useState<PastBookingRow[]>(initial);
  const [completing, setCompleting] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Marks a booking completed. The PATCH endpoint automatically sends the
   * review request email if one has not already been sent (atomically guarded
   * against the cron, so no double-send risk).
   * @param id - Booking ID to complete.
   */
  async function completeAndSend(id: string): Promise<void> {
    setCompleting(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const patchRes = await fetch(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!patchRes.ok) {
        const d = (await patchRes.json()) as { error?: string };
        throw new Error(d.error ?? "Failed to mark completed.");
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
   */
  function handleComplete(id: string): void {
    void completeAndSend(id);
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
            Past confirmed bookings - mark complete and send review
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
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => handleComplete(b.id)}
                      className="shrink-0 rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-russian-violet/90 disabled:opacity-50"
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
