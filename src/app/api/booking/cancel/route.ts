// src/app/api/booking/cancel/route.ts
// Cancel a booking by cancel token. GET feeds the cancel page's fee banner; POST cancels
// and drafts a cancellation invoice when inside the fee window.

import { isBookingClosed } from "@/features/booking/lib/booking";
import { createDraftCancellationInvoice } from "@/features/business/lib/cancellation-invoice";
import { assessCancellation } from "@/features/business/lib/pricing-policy";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { releaseBookingRedemptions } from "@/features/business/lib/promo-redemption";
import { parseString } from "@/features/business/lib/validation";
import { deleteBookingEvent } from "@/features/calendar/lib/google-calendar";
import { sendOwnerPush } from "@/features/notifications/lib/push";
import { sendOwnerBookingCancellation } from "@/features/reviews/lib/email-booking";
import { cancelHeldBookingEmails } from "@/features/reviews/lib/email-core";
import { errorResponse } from "@/shared/lib/api-response";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

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
    return errorResponse("Missing cancel token.", 400);
  }

  const booking = await prisma.booking.findFirst({
    where: { cancelToken: token },
    select: { startAt: true, status: true },
  });
  if (!booking) {
    return errorResponse("Booking not found.", 404);
  }

  // Live policy, so the fee banner quotes the figures actually charged.
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
 * Cancel the booking, remove its calendar event and draft a fee invoice when late.
 * @param request - The incoming cancel request.
 * @returns JSON response indicating success or failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "booking-cancel", 5, 60_000);
  if (limited) return limited;

  try {
    const body = (await request.json()) as CancelPayload;
    // A filter object here would match somebody else's booking.
    const cancelToken = parseString(body.cancelToken);

    if (!cancelToken) {
      return errorResponse("Missing cancel token.", 400);
    }

    // Load the booking
    const booking = await prisma.booking.findFirst({
      where: { cancelToken },
    });

    if (!booking) {
      return errorResponse("Booking not found.", 404);
    }

    if (booking.status === "cancelled") {
      return errorResponse("Booking already cancelled.", 400);
    }

    // Server clock decides the fee flags so a skewed client can't move the boundary.
    // In-person and remote have their own windows and fees.
    const now = new Date();
    if (isBookingClosed(booking, now)) {
      return errorResponse(
        "This appointment has already started or finished, so it can't be cancelled online. Please call or text me and I'll sort it.",
        400,
      );
    }
    const { CANCELLATION } = await getPolicy();
    const charge = assessCancellation(booking.startAt, now, {
      reason: "late-cancellation",
      meetingType: booking.meetingType === "remote" ? "remote" : "in-person",
      policy: CANCELLATION,
    });
    const lateCancellation = charge.fee > 0;
    const travelChargeApplies = charge.travelApplies;

    // Claim the cancel: only one request can flip an active, not-yet-started booking, so a
    // double click or a race with the operator never sends two fee invoices.
    const claim = await prisma.booking.updateMany({
      where: { id: booking.id, status: "confirmed", startAt: { gt: now } },
      data: {
        status: "cancelled",
        activeSlotKey: `released:${booking.id}`,
        cancelledAt: now,
        cancelledBy: "customer",
        lateCancellation,
        travelChargeApplies,
      },
    });
    if (claim.count === 0) {
      return errorResponse("Booking already cancelled.", 409);
    }
    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

    // After the claim, so a refused or duplicate cancel never touches the calendar.
    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        // Don't fail the committed cancel on a Google API hiccup.
        console.error("[booking/cancel] Failed to delete calendar event:", err);
      }
    }

    // Unused promo stops counting against its caps. Both helpers never throw.
    await releaseBookingRedemptions(booking.id);
    // A reminder held overnight would otherwise still land in the morning.
    await cancelHeldBookingEmails(booking.id);

    // Awaited: Vercel freezes the instance after the response, so a detached call never runs.
    // Failure is swallowed - the cancellation has committed.
    if (lateCancellation) {
      try {
        await createDraftCancellationInvoice(updated, {
          cancelledAt: now,
          reason: "late-cancellation",
          // Auto-send only on customer self-cancel; operator cancels stay drafts.
          autoSend: CANCELLATION.autoSendCancellationInvoice,
        });
      } catch (err) {
        console.error("[booking/cancel] Failed to draft cancellation invoice:", err);
      }
    }

    // Wrapped because the settings read can throw, and the cancel has committed -
    // a throw would report success as failure and invite a retry.
    try {
      await sendOwnerBookingCancellation(
        {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          notes: updated.notes ?? "",
          startAt: updated.startAt,
          endAt: updated.endAt,
          cancelToken: updated.cancelToken,
        },
        { lateCancellation },
      );

      const { comms } = await getSettings();
      if (comms.pushOnCancellation) {
        await sendOwnerPush({
          title: "Booking cancelled",
          // Name and time only - this renders on a lock screen.
          body: `${updated.name} - was ${formatDateTimeShort(updated.startAt)}`,
          url: `/admin/bookings/${updated.id}`,
          tag: `booking-${updated.id}`,
        });
      }
    } catch (err) {
      console.error("[booking/cancel] Failed to notify the owner:", err);
    }

    return NextResponse.json({
      ok: true,
      lateCancellation,
      travelChargeApplies,
    });
  } catch (error) {
    console.error("[booking/cancel] Error:", error);
    return errorResponse("Failed to cancel booking.", 500);
  }
}
