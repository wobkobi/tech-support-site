// src/app/api/admin/blocked-days/[eventId]/route.ts
// Admin endpoint to unblock a day by trimming or splitting the block's single all-day
// event. Without `?date` the whole event is deleted.

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

/** A surviving all-day span after a day is removed; `endDateKey` exclusive. */
interface Segment {
  startDateKey: string;
  endDateKey: string;
}

/**
 * Splits an all-day block [startKey, endKey) around a removed day (caller checks it is
 * inside): only day > [], edge day > 1 segment, middle day > 2.
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
 * Unblocks one day, or deletes the whole event without `date`.
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
  // A malformed day compares wrongly against the block's date keys and could split it oddly.
  if (removedDay !== null && !/^\d{4}-\d{2}-\d{2}$/.test(removedDay)) {
    return errorResponse("Invalid date - expected YYYY-MM-DD.", 400);
  }

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

  // Never touch a real booking's event here; no Booking references a blocked-day event.
  const bookingUsingEvent = await prisma.booking.findFirst({
    where: { calendarEventId: eventId },
    select: { id: true },
  });
  if (bookingUsingEvent) {
    return errorResponse("That event belongs to a booking, not a blocked day.", 409);
  }

  try {
    // No day asked for, or the event isn't an all-day block: delete the whole event.
    const range = removedDay ? await getBlockedDayRange(eventId) : null;
    if (!removedDay || !range) {
      await deleteBookingEvent({ eventId });
      revalidateTag(SCHEDULE_CALENDAR_TAG, {});
      return NextResponse.json({ ok: true, action: "deleted" });
    }
    // The block was changed since the page loaded; unblocking a day it no longer covers must
    // not take the rest of the block with it.
    if (removedDay < range.startDateKey || removedDay >= range.endDateKey) {
      revalidateTag(SCHEDULE_CALENDAR_TAG, {});
      return errorResponse(
        "That day isn't part of this block any more. Refresh and try again.",
        409,
      );
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
        startDateKey: segments[0]!.startDateKey,
        endDateKey: segments[0]!.endDateKey,
      });
      // ...and, for a middle-day unblock, spin the after-portion into a new block.
      if (segments.length === 2) {
        await insertBlockedDayRange({
          startDateKey: segments[1]!.startDateKey,
          endDateKey: segments[1]!.endDateKey,
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
    // Already gone (404/410) means already unblocked.
    const code =
      (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
    if (code === 404 || code === 410) {
      revalidateTag(SCHEDULE_CALENDAR_TAG, {});
      return NextResponse.json({ ok: true, action: "already-gone" });
    }
    console.error("[admin/blocked-days/[eventId]] Unblock failed:", err);
    return errorResponse("Failed to unblock the day.", 500);
  }
}
