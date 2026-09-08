// src/shared/lib/quiet-hours.ts
// Decides whether a customer-facing email may leave now or has to wait for
// morning. The window is stored as two NZ hours and normally wraps midnight
// (21:00 > 07:00), so "inside the window" is two arcs of the clock, not one.

import { nzDateParts, nzMinuteOfDay, nzWallClockUtc } from "@/shared/lib/timezone-utils";

/** Quiet-hours window, mirroring the three comms settings fields. */
export interface QuietHours {
  /** Master switch - false sends everything immediately. */
  enabled: boolean;
  /** NZ hour the window opens (0-23). */
  startHour: number;
  /** NZ hour it closes again (0-23). Equal to `startHour` means no window. */
  endHour: number;
}

/**
 * Works out when an email triggered now is allowed to go out.
 * @param quiet - The live quiet-hours window.
 * @param now - When the send was triggered (defaults to the current instant).
 * @returns The instant to hold the email until, or null to send straight away.
 */
export function nextSendTime(quiet: QuietHours, now: Date = new Date()): Date | null {
  if (!quiet.enabled || quiet.startHour === quiet.endHour) return null;

  const minute = nzMinuteOfDay(now);
  const start = quiet.startHour * 60;
  const end = quiet.endHour * 60;
  // 21:00 > 07:00 spans midnight; 01:00 < 05:00 sits inside one day.
  const wraps = start > end;
  const inside = wraps ? minute >= start || minute < end : minute >= start && minute < end;
  if (!inside) return null;

  // Release at the closing hour - tomorrow's when caught in the evening leg of a
  // wrapping window, otherwise later today. nzWallClockUtc wraps the day over
  // month ends and re-reads the offset, so this survives a DST switch overnight.
  const [year, month, day] = nzDateParts(now);
  const nextDay = wraps && minute >= start;
  return nzWallClockUtc(year, month, day + (nextDay ? 1 : 0), quiet.endHour);
}
