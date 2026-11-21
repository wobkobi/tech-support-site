// src/app/api/admin/jobs/extend/route.ts
// "Running over": pushes the end of the job you're at back by a few minutes, so the booking
// grid, the travel-home block and the travel alerts all work from when you'll actually finish.
// A booking moves its row and its calendar event (silently); a calendar-only job moves its event.

import { refreshCalendarCache } from "@/features/calendar/lib/calendar-cache";
import {
  fetchBookingEvent,
  patchBookingEventEnd,
  SCHEDULE_CALENDAR_TAG,
} from "@/features/calendar/lib/google-calendar";
import { runRunningLateCheck } from "@/features/calendar/lib/running-late.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NZ_TZ } from "@/shared/lib/timezone-utils";
import { revalidateTag } from "next/cache";
import { after, type NextRequest, NextResponse } from "next/server";

/** Longest single extension, so a mistyped request can't swallow the evening. */
const MAX_MINUTES = 180;

/**
 * POST /api/admin/jobs/extend - adds minutes to a job's end.
 * @param request - Admin request with JSON `{ source: "booking" | "calendar", key, minutes }`:
 *   `key` is the booking id or the calendar event id.
 * @returns `{ ok, endAt }` with the new end, or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);

  const body = (await request.json().catch(() => ({}))) as {
    source?: unknown;
    key?: unknown;
    minutes?: unknown;
  };
  const { source, key, minutes } = body;
  if (source !== "booking" && source !== "calendar") {
    return errorResponse("source must be booking or calendar", 400);
  }
  if (typeof key !== "string" || !key) return errorResponse("key is required", 400);
  if (
    typeof minutes !== "number" ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > MAX_MINUTES
  ) {
    return errorResponse(`minutes must be 1-${MAX_MINUTES}`, 400);
  }

  try {
    let endAt: Date;
    if (source === "booking") {
      if (!/^[a-f0-9]{24}$/.test(key)) return errorResponse("Booking not found", 404);
      const booking = await prisma.booking.findUnique({
        where: { id: key },
        select: { status: true, endAt: true, calendarEventId: true },
      });
      if (!booking || booking.status !== "confirmed") {
        return errorResponse("Booking not found", 404);
      }
      endAt = new Date(booking.endAt.getTime() + minutes * 60_000);
      // Calendar first: a failed patch leaves the row as it was, so the two never disagree.
      if (booking.calendarEventId) {
        await patchBookingEventEnd({ eventId: booking.calendarEventId, endAt, timeZone: NZ_TZ });
      }
      await prisma.booking.update({ where: { id: key }, data: { endAt } });
    } else {
      const event = await fetchBookingEvent(key);
      if (!event) return errorResponse("Calendar job not found", 404);
      endAt = new Date(new Date(event.end).getTime() + minutes * 60_000);
      await patchBookingEventEnd({ eventId: key, endAt, timeZone: NZ_TZ });
    }

    // Before answering, so the refreshed page shows the new end and the travel-home block moved
    // with it. A failed refresh is caught up by the next cron run.
    await refreshCalendarCache().catch((error: unknown) =>
      console.error("[jobs/extend] Calendar cache refresh failed:", error),
    );
    revalidateTag(SCHEDULE_CALENDAR_TAG, {});
    // Whether the later finish now puts the next job at risk: pushes "Running late" if so.
    after(() =>
      runRunningLateCheck("live", new Date(), "manual").catch((error: unknown) =>
        console.error("[jobs/extend] Running-late check failed:", error),
      ),
    );

    return NextResponse.json({ ok: true, endAt: endAt.toISOString() });
  } catch (error) {
    console.error("[jobs/extend] Error:", error);
    return errorResponse("Couldn't update the calendar. Try again.", 500);
  }
}
