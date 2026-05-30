// src/app/api/admin/blocked-days/[eventId]/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to remove an all-day "Busy" block by deleting the
 * underlying Google Calendar event.
 */

import { type NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isAdminRequest } from "@/shared/lib/auth";
import { deleteBookingEvent, SCHEDULE_CALENDAR_TAG } from "@/features/calendar/lib/google-calendar";

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
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  if (!eventId) {
    return NextResponse.json({ ok: false, error: "Missing eventId." }, { status: 400 });
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
