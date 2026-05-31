"use client";
// src/features/admin/components/BlockDayButton.tsx
/**
 * @file BlockDayButton.tsx
 * @description Toggles an all-day "Busy" event on the booking calendar for a
 * given NZ date. Two visual variants: a compact icon used in the week-grid day
 * header, and a full-width labelled button used by the mobile day-agenda view.
 */

import type React from "react";
import { FaBan, FaCircleCheck } from "react-icons/fa6";
import { cn } from "@/shared/lib/cn";

export interface BlockDayButtonProps {
  dateKey: string;
  busyEventId: string | null;
  hasBookings: boolean;
  busyAction: string | null;
  onPending: (dateKey: string | null) => void;
  onChanged: () => void;
  /** "icon" = compact 24px button for grid headers, "full" = labelled button. */
  variant?: "icon" | "full";
}

/**
 * Block/unblock-day toggle. Disabled when timed bookings exist on the day so
 * customers can't slip through a Busy banner.
 * @param props - Component props.
 * @param props.dateKey - NZ YYYY-MM-DD for the target day.
 * @param props.busyEventId - Existing all-day event id, or null.
 * @param props.hasBookings - True when timed bookings exist on the day.
 * @param props.busyAction - Date key currently submitting (used to disable).
 * @param props.onPending - Sets the in-flight dateKey.
 * @param props.onChanged - Called after a successful change.
 * @param props.variant - Visual variant; defaults to "icon".
 * @returns Block/Unblock button element.
 */
export function BlockDayButton({
  dateKey,
  busyEventId,
  hasBookings,
  busyAction,
  onPending,
  onChanged,
  variant = "icon",
}: BlockDayButtonProps): React.ReactElement {
  const isBlocked = busyEventId != null;
  const disabled = busyAction != null || (!isBlocked && hasBookings);
  const label = isBlocked
    ? "Unblock day"
    : hasBookings
      ? "Day has bookings"
      : "Block day with a Busy event";

  /** Sends the block/unblock request and refreshes the parent on success. */
  async function onClick(): Promise<void> {
    if (disabled) return;
    const ok = window.confirm(
      isBlocked ? "Unblock this day?" : "Block this whole day with a Busy event?",
    );
    if (!ok) return;
    onPending(dateKey);
    try {
      const res = isBlocked
        ? await fetch(`/api/admin/blocked-days/${encodeURIComponent(busyEventId!)}`, {
            method: "DELETE",
            headers: {},
          })
        : await fetch("/api/admin/blocked-days", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dateKey }),
          });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true) {
        window.alert(data.error ?? "Failed to update blocked day.");
      } else {
        onChanged();
      }
    } catch (err) {
      console.error("[BlockDayButton] request failed", err);
      window.alert("Network error - try again.");
    } finally {
      onPending(null);
    }
  }

  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-50",
          isBlocked
            ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
        )}
      >
        {isBlocked ? (
          <FaCircleCheck className={cn("h-4 w-4")} />
        ) : (
          <FaBan className={cn("h-4 w-4")} />
        )}
        {isBlocked ? "Unblock day" : hasBookings ? "Day has bookings" : "Block day"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors",
        "hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40",
        isBlocked && "text-red-500 hover:bg-red-100 hover:text-red-700",
      )}
    >
      {isBlocked ? (
        <FaCircleCheck className={cn("h-3 w-3")} />
      ) : (
        <FaBan className={cn("h-3 w-3")} />
      )}
    </button>
  );
}
