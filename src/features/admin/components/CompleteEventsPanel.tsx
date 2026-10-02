"use client";
// src/features/admin/components/CompleteEventsPanel.tsx
// Dashboard panel listing past confirmed bookings still to be completed. Completing only
// changes the status; the review request goes out with the invoice email.

import { useBookingActions } from "@/features/booking/hooks/use-booking-actions";
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
 * Props for {@link CompleteEventsPanel}.
 */
interface CompleteEventsPanelProps {
  /** Confirmed bookings with a start time in the past */
  pastConfirmedBookings: PastBookingRow[];
}

/**
 * Past confirmed bookings, each with buttons to complete it with or without the
 * review email.
 * @param props - Component props.
 * @param props.pastConfirmedBookings - Past confirmed bookings awaiting completion.
 * @returns The panel element.
 */
export function CompleteEventsPanel({
  pastConfirmedBookings: initial,
}: CompleteEventsPanelProps): React.ReactElement {
  const router = useRouter();
  const actions = useBookingActions();
  const [bookings, setBookings] = useState<PastBookingRow[]>(initial);
  const [completing, setCompleting] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Marks a booking completed. No confirm dialog: it only changes the status.
   * @param id - Booking ID to complete.
   */
  async function complete(id: string): Promise<void> {
    setCompleting(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    // Toasts (success and failure alike) come from the shared hook; the inline
    // message is what keeps a failed row explaining itself after one fades.
    const result = await actions.completeBooking(id);
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
   */
  function handleComplete(id: string): void {
    void complete(id);
  }

  return (
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
        <p className="mt-0.5 text-sm text-slate-400">
          Past confirmed bookings waiting to be marked complete
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
                  {err && <p className="text-sm text-coquelicot-600">{err}</p>}
                </div>
                {isDone ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-moonstone-700">
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
                    {isRunning ? "Working…" : "Mark complete"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
