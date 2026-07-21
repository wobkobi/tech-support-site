// src/shared/lib/edit-window.ts
/**
 * @description Editing window for past schedule items: an event or blocked day
 * is locked once it ended more than MAX_PAST_EDIT_HOURS ago, so stale history
 * can't be mutated by accident. Enforced server-side in the mutation routes
 * and mirrored client-side to disable the controls.
 */

import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";

/** Fallback hours after an event/day ends before it locks (live: scheduling.pastEditLockHours). */
export const MAX_PAST_EDIT_HOURS = 18;

/**
 * Whether an event that ended at `endMs` is now locked from editing.
 * @param endMs - The event/day end, epoch ms.
 * @param nowMs - Current time, epoch ms.
 * @param lockHours - Hours after the end before locking (defaults to the constant).
 * @returns True when it ended more than `lockHours` ago.
 */
export function isPastEditWindow(
  endMs: number,
  nowMs: number,
  lockHours: number = MAX_PAST_EDIT_HOURS,
): boolean {
  return nowMs - endMs > lockHours * 60 * 60 * 1000;
}

/**
 * Epoch ms of the END of an NZ day (its next NZ midnight). Used to age-check a
 * blocked all-day event, whose "end" is midnight after the blocked date.
 * @param dateKey - NZ YYYY-MM-DD.
 * @returns The day's end (next NZ midnight) as epoch ms.
 */
export function nzDayEndMs(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const offset = getPacificAucklandOffset(y, m, d);
  // Next NZ midnight = UTC (d+1) 00:00 shifted back by the NZ offset.
  return Date.UTC(y, m - 1, d + 1, -offset, 0, 0);
}
