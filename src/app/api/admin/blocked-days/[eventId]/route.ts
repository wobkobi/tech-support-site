// src/app/api/admin/blocked-days/[eventId]/route.ts
/**
 * @description Admin endpoint to unblock a day. A multi-day block is ONE
 * all-day "Busy" event spanning the range, so unblocking a single day must
 * trim or split that event: an edge day shortens it, a middle day splits it,
 * the last remaining day deletes it. Without `?date` (legacy callers) the
 * whole event is deleted.
 */

import {
  deleteBookingEvent,
  getBlockedDayRange,
  insertBlockedDayRange,
  patchBlockedDayRange,
  SCHEDULE_CALENDAR_TAG,
} from "@/features/calendar/lib/google-calendar";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { isPastEditWindow, nzDayEndMs } from "@/shared/lib/edit-window";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { addDaysToDateKey } from "@/shared/lib/timezone-utils";
import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/** A surviving all-day span after a day is removed; `endDateKey` exclusive. */
interface Segment {
  startDateKey: string;
  endDateKey: string;
}

/**
 * Splits an all-day block [startKey, endKey) (end exclusive) around a removed
 * day, returning the surviving segments (caller guards that `removedDay` is in
 * the span): the only day > [], an edge day > 1 segment, a middle day > 2.
 * @param startKey - Block start (inclusive, YYYY-MM-DD).
 * @param endKey - Block end (exclusive, YYYY-MM-DD).
 * @param removedDay - The day being unblocked (YYYY-MM-DD).
 * @returns 0, 1, or 2 surviving segments.
 */
function splitBlockedRange(startKey: string, endKey: string, removedDay: string): Segment[] {
  const segments: Segment[] = [];
  if (startKey < removedDay) segments.push({ startDateKey: startKey, endDateKey: removedDay });
  const afterStart = addDaysToDateKey(removedDay, 1);
  if (afterStart < endKey) segments.push({ startDateKey: afterStart, endDateKey: endKey });
  return segments;
}

/**
 * DELETE /api/admin/blocked-days/[eventId]?date=YYYY-MM-DD
 * Unblocks a day: trims or splits the underlying all-day event so only that day
 * is freed; without `date`, deletes the whole event.
 * @param request - Incoming admin request.
 * @param root0 - Route params.
 * @param root0.params - Route params with eventId.
 * @returns JSON with ok + the action taken (deleted / trimmed / split), or an error.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { eventId } = await params;
  if (!eventId) {
    return errorResponse("Missing eventId.", 400);
  }
  const removedDay = request.nextUrl.searchParams.get("date");

  const { scheduling } = await getSettings();
  if (
    removedDay &&
    isPastEditWindow(nzDayEndMs(removedDay), Date.now(), scheduling.pastEditLockHours)
  ) {
    return errorResponse(
      `Can't unblock a day more than ${scheduling.pastEditLockHours}h in the past.`,
      409,
    );
  }

  // Refuse to touch a real booking's calendar event via the blocked-day route:
  // that would strip the appointment off the calendar while the Booking row stays
  // confirmed with a now-dangling calendarEventId. Blocked-day events are never
  // referenced by a Booking.
  const bookingUsingEvent = await prisma.booking.findFirst({
    where: { calendarEventId: eventId },
    select: { id: true },
  });
  if (bookingUsingEvent) {
    return errorResponse("That event belongs to a booking, not a blocked day.", 409);
  }

  try {
    // No specific day (legacy caller), or the event isn't a readable all-day
    // block, or the day sits outside the block: delete the whole event.
    const range = removedDay ? await getBlockedDayRange(eventId) : null;
    if (
      !removedDay ||
      !range ||
      removedDay < range.startDateKey ||
      removedDay >= range.endDateKey
    ) {
      await deleteBookingEvent({ eventId });
      revalidateTag(SCHEDULE_CALENDAR_TAG, {});
      return NextResponse.json({ ok: true, action: "deleted" });
    }

    const segments = splitBlockedRange(range.startDateKey, range.endDateKey, removedDay);
    let action: "deleted" | "trimmed" | "split";

    if (segments.length === 0) {
      // The removed day was the only day - drop the block entirely.
      await deleteBookingEvent({ eventId });
      action = "deleted";
    } else {
      // Keep the first (or only) surviving segment on the original event...
      await patchBlockedDayRange({
        eventId,
        startDateKey: segments[0].startDateKey,
        endDateKey: segments[0].endDateKey,
      });
      // ...and, for a middle-day unblock, spin the after-portion into a new block.
      if (segments.length === 2) {
        await insertBlockedDayRange({
          startDateKey: segments[1].startDateKey,
          endDateKey: segments[1].endDateKey,
          summary: range.summary,
        });
        action = "split";
      } else {
        action = "trimmed";
      }
    }

    revalidateTag(SCHEDULE_CALENDAR_TAG, {});
    return NextResponse.json({ ok: true, action });
  } catch (err) {
    // The event is already gone (a prior action / merge deleted it) - the day is
    // effectively unblocked, so treat 404/410 as success rather than a 500.
    const code =
      (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
    if (code === 404 || code === 410) {
      revalidateTag(SCHEDULE_CALENDAR_TAG, {});
      return NextResponse.json({ ok: true, action: "already-gone" });
    }
    console.error("[admin/blocked-days/[eventId]] Unblock failed:", err);
    return NextResponse.json({ ok: false, error: "Failed to unblock the day." }, { status: 500 });
  }
}
