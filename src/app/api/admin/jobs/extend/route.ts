// src/app/api/admin/jobs/extend/route.ts
// "Running over": moves the end of the job you're at to a later time, so the booking
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

/**
 * Furthest a new end may sit past the later of the old end and now, so a bad request can't
 * swallow the evening.
 */
const MAX_EXTEND_MS = 180 * 60_000;

/**
 * Checks a requested end against the job's current one. An undo moves the end back earlier,
 * so it only has to land between the start and the current end.
 * @param target - Requested end.
 * @param job - The job's start and end now.
 * @param job.startAt - The job's start.
 * @param job.endAt - The job's end now.
 * @param undo - Whether this puts back the end from before an extension.
 * @returns An error message, or null when the end is fine.
 */
function badEnd(
  target: Date,
  { startAt, endAt: currentEnd }: { startAt: Date; endAt: Date },
  undo: boolean,
): string | null {
  if (undo) {
    if (target.getTime() >= currentEnd.getTime() || target.getTime() <= startAt.getTime()) {
      return "That end can't be put back. Change it on the schedule instead.";
    }
    return null;
  }
  const nowMs = Date.now();
  if (target.getTime() <= currentEnd.getTime()) return "The new end must be after the current one.";
  if (target.getTime() <= nowMs) return "That time has already passed. Pick a later one.";
  if (target.getTime() > Math.max(currentEnd.getTime(), nowMs) + MAX_EXTEND_MS) {
    return "That's more than 3 hours on. Change it on the schedule instead.";
  }
  return null;
}

/**
 * POST /api/admin/jobs/extend - moves a job's end later, or back again with `undo`.
 * @param request - Admin request with JSON `{ source: "booking" | "calendar", key, endAt, undo? }`:
 *   `key` is the booking id or the calendar event id, `endAt` the new end (ISO), `undo` true to
 *   put back the end from before an extension.
 * @returns `{ ok, endAt }` with the new end, or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);

  const body = (await request.json().catch(() => ({}))) as {
    source?: unknown;
    key?: unknown;
    endAt?: unknown;
    undo?: unknown;
  };
  const { source, key } = body;
  const undo = body.undo === true;
  if (source !== "booking" && source !== "calendar") {
    return errorResponse("source must be booking or calendar", 400);
  }
  if (typeof key !== "string" || !key) return errorResponse("key is required", 400);
  const endAt = typeof body.endAt === "string" ? new Date(body.endAt) : null;
  if (!endAt || Number.isNaN(endAt.getTime())) return errorResponse("endAt is required", 400);

  try {
    if (source === "booking") {
      if (!/^[a-f0-9]{24}$/.test(key)) return errorResponse("Booking not found", 404);
      const booking = await prisma.booking.findUnique({
        where: { id: key },
        select: { status: true, startAt: true, endAt: true, calendarEventId: true },
      });
      if (!booking || booking.status !== "confirmed") {
        return errorResponse("Booking not found", 404);
      }
      const problem = badEnd(endAt, booking, undo);
      if (problem) return errorResponse(problem, 400);
      // Calendar first: a failed patch leaves the row as it was, so the two never disagree.
      if (booking.calendarEventId) {
        await patchBookingEventEnd({ eventId: booking.calendarEventId, endAt, timeZone: NZ_TZ });
      }
      await prisma.booking.update({ where: { id: key }, data: { endAt } });
    } else {
      const event = await fetchBookingEvent(key);
      if (!event) return errorResponse("Calendar job not found", 404);
      const problem = badEnd(
        endAt,
        { startAt: new Date(event.start), endAt: new Date(event.end) },
        undo,
      );
      if (problem) return errorResponse(problem, 400);
      await patchBookingEventEnd({ eventId: key, endAt, timeZone: NZ_TZ });
    }

    // Before answering, so the refreshed page shows the new end and the travel-home block moved
    // with it. A failed refresh is caught up by the next cron run.
    await refreshCalendarCache().catch((error: unknown) =>
      console.error("[jobs/extend] Calendar cache refresh failed:", error),
    );
    revalidateTag(SCHEDULE_CALENDAR_TAG, { expire: 0 });
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
