// src/features/booking/lib/booking-reminder.ts
// When the booking reminder cron picks a booking up, and how the reminder names the day.

import { addDaysToDateKey, NZ_TZ, nzDateKey } from "@/shared/lib/timezone-utils";

const HOUR_MS = 3_600_000;

/**
 * Share of the reminder lead time that has to pass between booking and reminder. A booking made
 * closer to the start than that has only just had its confirmation, so a reminder adds nothing.
 */
export const REMINDER_MIN_GAP_SHARE = 0.5;

/** Which bookings a reminder run takes, as bounds on startAt and createdAt. */
export interface ReminderWindow {
  /** Start must be after this: still far enough out for free cancellation. */
  startAfter: Date;
  /** Start must be at or before this: inside the reminder lead time. */
  startBy: Date;
  /** Booking must have been made at or before this, so the confirmation isn't fresh. */
  bookedBy: Date;
}

/**
 * Bounds for one reminder run. With a 24h lead and 12h free notice, a booking made 20h out gets
 * no reminder (its 12h gap ends 8h out, past the 13h floor), while one made 30h out gets it 18h
 * out. A booking that clears the gap while still in the window is picked up on a later run; one
 * that never clears it relies on its confirmation.
 * @param now - When the run started.
 * @param settings - Live settings the window depends on.
 * @param settings.leadHours - comms.reminderLeadHours.
 * @param settings.freeNoticeHours - The in-person free-cancellation window.
 * @returns The startAt and createdAt bounds.
 */
export function reminderWindow(
  now: Date,
  settings: { leadHours: number; freeNoticeHours: number },
): ReminderWindow {
  const t = now.getTime();
  return {
    startAfter: new Date(t + (settings.freeNoticeHours + 1) * HOUR_MS),
    startBy: new Date(t + settings.leadHours * HOUR_MS),
    bookedBy: new Date(t - settings.leadHours * REMINDER_MIN_GAP_SHARE * HOUR_MS),
  };
}

/**
 * Whether the gap after the confirmation has passed for this run. The query's `bookedBy` bound
 * counts from when the booking was made, but a confirmation held overnight by quiet hours lands
 * later, so without this a 22:00 booking's reminder could follow its 07:00 confirmation by hours.
 * @param confirmationLandedAt - When the confirmation reached the customer (after any hold).
 * @param window - This run's bounds from {@link reminderWindow}.
 * @returns True when the reminder may go this run.
 */
export function reminderGapCleared(confirmationLandedAt: Date, window: ReminderWindow): boolean {
  return confirmationLandedAt.getTime() <= window.bookedBy.getTime();
}

/**
 * Whether a confirmation sent now leaves no run where {@link reminderWindow} would still take
 * the booking, i.e. the gap only clears after the free-cancel floor. A customer's reschedule
 * stamps the reminder done in that case, as a fresh booking would never get one.
 * @param startAt - The appointment start.
 * @param confirmedAt - When the confirmation (or reschedule notice) went out.
 * @param settings - Live settings the window depends on.
 * @param settings.leadHours - comms.reminderLeadHours.
 * @param settings.freeNoticeHours - The in-person free-cancellation window.
 * @returns True when no separate reminder should follow.
 */
export function confirmationCoversReminder(
  startAt: Date,
  confirmedAt: Date,
  settings: { leadHours: number; freeNoticeHours: number },
): boolean {
  const gapEnds = confirmedAt.getTime() + settings.leadHours * REMINDER_MIN_GAP_SHARE * HOUR_MS;
  return gapEnds >= startAt.getTime() - (settings.freeNoticeHours + 1) * HOUR_MS;
}

/**
 * How a reminder names the appointment's day, judged from the NZ date it actually lands on, so a
 * reminder held overnight by quiet hours says "today" rather than "tomorrow".
 * @param startAt - The appointment start.
 * @param sendAt - When the email goes out (after any quiet-hours hold).
 * @returns "today", "tomorrow", "on Friday" within the week, or "on Friday 27 November" beyond.
 */
export function reminderDayPhrase(startAt: Date, sendAt: Date): string {
  const startKey = nzDateKey(startAt);
  const sendKey = nzDateKey(sendAt);
  if (startKey <= sendKey) return "today";
  if (startKey === addDaysToDateKey(sendKey, 1)) return "tomorrow";
  // Six days on is still unambiguous by weekday; a week or more needs the date.
  const withinWeek = startKey <= addDaysToDateKey(sendKey, 6);
  const label = new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    weekday: "long",
    ...(withinWeek ? {} : { day: "numeric", month: "long" }),
  })
    .format(startAt)
    .replace(",", "");
  return `on ${label}`;
}
