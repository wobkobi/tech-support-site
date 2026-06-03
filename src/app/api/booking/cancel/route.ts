// src/app/api/booking/cancel/route.ts
/**
 * @file route.ts
 * @description Cancel a booking by cancel token. GET returns startAt +
 * status so the cancel page can render the fee banner before firing. POST
 * cancels, stamps cancellation flags from the server clock, and auto-drafts
 * a DRAFT invoice when the cancel lands inside the fee window.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { deleteBookingEvent } from "@/features/calendar/lib/google-calendar";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import {
  isWithinCancellationWindow,
  isWithinTravelWindow,
} from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { createDraftCancellationInvoice } from "@/features/business/lib/cancellation-invoice";

interface CancelPayload {
  cancelToken: string;
}

/**
 * GET /api/booking/cancel?token=...
 * Booking info for the confirmation gate. Never mutates state.
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

  // Hand the live cancellation policy to the client so the fee banner quotes
  // the figures actually charged, not the bundled defaults.
  const { CANCELLATION } = await getPolicy();
  return NextResponse.json({
    ok: true,
    startAt: booking.startAt.toISOString(),
    status: booking.status,
    cancellation: {
      freeNoticeHours: CANCELLATION.freeNoticeHours,
      travelChargeHours: CANCELLATION.travelChargeHours,
      callOutFee: CANCELLATION.callOutFee,
    },
  });
}

/**
 * POST /api/booking/cancel
 * Cancels the booking, removes its Google Calendar event, stamps the
 * cancellation flags, and fires the auto-draft invoice when inside the fee window.
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

    const booking = await prisma.booking.findFirst({
      where: { cancelToken },
    });

    if (!booking) {
      return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
    }

    if (booking.status === "cancelled") {
      return NextResponse.json({ ok: false, error: "Booking already cancelled." }, { status: 400 });
    }

    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        // Don't block the DB cancel on a Google API hiccup.
        console.error("[booking/cancel] Failed to delete calendar event:", err);
      }
    }

    // Server clock decides the fee flags so a skewed client can't move the boundary.
    const now = new Date();
    const { CANCELLATION } = await getPolicy();
    const lateCancellation = isWithinCancellationWindow(
      booking.startAt,
      now,
      CANCELLATION.freeNoticeHours,
    );
    const travelChargeApplies = isWithinTravelWindow(
      booking.startAt,
      now,
      CANCELLATION.travelChargeHours,
    );

    const updated = await prisma.booking.update({
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

    // Fire-and-forget so a draft failure never blocks the cancel response.
    if (lateCancellation) {
      void createDraftCancellationInvoice(updated, {
        includeTravel: travelChargeApplies,
        reason: "late-cancellation",
      }).catch((err) =>
        console.error("[booking/cancel] Failed to draft cancellation invoice:", err),
      );
    }

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
