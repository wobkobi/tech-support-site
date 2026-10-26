// src/app/api/admin/blocked-days/route.ts
// Admin endpoint to create an all-day "Busy" block; refused when a live booking is on that NZ day.

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
import {
  addDaysToDateKey,
  dateKeyParts,
  getPacificAucklandOffset,
  nzMidnightUtc,
} from "@/shared/lib/timezone-utils";
import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

interface BlockedDayPayload {
  dateKey?: string;
  summary?: string;
}

/**
 * POST /api/admin/blocked-days
 * Creates a "Busy" all-day event for the NZ date if no live bookings occupy it.
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

  const [y, m, d] = dateKeyParts(dateKey);
  const offset = getPacificAucklandOffset(y, m, d);
  const dayStart = nzMidnightUtc(y, m, d);
  // End keeps day d's offset: "24 hours of NZ day d", which differs from d+1 midnight across DST.
  const dayEnd = new Date(Date.UTC(y, m - 1, d + 1, -offset, 0, 0));

  const conflicting = await prisma.booking.findFirst({
    where: {
      status: "confirmed",
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
    // Merge with adjacent blocks (`before` ends at D, `after` starts at D+1); a failed
    // lookup falls back to a plain create.
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
