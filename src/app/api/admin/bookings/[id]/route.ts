// src/app/api/admin/bookings/[id]/route.ts
/**
 * @file route.ts
 * @description Admin API for editing and cancelling bookings by ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { deleteBookingEvent } from "@/features/calendar/lib/google-calendar";
import { toE164NZ } from "@/shared/lib/normalise-phone";
import { sendCustomerReviewRequest } from "@/features/reviews/lib/email";

interface PatchPayload {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  address?: string;
  status?: "confirmed" | "cancelled" | "completed";
}

/**
 * PATCH /api/admin/bookings/[id]
 * Updates a booking's fields. Cancelling removes the calendar event and frees the slot.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @param params - Route params.
 * @param params.params - Destructured route params containing booking id.
 * @returns JSON with ok flag or error.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as PatchPayload;

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (body.name !== undefined) data.name = body.name.trim();
  if (body.email !== undefined) data.email = body.email.trim();
  if (body.phone !== undefined) data.phone = toE164NZ(body.phone) || null;
  if (body.notes !== undefined) data.notes = body.notes;

  if (body.address !== undefined && body.notes === undefined) {
    const currentNotes = booking.notes ?? "";
    const newAddress = body.address.trim();
    if (/^Address:\s*/im.test(currentNotes)) {
      data.notes = currentNotes.replace(/^(Address:\s*).*$/im, newAddress ? `$1${newAddress}` : "");
    }
  }

  if (body.status === "cancelled" && booking.status !== "cancelled") {
    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        console.error("[admin/bookings] Failed to delete calendar event:", err);
      }
    }
    data.status = "cancelled";
    data.activeSlotKey = `released:${id}`;
  } else if (body.status === "completed") {
    data.status = "completed";
    data.activeSlotKey = `released:${id}`;
  } else if (body.status === "confirmed") {
    data.status = "confirmed";
  }

  await prisma.booking.update({ where: { id }, data });

  // When transitioning to "completed", send the review request email if one
  // has not already gone out. updateMany with the null-or-missing guard is
  // atomic, so we can't race with the /api/cron/send-review-emails cron - if
  // the cron already claimed the send, our updateMany returns count=0 and we
  // skip. Same `isSet: false` clause as the cron to handle MongoDB documents
  // where `reviewSentAt` was never written (pre-schema docs).
  let reviewSent = false;
  if (
    body.status === "completed" &&
    booking.status !== "completed" &&
    booking.email &&
    booking.reviewToken
  ) {
    const claim = await prisma.booking.updateMany({
      where: {
        id,
        OR: [{ reviewSentAt: null }, { reviewSentAt: { isSet: false } }],
      },
      data: { reviewSentAt: new Date() },
    });

    if (claim.count > 0) {
      // We won the race - sendCustomerReviewRequest never throws (catches its
      // own errors and logs), so the PATCH response stays successful even if
      // Resend has a hiccup. Trade-off: a single failed send won't auto-retry.
      await sendCustomerReviewRequest({
        id,
        name: booking.name,
        email: booking.email,
        reviewToken: booking.reviewToken,
      });
      reviewSent = true;
    }
  }

  if (body.address !== undefined && booking.email) {
    try {
      await prisma.contact.updateMany({
        where: { email: booking.email },
        data: { address: body.address.trim() || null },
      });
    } catch (err) {
      console.error("[admin/bookings] Failed to update contact address:", err);
    }
  }

  if (body.phone !== undefined && booking.email) {
    try {
      await prisma.contact.updateMany({
        where: { email: booking.email },
        data: { phone: toE164NZ(body.phone) || null },
      });
    } catch (err) {
      console.error("[admin/bookings] Failed to update contact phone:", err);
    }
  }

  return NextResponse.json({ ok: true, reviewSent });
}

/**
 * DELETE /api/admin/bookings/[id]
 * Permanently deletes a booking and its calendar event.
 * Requires X-Admin-Secret header.
 * @param request - Incoming request.
 * @param params - Route params.
 * @param params.params - Destructured route params containing booking id.
 * @returns JSON with ok flag or error.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  if (booking.calendarEventId) {
    try {
      await deleteBookingEvent({ eventId: booking.calendarEventId });
    } catch (err) {
      console.error("[admin/bookings] Failed to delete calendar event:", err);
    }
  }

  await prisma.booking.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
