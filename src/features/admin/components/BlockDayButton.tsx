"use client";
// src/features/admin/components/BlockDayButton.tsx
// Toggles an all-day "Busy" event on the booking calendar for a given NZ date.

import { useToast } from "@/features/admin/components/ui/Toast";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaBan, FaCircleCheck } from "react-icons/fa6";

// Serialise block/unblock writes across ALL day buttons: the routes read-modify-write the
// blocks, so two in flight drop blocks. Only the network write queues, not the UI.
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

interface BlockDayButtonProps {
  dateKey: string;
  busyEventId: string | null;
  /** Override-aware blocked state from the parent; falls back to `busyEventId != null`. */
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
   * Optimistic new state, fired before the slow Google call; re-fired with the old
   * value to revert on failure.
   */
  onOptimisticChange?: (dateKey: string, blocked: boolean) => void;
  /** "icon" = compact 24px button for grid headers, "full" = labelled button. */
  variant?: "icon" | "full";
}

/**
 * Block/unblock-day toggle. Renders nothing for a day >18h past, or a free day
 * with a booking (a full-day Busy would bury it).
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
  // Above the early return below - hooks must run on every render.
  const { toast } = useToast();
  const isBlocked = blocked ?? busyEventId != null;
  // The routes enforce the same rules server-side.
  if (locked || (hasBookings && !isBlocked)) return null;
  // Disable only while THIS day's request is in flight; other days stay live.
  const disabled = pending;
  const label = isBlocked ? "Unblock day" : "Block day with a Busy event";

  /** Sends the block/unblock request and refreshes the parent on success. */
  async function onClick(): Promise<void> {
    if (disabled) return;
    // Optimistic-only block (no real event synced): just clear the local override.
    if (isBlocked && busyEventId == null) {
      onOptimisticChange?.(dateKey, false);
      return;
    }
    // No confirm dialog: blocking is reversible, so several days toggle quickly.
    onOptimisticChange?.(dateKey, !isBlocked);
    onPending(dateKey, true);
    try {
      const res = await enqueueBlockWrite(() =>
        isBlocked
          ? // Pass the clicked day so a multi-day block is trimmed/split, not wiped.
            fetch(
              `/api/admin/blocked-days/${encodeURIComponent(busyEventId!)}?date=${encodeURIComponent(dateKey)}`,
              { method: "DELETE" },
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
        toast(data.error ?? "Couldn't update that blocked day.", { tone: "error" });
      } else {
        onChanged();
      }
    } catch (err) {
      console.error("[BlockDayButton] request failed", err);
      onOptimisticChange?.(dateKey, isBlocked); // revert
      toast("Network error - the day wasn't changed.", { tone: "error" });
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
