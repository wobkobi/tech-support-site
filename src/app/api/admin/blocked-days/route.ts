// src/app/api/admin/blocked-days/route.ts
/**
 * @description Admin endpoint to create an all-day "Busy" block on the booking
 * calendar. Refuses the request when a confirmed/held booking already exists
 * on the chosen NZ day - personal-calendar events on the day are ignored.
 */

import {
  createBlockedDayEvent,
  deleteBookingEvent,
  listBlockedDayRanges,
  patchBlockedDayRange,
  SCHEDULE_CALENDAR_TAG,
} from "@/features/calendar/lib/google-calendar";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { isPastEditWindow, nzDayEndMs } from "@/shared/lib/edit-window";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { addDaysToDateKey, getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

interface BlockedDayPayload {
  dateKey?: string;
  summary?: string;
}

/**
 * POST /api/admin/blocked-days
 * Creates a "Busy" all-day event on the booking calendar for the given NZ date,
 * provided no held or confirmed bookings already occupy that day.
 * @param request - Incoming admin request with x-admin-secret header.
 * @returns JSON with the new event id or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = (await request.json().catch(() => null)) as BlockedDayPayload | null;
  if (!body) {
    return errorResponse("Invalid request body.", 400);
  }
  const dateKey = body.dateKey?.trim() ?? "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return errorResponse("Invalid date.", 400);
  }

  const { scheduling } = await getSettings();
  if (isPastEditWindow(nzDayEndMs(dateKey), Date.now(), scheduling.pastEditLockHours)) {
    return errorResponse(
      `Can't block a day more than ${scheduling.pastEditLockHours}h in the past.`,
      409,
    );
  }

  const [y, m, d] = dateKey.split("-").map(Number);
  const offset = getPacificAucklandOffset(y, m, d);
  const dayStart = new Date(Date.UTC(y, m - 1, d, -offset, 0, 0));
  const dayEnd = new Date(Date.UTC(y, m - 1, d + 1, -offset, 0, 0));

  const conflicting = await prisma.booking.findFirst({
    where: {
      status: { in: ["held", "confirmed"] },
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    select: { id: true },
  });
  if (conflicting) {
    return NextResponse.json(
      { ok: false, error: "Day already has a booking - move or cancel it first." },
      { status: 409 },
    );
  }

  const summary = body.summary?.trim() || "Busy";
  const nextKey = addDaysToDateKey(dateKey, 1);

  try {
    // Merge with any contiguous block so adjacent days collapse into a single
    // span instead of piling up separate one-day "Busy" events. `before` ends
    // exactly at D (its last covered day is D-1); `after` starts at D+1. Best
    // effort: a failed adjacency lookup falls through to a standalone create.
    let before: Awaited<ReturnType<typeof listBlockedDayRanges>>[number] | null = null;
    let after: Awaited<ReturnType<typeof listBlockedDayRanges>>[number] | null = null;
    try {
      const nearby = await listBlockedDayRanges(
        addDaysToDateKey(dateKey, -1),
        addDaysToDateKey(dateKey, 2),
      );
      before = nearby.find((b) => b.endDateKey === dateKey) ?? null;
      after = nearby.find((b) => b.startDateKey === nextKey) ?? null;
    } catch (err) {
      console.warn("[admin/blocked-days] Adjacency lookup failed; creating standalone block:", err);
    }

    let eventId: string;
    if (before && after) {
      // Bridge the two blocks: stretch `before` through `after`'s end, drop `after`.
      await patchBlockedDayRange({
        eventId: before.eventId,
        startDateKey: before.startDateKey,
        endDateKey: after.endDateKey,
      });
      await deleteBookingEvent({ eventId: after.eventId });
      eventId = before.eventId;
    } else if (before) {
      await patchBlockedDayRange({
        eventId: before.eventId,
        startDateKey: before.startDateKey,
        endDateKey: nextKey,
      });
      eventId = before.eventId;
    } else if (after) {
      await patchBlockedDayRange({
        eventId: after.eventId,
        startDateKey: dateKey,
        endDateKey: after.endDateKey,
      });
      eventId = after.eventId;
    } else {
      ({ eventId } = await createBlockedDayEvent({ dateKey, summary }));
    }

    revalidateTag(SCHEDULE_CALENDAR_TAG, {});
    return NextResponse.json({ ok: true, eventId });
  } catch (err) {
    console.error("[admin/blocked-days] Create failed:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to create blocked-day event." },
      { status: 500 },
    );
  }
}
