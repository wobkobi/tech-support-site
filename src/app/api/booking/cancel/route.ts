// src/app/api/booking/cancel/route.ts
/**
 * @file route.ts
 * @description API route to cancel a booking.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteBookingEvent } from "@/server/google/calendar";

/**
 * POST /api/booking/cancel
 * Cancels a booking using the cancel token.
 * @param request - Incoming request.
 * @returns JSON response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { cancelToken?: string };
    const { cancelToken } = body;

    if (!cancelToken?.trim()) {
      return NextResponse.json({ ok: false, error: "Cancel token required." }, { status: 400 });
    }

    const booking = await prisma.booking.findFirst({
      where: {
        cancelToken: cancelToken.trim(),
        status: { in: ["held", "confirmed"] },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Booking not found or already cancelled." },
        { status: 404 },
      );
    }

    // Delete calendar event if exists
    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        console.error("[booking/cancel] Calendar delete failed:", err);
      }
    }

    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled" },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[booking/cancel] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to cancel." }, { status: 500 });
  }
}
