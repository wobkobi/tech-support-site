"use client";
// src/features/admin/components/BlockDayButton.tsx
/**
 * @description Toggles an all-day "Busy" event on the booking calendar for a
 * given NZ date. Two visual variants: a compact icon used in the week-grid day
 * header, and a full-width labelled button used by the mobile day-agenda view.
 */

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaBan, FaCircleCheck } from "react-icons/fa6";

// Serialize block/unblock writes across ALL day buttons. The block/unblock routes
// read the current blocks then patch/delete to auto-merge or trim - two requests
// running at once race that read-modify-write and can drop a block (e.g. blocking
// Wed-Sun rapidly left Wed + Thu unblocked). A shared promise chain makes each
// request wait for the previous to commit, so every merge sees the latest state.
// The optimistic UI still updates instantly per click; only the network write queues.
let blockWriteQueue: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` after all previously-queued block writes have settled.
 * @param task - The network write to run once it's this request's turn.
 * @returns The task's result.
 */
function enqueueBlockWrite<T>(task: () => Promise<T>): Promise<T> {
  const result = blockWriteQueue.then(task, task);
  // Keep the chain alive regardless of individual success/failure.
  blockWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export interface BlockDayButtonProps {
  dateKey: string;
  busyEventId: string | null;
  /**
   * Effective blocked state from the parent (override-aware). Lets a just-clicked
   * day show blocked/free instantly even before the real event syncs. Falls back
   * to `busyEventId != null` when omitted.
   */
  blocked?: boolean;
  hasBookings: boolean;
  /** Day is >18h in the past - block/unblock is locked (server enforces it too). */
  locked?: boolean;
  /** Whether THIS day's request is in flight (disables only this day, not others). */
  pending: boolean;
  /** Marks this day's request as started (true) or finished (false). */
  onPending: (dateKey: string, pending: boolean) => void;
  onChanged: () => void;
  /**
   * Optimistic state change, fired the moment the operator confirms - BEFORE the
   * Google call - so the UI flips immediately (the booking calendar is eventually
   * consistent and the round-trip takes a second or two). The parent applies it;
   * this button reverts by re-firing the old value if the request fails. `blocked`
   * is the intended new state (true = now blocked, false = now free).
   */
  onOptimisticChange?: (dateKey: string, blocked: boolean) => void;
  /** "icon" = compact 24px button for grid headers, "full" = labelled button. */
  variant?: "icon" | "full";
}

/**
 * Block/unblock-day toggle. Renders nothing for a day that can't be toggled:
 * more than 18h in the past, or a free day that already has a booking (a full-day
 * Busy would bury the appointment).
 * @param props - Component props.
 * @param props.dateKey - NZ YYYY-MM-DD for the target day.
 * @param props.busyEventId - Existing all-day event id, or null.
 * @param props.blocked - Effective blocked state (override-aware) from the parent.
 * @param props.hasBookings - True when timed bookings exist on the day.
 * @param props.locked - True when the day is >18h in the past (button hidden).
 * @param props.pending - Whether this day's request is in flight.
 * @param props.onPending - Marks this day's request started/finished.
 * @param props.onChanged - Called after a successful change.
 * @param props.onOptimisticChange - Optimistic state hint fired on click.
 * @param props.variant - Visual variant; defaults to "icon".
 * @returns The button, or null when the day is hidden (past / has a booking).
 */
export function BlockDayButton({
  dateKey,
  busyEventId,
  blocked,
  hasBookings,
  locked,
  pending,
  onPending,
  onChanged,
  onOptimisticChange,
  variant = "icon",
}: BlockDayButtonProps): React.ReactElement | null {
  const isBlocked = blocked ?? busyEventId != null;
  // Hide the toggle entirely for a day that can't be blocked: more than 18h in
  // the past (locked), or a free day that already has a booking (a full-day Busy
  // would bury the appointment). The routes enforce the same rules server-side.
  if (locked || (hasBookings && !isBlocked)) return null;
  // Disable only while THIS day's own request is in flight (other days stay live).
  // An optimistic-only block (shown blocked, no real event id yet - e.g. lost to a
  // merge) stays clickable; onClick clears it locally.
  const disabled = pending;
  const label = isBlocked ? "Unblock day" : "Block day with a Busy event";

  /** Sends the block/unblock request and refreshes the parent on success. */
  async function onClick(): Promise<void> {
    if (disabled) return;
    // Optimistic-only block (shows blocked but no real event synced - e.g. a block
    // that was lost to a merge): nothing on the server to unblock, so just clear
    // the local override. The next refresh reconciles.
    if (isBlocked && busyEventId == null) {
      onOptimisticChange?.(dateKey, false);
      return;
    }
    // No confirm dialog: blocking/unblocking is instant + reversible (click again),
    // so the operator can toggle several days in quick succession. Flip the UI now
    // (before the slow Google round-trip); reconcile via onChanged on success, or
    // revert to the old state if the request fails.
    onOptimisticChange?.(dateKey, !isBlocked);
    onPending(dateKey, true);
    try {
      // Queue the write so it runs only after earlier block/unblock requests
      // commit - prevents concurrent merges/trims from racing and losing blocks.
      const res = await enqueueBlockWrite(() =>
        isBlocked
          ? // Pass the clicked day so a multi-day block is trimmed/split, not wiped.
            fetch(
              `/api/admin/blocked-days/${encodeURIComponent(busyEventId!)}?date=${encodeURIComponent(dateKey)}`,
              { method: "DELETE", headers: {} },
            )
          : fetch("/api/admin/blocked-days", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dateKey }),
            }),
      );
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok !== true) {
        onOptimisticChange?.(dateKey, isBlocked); // revert
        window.alert(data.error ?? "Failed to update blocked day.");
      } else {
        onChanged();
      }
    } catch (err) {
      console.error("[BlockDayButton] request failed", err);
      onOptimisticChange?.(dateKey, isBlocked); // revert
      window.alert("Network error - try again.");
    } finally {
      onPending(dateKey, false);
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
            : "border-admin-border bg-admin-surface text-admin-text hover:bg-admin-bg",
        )}
      >
        {isBlocked ? <FaCircleCheck className="h-4 w-4" /> : <FaBan className="h-4 w-4" />}
        {isBlocked ? "Unblock day" : "Block day"}
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
        "inline-flex h-6 w-6 items-center justify-center rounded text-admin-faint transition-colors",
        "hover:bg-admin-border hover:text-admin-text disabled:cursor-not-allowed disabled:opacity-40",
        isBlocked && "text-red-500 hover:bg-red-100 hover:text-red-700",
      )}
    >
      {isBlocked ? <FaCircleCheck className="h-3 w-3" /> : <FaBan className="h-3 w-3" />}
    </button>
  );
}
