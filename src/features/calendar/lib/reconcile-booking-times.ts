// src/features/calendar/lib/reconcile-booking-times.ts
// Pulls operator-corrected times from Google Calendar back onto Booking rows (the calendar
// wins), flags rows whose event was deleted, and clears reminder stamps a move invalidated.

import { lookupBookingEvent } from "@/features/calendar/lib/google-calendar";
import { prisma } from "@/shared/lib/prisma";
import { Prisma } from "@prisma/client";

/** How many events to fetch at once - Google is fine with this, quota isn't. */
const FETCH_CONCURRENCY = 10;

/** Default lookback. Older bookings are history no reader still acts on. */
const DEFAULT_SINCE_DAYS = 60;

/**
 * Max `reminderLeadHours` (168). A stamp older than this before the start was sent
 * for other times; using the cap avoids a settings read, so the CLI can call this.
 */
const MAX_REMINDER_LEAD_MS = 168 * 3_600_000;

/** A send stamp cleared so its email can go out against the row's real times. */
export type RearmedStamp = "reminder";

/** One booking whose row and calendar event disagree. */
export interface BookingTimeDrift {
  bookingId: string;
  /** Customer name, so a dry run reads without a second lookup. */
  name: string;
  /** What the Booking row currently says. */
  from: { startAt: Date; endAt: Date };
  /** What the calendar event says. */
  to: { startAt: Date; endAt: Date };
  /** Why the row was left alone, when it was. */
  skipped?: string;
}

/** A booking carrying send stamps that belong to times it no longer has. */
export interface BookingStampRearm {
  bookingId: string;
  /** Customer name, so a dry run reads without a second lookup. */
  name: string;
  /** The start the row holds once this pass is done. */
  startAt: Date;
  /** Which stamps were cleared. */
  stamps: RearmedStamp[];
}

/** A booking whose calendar event has been deleted out from under it. */
export interface BookingEventMissing {
  bookingId: string;
  /** Customer name, so a dry run reads without a second lookup. */
  name: string;
  /** When the row still thinks the job runs. */
  startAt: Date;
}

/** Outcome of one reconcile pass. */
export interface ReconcileResult {
  /** Bookings that owned an event and were compared. */
  checked: number;
  /** Bookings whose event could not be read (all-day, or an API failure). */
  unreadable: number;
  /** Every disagreement found, applied or not. */
  drifted: BookingTimeDrift[];
  /** Bookings whose event is gone from Calendar - the job was called off there. */
  missing: BookingEventMissing[];
  /** Bookings previously flagged as missing whose event reads back again. */
  restored: number;
  /** Bookings whose stale send stamps were cleared, drifted or not. */
  rearmed: BookingStampRearm[];
}

/**
 * Send stamps that cannot belong to the booking's times. A start this pass moves always
 * invalidates the reminder (it named the old time); otherwise a reminder older than the
 * widest lead window catches rows corrected before this check existed.
 * @param booking - The row's current start and stamps.
 * @param booking.startAt - The start the row holds before this pass.
 * @param booking.emailReminderSentAt - When the 24h reminder went out.
 * @param startAt - The start the row holds after this pass.
 * @param now - Reference instant.
 * @returns The stamps worth clearing, in report order.
 */
function staleSendStamps(
  booking: { startAt: Date; emailReminderSentAt: Date | null },
  startAt: Date,
  now: Date,
): RearmedStamp[] {
  const stale: RearmedStamp[] = [];

  const startMoved = startAt.getTime() !== booking.startAt.getTime();
  if (
    booking.emailReminderSentAt &&
    startAt > now &&
    (startMoved || startAt.getTime() - booking.emailReminderSentAt.getTime() > MAX_REMINDER_LEAD_MS)
  ) {
    stale.push("reminder");
  }

  return stale;
}

/**
 * Compares booking rows against their live calendar events, correcting drifted
 * times, re-arming the send stamps a correction invalidates, and flagging rows
 * whose event has been deleted.
 * @param options - Pass options.
 * @param options.apply - Write times, stamp clears and missing-event flags; false only reports.
 * @param options.sinceDays - How far back to look, in days (defaults to 60).
 * @returns What was checked, what disagreed, what was re-armed, and whose event is gone.
 */
export async function reconcileBookingTimes(options: {
  apply: boolean;
  sinceDays?: number;
}): Promise<ReconcileResult> {
  const now = new Date();
  const since = new Date(now.getTime() - (options.sinceDays ?? DEFAULT_SINCE_DAYS) * 86_400_000);

  // Cancelled bookings have no event left to compare against.
  const bookings = await prisma.booking.findMany({
    where: {
      calendarEventId: { not: null },
      status: { in: ["confirmed", "completed"] },
      startAt: { gte: since },
    },
    select: {
      id: true,
      name: true,
      startAt: true,
      endAt: true,
      calendarEventId: true,
      activeSlotKey: true,
      calendarEventMissingAt: true,
      emailReminderSentAt: true,
    },
    orderBy: { startAt: "asc" },
  });

  const result: ReconcileResult = {
    checked: 0,
    unreadable: 0,
    drifted: [],
    missing: [],
    restored: 0,
    rearmed: [],
  };

  for (let i = 0; i < bookings.length; i += FETCH_CONCURRENCY) {
    const batch = bookings.slice(i, i + FETCH_CONCURRENCY);
    const lookups = await Promise.all(
      // The non-null assertion is safe: the query filtered on it.
      batch.map((b) => lookupBookingEvent(b.calendarEventId!)),
    );

    for (const [index, booking] of batch.entries()) {
      const lookup = lookups[index]!;

      // Event deleted in Calendar: flag the row so the email crons skip it;
      // times stay as they are.
      if (lookup.state === "gone") {
        result.missing.push({
          bookingId: booking.id,
          name: booking.name,
          startAt: booking.startAt,
        });
        if (options.apply && !booking.calendarEventMissingAt) {
          await prisma.booking.update({
            where: { id: booking.id },
            data: { calendarEventMissingAt: new Date() },
          });
        }
        continue;
      }

      if (lookup.state === "unreadable") {
        result.unreadable++;
        continue;
      }
      result.checked++;

      // Event reads back again, so clear the flag and let emails resume.
      if (booking.calendarEventMissingAt) {
        result.restored++;
        if (options.apply) {
          await prisma.booking.update({
            where: { id: booking.id },
            data: { calendarEventMissingAt: null },
          });
        }
      }

      const startAt = new Date(lookup.event.start);
      const endAt = new Date(lookup.event.end);

      // A moved booking keeps its one-way reminder stamp and would never be reminded
      // again. Checked against the times, so earlier-corrected rows are caught too.
      const stamps = staleSendStamps(booking, startAt, now);
      const clearStamps = stamps.includes("reminder") ? { emailReminderSentAt: null } : {};

      const drifted =
        startAt.getTime() !== booking.startAt.getTime() ||
        endAt.getTime() !== booking.endAt.getTime();

      // Times already agree, so the only thing left to repair is the stamps.
      if (!drifted) {
        if (stamps.length > 0) {
          result.rearmed.push({
            bookingId: booking.id,
            name: booking.name,
            startAt,
            stamps,
          });
          if (options.apply) {
            await prisma.booking.update({ where: { id: booking.id }, data: clearStamps });
          }
        }
        continue;
      }

      const drift: BookingTimeDrift = {
        bookingId: booking.id,
        name: booking.name,
        from: { startAt: booking.startAt, endAt: booking.endAt },
        to: { startAt, endAt },
      };

      let wrote = true;
      if (options.apply) {
        // Only a booking still holding its slot carries a live key; completed
        // rows keep `released:<id>` and must not reclaim one.
        const movesSlot = !booking.activeSlotKey?.startsWith("released:");
        try {
          await prisma.booking.update({
            where: { id: booking.id },
            data: {
              startAt,
              endAt,
              ...(movesSlot ? { activeSlotKey: startAt.toISOString() } : {}),
              ...clearStamps,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            // Another live booking holds that start; leave the row stale
            // and report it for a human.
            drift.skipped = "another booking already starts at that time";
            wrote = false;
          } else {
            throw error;
          }
        }
      }

      // Report only when the write carrying the clears landed.
      if (stamps.length > 0 && wrote) {
        result.rearmed.push({ bookingId: booking.id, name: booking.name, startAt, stamps });
      }

      result.drifted.push(drift);
    }
  }

  return result;
}
