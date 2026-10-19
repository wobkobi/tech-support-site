// src/shared/lib/edit-window.ts
// Past schedule items lock MAX_PAST_EDIT_HOURS after they end. Enforced server-side, mirrored
// client-side.

import { dateKeyParts, getPacificAucklandOffset } from "@/shared/lib/timezone-utils";

/** Fallback hours after an event/day ends before it locks (live: scheduling.pastEditLockHours). */
const MAX_PAST_EDIT_HOURS = 18;

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
 * Epoch ms of the end of an NZ day (next NZ midnight), for aging blocked all-day events.
 * @param dateKey - NZ YYYY-MM-DD.
 * @returns The day's end (next NZ midnight) as epoch ms.
 */
export function nzDayEndMs(dateKey: string): number {
  const [y, m, d] = dateKeyParts(dateKey);
  const offset = getPacificAucklandOffset(y, m, d);
  // Next NZ midnight = UTC (d+1) 00:00 shifted back by the NZ offset.
  return Date.UTC(y, m - 1, d + 1, -offset, 0, 0);
}
