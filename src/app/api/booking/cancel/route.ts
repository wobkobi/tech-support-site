// src/app/api/booking/cancel/route.ts
/**
 * @file route.ts
 * @description API route to cancel a booking using a cancel token.
 * GET returns booking info (startAt, status) so the customer-facing cancel
 * page can render the cancellation-fee banner before they confirm.
 * POST flips status to "cancelled", deletes the Google Calendar event, and
 * stamps cancelledAt + cancelledBy + lateCancellation + travelChargeApplies
 * against the policy's cancellation-window helpers (server clock so a skewed
 * client cannot argue around the boundary).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { deleteBookingEvent } from "@/features/calendar/lib/google-calendar";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import {
  isWithinCancellationWindow,
  isWithinTravelWindow,
} from "@/features/business/lib/pricing-policy";

interface CancelPayload {
  cancelToken: string;
}

/**
 * GET /api/booking/cancel?token=...
 * Returns minimal booking info the cancel page needs to render the
 * confirmation gate (the appointment time + current status). Never mutates
 * state - the actual cancellation is a separate POST.
 * @param request - Incoming request, expects ?token=... in the query string.
 * @returns JSON `{ ok, startAt, status }` or `{ ok: false, error }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "booking-cancel-info", 10, 60_000);
  if (limited) return limited;

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing cancel token." }, { status: 400 });
  }

  const booking = await prisma.booking.findFirst({
    where: { cancelToken: token },
    select: { startAt: true, status: true },
  });
  if (!booking) {
    return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    startAt: booking.startAt.toISOString(),
    status: booking.status,
  });
}

/**
 * POST /api/booking/cancel
 * Cancels a booking by its cancel token and removes from Google Calendar.
 * Stamps cancellation flags (lateCancellation, travelChargeApplies,
 * cancelledBy, cancelledAt) so the late-cancel fee path has the
 * authoritative server-decided values.
 * @param request - The incoming cancel request.
 * @returns JSON response indicating success or failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "booking-cancel", 5, 60_000);
  if (limited) return limited;

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

    // Compute the cancellation-fee flags against the server clock so a skewed
    // client cannot argue around the boundary. Both flags are derived from
    // the booking's startAt and the policy's window helpers.
    const now = new Date();
    const lateCancellation = isWithinCancellationWindow(booking.startAt, now);
    const travelChargeApplies = isWithinTravelWindow(booking.startAt, now);

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "cancelled",
        activeSlotKey: `released:${booking.id}`,
        cancelledAt: now,
        cancelledBy: "customer",
        lateCancellation,
        travelChargeApplies,
      },
    });

    return NextResponse.json({
      ok: true,
      lateCancellation,
      travelChargeApplies,
    });
  } catch (error) {
    console.error("[booking/cancel] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to cancel booking." }, { status: 500 });
  }
}
