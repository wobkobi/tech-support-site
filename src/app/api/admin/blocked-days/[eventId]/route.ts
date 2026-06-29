// src/app/api/admin/blocked-days/[eventId]/route.ts
/**
 * @description Admin endpoint to remove an all-day "Busy" block by deleting the
 * underlying Google Calendar event.
 */

import { deleteBookingEvent, SCHEDULE_CALENDAR_TAG } from "@/features/calendar/lib/google-calendar";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * DELETE /api/admin/blocked-days/[eventId]
 * Removes the named all-day event from the booking calendar.
 * @param request - Incoming admin request.
 * @param root0 - Route params.
 * @param root0.params - Route params with eventId.
 * @returns JSON with ok or an error response.
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

  try {
    await deleteBookingEvent({ eventId });
    revalidateTag(SCHEDULE_CALENDAR_TAG, {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/blocked-days/[eventId]] Delete failed:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to delete blocked-day event." },
      { status: 500 },
    );
  }
}
