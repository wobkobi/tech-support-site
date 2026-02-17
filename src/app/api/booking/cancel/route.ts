// src/app/api/booking/cancel/route.ts
/**
 * @file route.ts
 * @description API route to cancel a booking using a cancel token
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteBookingEvent } from "@/lib/google-calendar";

interface CancelPayload {
  cancelToken: string;
}

/**
 * POST /api/booking/cancel
 * Cancels a booking by its cancel token and removes from Google Calendar.
 * @param request - The incoming cancel request.
 * @returns JSON response indicating success or failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as CancelPayload;
    const { cancelToken } = body;

    if (!cancelToken) {
      return NextResponse.json({ ok: false, error: "Missing cancel token." }, { status: 400 });
    }

    // Find the booking
    const booking = await prisma.booking.findFirst({
      where: { cancelToken },
    });

    if (!booking) {
      return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
    }

    if (booking.status === "cancelled") {
      return NextResponse.json({ ok: false, error: "Booking already cancelled." }, { status: 400 });
    }

    // Delete from Google Calendar if there's an event ID
    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        console.error("[booking/cancel] Failed to delete calendar event:", err);
        // Continue anyway - we still want to mark as cancelled in our DB
      }
    }

    // Update booking status
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled" },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[booking/cancel] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to cancel booking." }, { status: 500 });
  }
}
