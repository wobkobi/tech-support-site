// src/features/calendar/lib/reconcile-booking-times.ts
/**
 * @description Pulls booking times back from Google Calendar.
 *
 * The operator corrects event times in Calendar - usually on a phone, after the
 * job - and the billing path already reads those live. The Booking row doesn't
 * follow, so reminder timing, review timing and the cancellation-fee windows go
 * on working off a stale start. This walks the bookings that own an event,
 * compares the row against the live event, and reports or applies the
 * difference. The calendar wins: it is where the correction was made.
 *
 * It also carries the other half of that drift: an event deleted in Calendar
 * because the job was called off, on a row nobody cancelled. Those get
 * calendarEventMissingAt stamped so the reminder and review crons stop emailing
 * about a job that isn't happening.
 *
 * Correcting a time is not enough on its own. emailReminderSentAt and
 * reviewSentAt are one-way stamps, so a row moved to a new date still carries
 * the marks of emails sent against the old one, and both crons skip it forever.
 * A correction clears the stamps its move invalidated.
 */

import { lookupBookingEvent } from "@/features/calendar/lib/google-calendar";
import { prisma } from "@/shared/lib/prisma";
import { Prisma } from "@prisma/client";

/** How many events to fetch at once - Google is fine with this, quota isn't. */
const FETCH_CONCURRENCY = 10;

/** Default lookback. Older bookings are history no reader still acts on. */
const DEFAULT_SINCE_DAYS = 60;

/**
 * Widest gap the settings validator allows between a reminder and the start it
 * was sent for: `reminderLeadHours` is capped at 168. A stamp older than that
 * relative to the current start cannot have been sent for these times, whatever
 * the setting happens to be, so the check needs no settings read - which also
 * keeps this callable from the CLI script, outside any Next request context.
 */
const MAX_REMINDER_LEAD_MS = 168 * 3_600_000;

/** A send stamp cleared so its email can go out against the row's real times. */
export type RearmedStamp = "reminder" | "review";

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
 * Send stamps on a booking that cannot belong to the times it is about to hold.
 *
 * Judged against the times themselves rather than against "did this pass move
 * it", because a row corrected by an earlier run, or by either edit route, has
 * matching times and stale stamps - and a drift-only check would never repair
 * it. Both tests are one-directional and conservative: they only fire on a job
 * that is still ahead, where an email already sent was necessarily about times
 * the booking no longer has.
 * @param booking - The row's current stamps.
 * @param booking.emailReminderSentAt - When the 24h reminder went out.
 * @param booking.reviewSentAt - When the review request went out.
 * @param booking.reviewSubmittedAt - When the customer actually reviewed.
 * @param startAt - The start the row holds after this pass.
 * @param endAt - The finish the row holds after this pass.
 * @param now - Reference instant.
 * @returns The stamps worth clearing, in report order.
 */
function staleSendStamps(
  booking: {
    emailReminderSentAt: Date | null;
    reviewSentAt: Date | null;
    reviewSubmittedAt: Date | null;
  },
  startAt: Date,
  endAt: Date,
  now: Date,
): RearmedStamp[] {
  const stale: RearmedStamp[] = [];

  // A legitimate reminder goes out inside the lead window before the start.
  // One sent further back than the widest permitted window was sent for an
  // earlier date, and the job it now names has not been reminded at all.
  if (
    booking.emailReminderSentAt &&
    startAt > now &&
    startAt.getTime() - booking.emailReminderSentAt.getTime() > MAX_REMINDER_LEAD_MS
  ) {
    stale.push("reminder");
  }

  // A review request that predates the finish was asking about a visit that had
  // not happened. Never re-armed for a customer who has actually reviewed, and
  // never for a finish already in the past, which is a real completed job.
  if (
    booking.reviewSentAt &&
    !booking.reviewSubmittedAt &&
    endAt > now &&
    booking.reviewSentAt < endAt
  ) {
    stale.push("review");
  }

  return stale;
}

/**
 * Compares booking rows against their live calendar events, correcting drifted
 * times, re-arming the send stamps a correction invalidates, and flagging rows
 * whose event has been deleted.
 * @param options - Pass options.
 * @param options.apply - Write the calendar's times back to the row, clear the re-armed stamps, and stamp/clear the missing-event flag. False only reports.
 * @param options.sinceDays - How far back to look, in days (defaults to 60).
 * @returns What was checked, what disagreed, what was re-armed, and whose event is gone.
 */
export async function reconcileBookingTimes(options: {
  apply: boolean;
  sinceDays?: number;
}): Promise<ReconcileResult> {
  const now = new Date();
  const since = new Date(now.getTime() - (options.sinceDays ?? DEFAULT_SINCE_DAYS) * 86_400_000);

  // Cancelled bookings are excluded: their event is already deleted, so there
  // is nothing to compare against and nothing that still reads their times.
  const bookings = await prisma.booking.findMany({
    where: {
      calendarEventId: { not: null },
      status: { in: ["held", "confirmed", "completed"] },
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
      reviewSentAt: true,
      reviewSubmittedAt: true,
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
      const lookup = lookups[index];

      // Event deleted in Calendar: flag the orphaned row so the email crons
      // leave it alone, and leave its times as they are - there is nothing
      // authoritative left to copy from.
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

      // The event reads back, so an earlier flag was a deletion since undone or
      // a lookup that had been failing. Either way, let the emails resume.
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

      // Both send stamps are one-way, so a booking whose times moved carries stamps for a
      // date it no longer has and is skipped by both crons forever. Checked against the
      // times, not against whether this pass moved anything - a row an earlier run already
      // corrected has matching times and stale stamps, which a drift gate would miss.
      const stamps = staleSendStamps(booking, startAt, endAt, now);
      const clearStamps = {
        ...(stamps.includes("reminder") ? { emailReminderSentAt: null } : {}),
        // reviewSendFailedAt goes with it: it drives a one-shot retry that would
        // otherwise fire the request straight back out, ahead of the job it is
        // asking about.
        ...(stamps.includes("review") ? { reviewSentAt: null, reviewSendFailedAt: null } : {}),
      };

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
            // Another live booking already holds that start. Leaving the row
            // stale is the lesser evil - the alternative is two bookings
            // claiming one slot - but it needs a human, so it's reported.
            drift.skipped = "another booking already starts at that time";
            wrote = false;
          } else {
            throw error;
          }
        }
      }

      // Reported alongside the drift, but only when the write that carried the
      // clears actually landed.
      if (stamps.length > 0 && wrote) {
        result.rearmed.push({ bookingId: booking.id, name: booking.name, startAt, stamps });
      }

      result.drifted.push(drift);
    }
  }

  return result;
}
