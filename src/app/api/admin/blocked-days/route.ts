// src/app/api/admin/blocked-days/route.ts
/**
 * @description Admin endpoint to create an all-day "Busy" block on the booking
 * calendar. Refuses the request when a confirmed/held booking already exists
 * on the chosen NZ day - personal-calendar events on the day are ignored.
 */

import {
  createBlockedDayEvent,
  SCHEDULE_CALENDAR_TAG,
} from "@/features/calendar/lib/google-calendar";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
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

  try {
    const { eventId } = await createBlockedDayEvent({
      dateKey,
      summary: body.summary?.trim() || "Busy",
    });
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
