// src/shared/lib/edit-window.ts
/**
 * @description Editing window for past schedule items. An event or blocked day
 * is locked once it ended more than MAX_PAST_EDIT_HOURS ago, so stale history
 * can't be mutated by accident (block/unblock, complete/cancel/no-show, edit).
 * Enforced server-side in the mutation routes and mirrored client-side to disable
 * the controls.
 */

import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";

/** Hours after an event/day ends before it's locked from further edits. */
export const MAX_PAST_EDIT_HOURS = 18;

/**
 * Whether an event that ended at `endMs` is now locked from editing.
 * @param endMs - The event/day end, epoch ms.
 * @param nowMs - Current time, epoch ms.
 * @returns True when it ended more than {@link MAX_PAST_EDIT_HOURS} ago.
 */
export function isPastEditWindow(endMs: number, nowMs: number): boolean {
  return nowMs - endMs > MAX_PAST_EDIT_HOURS * 60 * 60 * 1000;
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
