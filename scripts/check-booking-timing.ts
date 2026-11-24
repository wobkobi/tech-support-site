// scripts/check-booking-timing.ts
// Booking timing rules: the free cancel grace after booking, the booking form's short-notice
// note, which failed event moves fall back to a new invite, which bookings get a separate
// reminder, and the reminder's day word at send time.
// Run with: npm test -- booking-timing

import { shortNoticeCancelNote } from "@/features/booking/lib/booking-form";
import {
  confirmationCoversReminder,
  reminderDayPhrase,
  reminderGapCleared,
  reminderWindow,
} from "@/features/booking/lib/booking-reminder";
import { assessCancellation, CANCELLATION } from "@/features/business/lib/pricing-policy";
import { isEventGone } from "@/features/calendar/lib/google-calendar";
import { expectEqual, finish } from "./lib/harness.js";

const HOUR = 3_600_000;
const SETTINGS = { leadHours: 24, freeNoticeHours: 12 };

/**
 * NZ wall-clock time in November 2026 (NZDT, UTC+13) as a UTC instant.
 * @param day - Day of November.
 * @param hour - NZ hour.
 * @param minute - NZ minute.
 * @returns The instant.
 */
function nz(day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 10, day, hour - 13, minute));
}

/**
 * Whether one cron run at `now` takes a booking, applying the window as the cron's query does.
 * @param now - When the run starts.
 * @param startAt - The appointment start.
 * @param createdAt - When the booking was made.
 * @param landedAt - When its confirmation landed, after any quiet-hours hold.
 * @returns True when the run would send the reminder.
 */
function takenAt(now: Date, startAt: Date, createdAt: Date, landedAt = createdAt): boolean {
  const w = reminderWindow(now, SETTINGS);
  return (
    startAt > w.startAfter &&
    startAt <= w.startBy &&
    createdAt <= w.bookedBy &&
    reminderGapCleared(landedAt, w)
  );
}

/**
 * Every half-hourly run from booking to start, returning the first that sends.
 * @param startAt - The appointment start.
 * @param createdAt - When the booking was made.
 * @param landedAt - When its confirmation landed, after any quiet-hours hold.
 * @returns Hours before the start the reminder goes, or null when it never does.
 */
function firstReminder(startAt: Date, createdAt: Date, landedAt = createdAt): number | null {
  for (let t = createdAt.getTime(); t < startAt.getTime(); t += HOUR / 2) {
    if (takenAt(new Date(t), startAt, createdAt, landedAt)) return (startAt.getTime() - t) / HOUR;
  }
  return null;
}

/** Runs every fixture and reports the tally. */
function main(): void {
  console.log("booking timing fixtures\n");

  // > Cancel grace period
  const start = nz(20, 14);
  const bookedSameDay = new Date(start.getTime() - 3 * HOUR);
  const inPerson = {
    reason: "late-cancellation",
    meetingType: "in-person",
    policy: CANCELLATION,
  } as const;
  expectEqual(
    "cancel 5 min after a same-day booking is free",
    assessCancellation(start, new Date(bookedSameDay.getTime() + 5 * 60_000), {
      ...inPerson,
      bookedAt: bookedSameDay,
    }).fee,
    0,
  );
  expectEqual(
    "cancel 61 min after booking pays the fee",
    assessCancellation(start, new Date(bookedSameDay.getTime() + 61 * 60_000), {
      ...inPerson,
      bookedAt: bookedSameDay,
    }).fee,
    CANCELLATION.callOutFee,
  );
  expectEqual(
    "no booking time given: no grace",
    assessCancellation(start, new Date(bookedSameDay.getTime() + 5 * 60_000), inPerson).fee,
    CANCELLATION.callOutFee,
  );
  expectEqual(
    "a no-show never gets the grace",
    assessCancellation(start, new Date(bookedSameDay.getTime() + 5 * 60_000), {
      ...inPerson,
      reason: "no-show",
      bookedAt: bookedSameDay,
    }).fee,
    CANCELLATION.fullCallOutFee,
  );
  expectEqual(
    "remote grace too",
    assessCancellation(start, new Date(start.getTime() - 2 * HOUR), {
      ...inPerson,
      meetingType: "remote",
      bookedAt: new Date(start.getTime() - 2.5 * HOUR),
    }).fee,
    0,
  );

  // > Booking form short-notice note
  const opened = nz(20, 9);
  expectEqual(
    "no time picked, no note",
    shortNoticeCancelNote(null, opened, "in-person", CANCELLATION, true),
    null,
  );
  expectEqual(
    "a slot 13h out gets no note",
    shortNoticeCancelNote(nz(20, 22), opened, "in-person", CANCELLATION, true),
    null,
  );
  expectEqual(
    "a same-day in-person slot explains the fee and the grace",
    shortNoticeCancelNote(nz(20, 14), opened, "in-person", CANCELLATION, true),
    "This time is less than 12 hours away, so cancelling it would cost $35 ($65 plus travel in the last hour). If you change your mind within 1 hour of booking, cancelling is free.",
  );
  expectEqual(
    "remote uses its own shorter window",
    shortNoticeCancelNote(nz(20, 14), opened, "remote", CANCELLATION, true),
    null,
  );
  expectEqual(
    "an edit drops the grace sentence",
    shortNoticeCancelNote(nz(20, 11), opened, "remote", CANCELLATION, false),
    "This time is less than 4 hours away, so cancelling it would cost $25.",
  );

  // > Which bookings get a separate reminder
  expectEqual("booked 20h out (Martin): no reminder", firstReminder(nz(21, 10), nz(20, 14)), null);
  expectEqual(
    "booked 26h out: not within minutes, but once 12h have passed",
    firstReminder(nz(21, 14), nz(20, 12)),
    14,
  );
  expectEqual("booked 30h out: 18h out", firstReminder(nz(21, 18), nz(20, 12)), 18);
  expectEqual("booked days ahead: at the 24h lead", firstReminder(nz(25, 10), nz(20, 9)), 24);
  expectEqual(
    "booked 22:00 with the confirmation held to 07:00: 12h after it lands, not 3h",
    firstReminder(nz(22, 9), nz(20, 22), nz(21, 7)),
    14,
  );
  expectEqual(
    "a reschedule 20h out is covered by its own notice",
    confirmationCoversReminder(nz(21, 10), nz(20, 14), SETTINGS),
    true,
  );
  expectEqual(
    "a reschedule 30h out still gets a reminder later",
    confirmationCoversReminder(nz(21, 18), nz(20, 12), SETTINGS),
    false,
  );

  // > Customer move: which patch failures fall back to a new event
  expectEqual("a 404 patch falls back to a new event", isEventGone({ status: 404 }), true);
  expectEqual(
    "a 410 deleted event falls back too",
    isEventGone({ code: 410, response: { status: 410 } }),
    true,
  );
  expectEqual("a 500 undoes the move instead", isEventGone({ status: 500 }), false);
  expectEqual("an auth failure undoes the move", isEventGone({ response: { status: 401 } }), false);
  expectEqual("a network error undoes the move", isEventGone(new Error("ECONNRESET")), false);

  // > Reminder day word
  expectEqual("sent the day before", reminderDayPhrase(nz(21, 10), nz(20, 10)), "tomorrow");
  expectEqual(
    "triggered at 11pm, held to 7am the same day",
    reminderDayPhrase(nz(21, 13), nz(21, 7)),
    "today",
  );
  expectEqual("two days out", reminderDayPhrase(nz(22, 10), nz(20, 10)), "on Sunday");
  expectEqual(
    "a week or more names the date",
    reminderDayPhrase(nz(27, 10), nz(20, 10)),
    "on Friday 27 November",
  );
  expectEqual(
    "late evening NZ is still the NZ date, not UTC's",
    reminderDayPhrase(nz(21, 23, 30), nz(20, 23)),
    "tomorrow",
  );

  finish();
}

main();
