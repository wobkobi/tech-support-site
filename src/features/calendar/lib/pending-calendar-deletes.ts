// src/features/calendar/lib/pending-calendar-deletes.ts
// Booking-event deletes that survive a Google failure: a delete that fails is queued as a
// PendingCalendarDelete row, and the reconcile cron retries the queue.

import { deleteBookingEvent, isEventGone } from "@/features/calendar/lib/google-calendar";
import { sendOwnerPush } from "@/features/notifications/lib/push";
import { prisma } from "@/shared/lib/prisma";

// 48 runs of the 30-minute cron is a day of retries; past that the event needs a person.
const MAX_ATTEMPTS = 48;

/**
 * Deletes a booking-calendar event, treating one already gone as done. Any other failure is
 * queued for the reconcile cron instead of thrown, so the caller's cancel or rollback still
 * goes through.
 * @param params - Delete parameters.
 * @param params.eventId - Google Calendar event id.
 * @param params.notifyAttendees - Whether Google emails a cancellation (default true).
 * @returns True when the event is off the calendar now, false when it was queued.
 */
export async function removeBookingEvent(params: {
  eventId: string;
  notifyAttendees?: boolean;
}): Promise<boolean> {
  try {
    await deleteBookingEvent(params);
    return true;
  } catch (err) {
    if (isEventGone(err)) return true;
    console.error(`[calendar] Couldn't delete event ${params.eventId}; queued a retry:`, err);
  }
  try {
    await prisma.pendingCalendarDelete.upsert({
      where: { eventId: params.eventId },
      create: { eventId: params.eventId, notifyAttendees: params.notifyAttendees !== false },
      update: {},
    });
  } catch (err) {
    console.error(`[calendar] Couldn't queue the delete of event ${params.eventId}:`, err);
  }
  return false;
}

/** Outcome of one pass over the delete queue. */
export interface CalendarDeleteRetryResult {
  /** Events deleted, or found already gone. */
  cleared: number;
  /** Still failing; tried again next run. */
  failed: number;
  /** Past {@link MAX_ATTEMPTS}; dropped from the queue and logged. */
  abandoned: number;
}

/**
 * Retries every queued booking-event delete, oldest first.
 * @returns How many cleared, failed again, or were given up on.
 */
export async function retryPendingCalendarDeletes(): Promise<CalendarDeleteRetryResult> {
  const result: CalendarDeleteRetryResult = { cleared: 0, failed: 0, abandoned: 0 };
  const pending = await prisma.pendingCalendarDelete.findMany({ orderBy: { createdAt: "asc" } });

  for (const row of pending) {
    try {
      await deleteBookingEvent({ eventId: row.eventId, notifyAttendees: row.notifyAttendees });
      await prisma.pendingCalendarDelete.delete({ where: { id: row.id } });
      result.cleared++;
      continue;
    } catch (err) {
      if (isEventGone(err)) {
        await prisma.pendingCalendarDelete.delete({ where: { id: row.id } });
        result.cleared++;
        continue;
      }
      console.warn(`[calendar] Retry delete of event ${row.eventId} failed:`, err);
    }

    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      console.error(
        `[calendar] Gave up deleting event ${row.eventId} after ${MAX_ATTEMPTS} tries; remove it from the booking calendar by hand`,
      );
      await prisma.pendingCalendarDelete.delete({ where: { id: row.id } });
      await sendOwnerPush({
        title: "Calendar event left behind",
        body: "A cancelled or moved booking's event couldn't be deleted. Remove it from the booking calendar.",
        url: "/admin/schedule",
        tag: `calendar-delete-${row.eventId}`,
      });
      result.abandoned++;
    } else {
      await prisma.pendingCalendarDelete.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      result.failed++;
    }
  }

  return result;
}
